import "server-only";
import { enSoles, manoObra, redondear, utilidad } from "../dinero";
import { clienteServidor } from "../supabase/servidor";
import { configDinero, costosVigentes, limitesMes } from "./dinero-consultas";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);
const uno = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined));

export type GananciaOrden = {
  id: string;
  numero: number;
  placa: string;
  cliente: string | null;
  entregadoEn: string;
  /** De dónde sale la venta: «Boleta B001-12», «Recibo N° 10929» o «Sin documento». */
  documento: string;
  venta: number;
  repuestos: number;
  manoObra: number;
  utilidad: number;
  margen: number | null;
};

/**
 * Ganancia de cada carro entregado en el mes (sin IGV): lo que se le vendió
 * (boleta o factura; si no hay, el recibo del taller) menos los repuestos
 * (compras para la orden y salidas del inventario) y la mano de obra.
 * Todo en pocas consultas, con la sesión de quien mira (solo gerencia ve sueldos).
 */
export async function gananciasDelMes(empresaId: string, mes: string): Promise<GananciaOrden[]> {
  const supabase = await clienteServidor();
  const { desde, hasta, hastaDia } = limitesMes(mes);
  const { data: ordenes } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, tecnico_id, entregado_en, vehiculos (placa), clientes (nombre)")
    .eq("empresa_id", empresaId)
    .eq("estado", "entregado")
    .eq("anulada", false)
    .gte("entregado_en", desde.toISOString())
    .lt("entregado_en", hasta.toISOString())
    .order("entregado_en", { ascending: false });
  const lista = ordenes ?? [];
  if (!lista.length) return [];
  const ids = lista.map((o) => o.id);
  const config = await configDinero(empresaId);
  const [{ data: comps }, { data: notas }, { data: recibos }, { data: items }, { data: salidas }, costos, { data: servicios }, { data: fijos }] = await Promise.all([
    supabase.from("comprobantes_venta").select("orden_id, tipo, serie, numero, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("notas_credito").select("orden_id, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("recibos").select("orden_id, numero, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("compra_items").select("orden_id, subtotal_sin_igv, compras!inner (estado, moneda, tipo_cambio)").eq("compras.estado", "confirmado").in("orden_id", ids),
    supabase.from("movimientos_inventario").select("orden_id, cantidad, costo_unitario_sin_igv").eq("tipo", "salida").eq("estado", "vigente").in("orden_id", ids),
    config.regla === "prorrateo_mensual" ? costosVigentes(empresaId, hastaDia) : Promise.resolve(new Map<string, number>()),
    config.regla === "fijo_por_servicio" ? supabase.from("orden_servicios").select("orden_id, servicio_id").in("orden_id", ids) : Promise.resolve({ data: [] }),
    config.regla === "fijo_por_servicio" ? supabase.from("mano_obra_servicio").select("servicio_id, monto").eq("empresa_id", empresaId) : Promise.resolve({ data: [] }),
  ]);

  const sumaPor = <T extends { orden_id: string | null }>(filas: T[] | null, valor: (f: T) => number) => {
    const m = new Map<string, number>();
    for (const f of filas ?? []) if (f.orden_id) m.set(f.orden_id, redondear((m.get(f.orden_id) ?? 0) + valor(f)));
    return m;
  };
  const ventaComp = sumaPor(comps, (c) => n(c.subtotal_sin_igv));
  const notasPor = sumaPor(notas, (x) => n(x.subtotal_sin_igv));
  type ItemCrudo = { orden_id: string | null; subtotal_sin_igv: Num; compras: { moneda: "PEN" | "USD"; tipo_cambio: Num } | { moneda: "PEN" | "USD"; tipo_cambio: Num }[] };
  const compradoPor = sumaPor(items as ItemCrudo[] | null, (i) => {
    const k = uno(i.compras);
    return enSoles(n(i.subtotal_sin_igv), k?.moneda ?? "PEN", n(k?.tipo_cambio ?? 1));
  });
  const salidaPor = sumaPor(salidas, (x) => redondear(-n(x.cantidad) * n(x.costo_unitario_sin_igv)));
  const fijoPor = new Map(((fijos ?? []) as { servicio_id: string; monto: Num }[]).map((f) => [f.servicio_id, n(f.monto)]));
  const entregadasPorTecnico = new Map<string, number>();
  for (const o of lista) if (o.tecnico_id) entregadasPorTecnico.set(o.tecnico_id, (entregadasPorTecnico.get(o.tecnico_id) ?? 0) + 1);

  return lista.map((o) => {
    const comp = (comps ?? []).find((c) => c.orden_id === o.id);
    const recibo = (recibos ?? []).find((r) => r.orden_id === o.id);
    const venta = comp ? redondear((ventaComp.get(o.id) ?? 0) - (notasPor.get(o.id) ?? 0)) : n(recibo?.subtotal_sin_igv ?? 0);
    const repuestos = redondear((compradoPor.get(o.id) ?? 0) + (salidaPor.get(o.id) ?? 0));
    const mo =
      config.regla === "fijo_por_servicio"
        ? manoObra("fijo_por_servicio", { montosFijos: ((servicios ?? []) as { orden_id: string; servicio_id: string | null }[]).filter((s) => s.orden_id === o.id).map((s) => fijoPor.get(s.servicio_id ?? "") ?? 0) })
        : o.tecnico_id
          ? manoObra("prorrateo_mensual", { costoMensualTecnico: costos.get(o.tecnico_id) ?? 0, ordenesEntregadasMes: entregadasPorTecnico.get(o.tecnico_id) ?? 1 })
          : 0;
    const u = utilidad(venta, repuestos, mo);
    return {
      id: o.id,
      numero: o.numero,
      placa: uno(o.vehiculos)?.placa ?? "—",
      cliente: uno(o.clientes)?.nombre ?? null,
      entregadoEn: o.entregado_en!,
      documento: comp ? `${comp.tipo === "boleta" ? "Boleta" : "Factura"} ${comp.serie}-${comp.numero}` : recibo ? `Recibo N° ${recibo.numero}` : "Sin documento",
      venta,
      repuestos,
      manoObra: mo,
      utilidad: u.utilidad,
      margen: u.margen,
    };
  });
}
