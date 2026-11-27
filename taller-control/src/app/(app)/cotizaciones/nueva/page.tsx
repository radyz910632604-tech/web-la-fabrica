import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EditorCotizacion } from "@/components/caja/editor-cotizacion";
import { CAJA, esGestor, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { configDinero } from "@/lib/taller/dinero-consultas";
import { ESTADOS_ABIERTOS, etiquetaOrden } from "@/lib/taller/estados";

export const metadata = { title: "Nueva cotización" };

export default async function NuevaCotizacionPagina({ searchParams }: { searchParams: Promise<{ orden?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { orden } = await searchParams;
  const [abiertas, { tasaIgv }] = await Promise.all([listarOrdenes(ctx.taller.id, { estados: [...ESTADOS_ABIERTOS], orden: "reciente", limite: 200 }), configDinero(ctx.taller.id)]);
  let servicios: string[] = [];
  if (orden) {
    const supabase = await clienteServidor();
    const { data } = await supabase.from("orden_servicios").select("descripcion").eq("orden_id", orden).order("creado_en");
    servicios = (data ?? []).map((s) => s.descripcion);
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <Link href={orden ? `/ordenes/${orden}` : "/cotizaciones"} className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          {orden ? "Volver a la orden" : "Cotizaciones"}
        </Link>
        <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Nueva cotización</h1>
      </header>
      <EditorCotizacion
        puedeDescontar={esGestor(ctx.roles)}
        ordenes={abiertas.map((o) => ({ id: o.id, etiqueta: etiquetaOrden({ numero: o.numero, placa: o.placa, cliente: o.cliente }) }))}
        ordenFija={orden ?? null}
        tasaIgv={tasaIgv}
        servicios={servicios}
      />
    </div>
  );
}
