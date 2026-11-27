import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EditorCotizacion } from "@/components/caja/editor-cotizacion";
import { CAJA, esGestor, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { detalleCotizacion } from "@/lib/taller/cotizaciones-consultas";
import { configDinero } from "@/lib/taller/dinero-consultas";

export const metadata = { title: "Editar cotización" };

export default async function EditarCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { id } = await params;
  const [c, { tasaIgv }] = await Promise.all([detalleCotizacion(ctx.taller.id, id), configDinero(ctx.taller.id)]);
  if (!c) notFound();
  if (c.estado === "anulada" || c.estado === "rechazada" || c.bloqueada) redirect(`/cotizaciones/${id}`);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <Link href={`/cotizaciones/${id}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Volver a la cotización
        </Link>
        <h1 className="mt-3 text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Editar cotización N° {String(c.numero ?? 0).padStart(6, "0")}</h1>
        {c.ordenId ? <p className="mt-1.5 text-[15px] text-tinta-2">Es de una orden: al guardar queda una versión nueva y esta queda anulada, a la vista.{c.estado === "aprobada" ? " Sigue aprobada." : ""}</p> : null}
      </header>
      <EditorCotizacion
        puedeDescontar={esGestor(ctx.roles)}
        inicial={{
          id: c.id,
          ordenId: c.ordenId,
          conIgv: c.conIgv,
          cliente: { nombre: c.ordenId ? "" : c.cliente, celular: c.celular ?? "", documento: c.documento ?? "", placa: c.placa ?? "", vehiculo: c.vehiculo ?? "" },
          items: c.items,
          descuento: c.descuentoTipo ? { tipo: c.descuentoTipo, valor: c.descuentoValor ?? 0, motivo: c.descuentoMotivo ?? "" } : null,
        }}
        ordenes={[]}
        tasaIgv={tasaIgv}
      />
    </div>
  );
}
