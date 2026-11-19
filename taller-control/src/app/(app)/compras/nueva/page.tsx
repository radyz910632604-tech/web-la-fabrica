import { notFound } from "next/navigation";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { diaEnLima } from "@/lib/formato";
import { listarOrdenes } from "@/lib/taller/consultas";
import { configDinero } from "@/lib/taller/dinero-consultas";
import { etiquetaOrden, ESTADOS_ABIERTOS } from "@/lib/taller/estados";
import { estadoIa } from "@/lib/ia/proveedor";
import { FormularioCompra } from "./formulario";

export const metadata = { title: "Registrar compra" };

export default async function NuevaCompra({ searchParams }: { searchParams: Promise<{ orden?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"])) notFound();
  const { orden } = await searchParams;
  const supabase = await clienteServidor();
  const [{ data: proveedores }, ordenes, config, { data: repuestos }] = await Promise.all([
    supabase.from("proveedores").select("id, ruc, razon_social").eq("empresa_id", ctx.taller.id).eq("activo", true).order("razon_social"),
    listarOrdenes(ctx.taller.id, { estados: [...ESTADOS_ABIERTOS], limite: 200, orden: "ingreso" }),
    configDinero(ctx.taller.id),
    supabase.from("repuestos").select("id, codigo, nombre").eq("empresa_id", ctx.taller.id).eq("activo", true).order("nombre").limit(500),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Registrar compra</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">La factura o boleta del proveedor. Cada repuesto va a una orden, al inventario o al stock del almacén.</p>
      </header>
      <FormularioCompra
        proveedores={(proveedores ?? []).map((p) => ({ id: p.id, ruc: p.ruc, razonSocial: p.razon_social }))}
        ordenes={ordenes.map((o) => ({ id: o.id, etiqueta: etiquetaOrden(o) }))}
        repuestos={repuestos ?? []}
        hoy={diaEnLima(new Date())}
        tasaIgv={config.tasaIgv}
        ia={estadoIa().lectura}
        ordenInicial={ordenes.some((o) => o.id === orden) ? orden : undefined}
      />
    </div>
  );
}
