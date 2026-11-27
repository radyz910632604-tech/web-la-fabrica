import { redondear } from "@/lib/dinero";
import { clienteServidor } from "@/lib/supabase/servidor";
import { nombresPersonal } from "@/lib/taller/consultas";
import type { EstadoOrden } from "@/lib/taller/estados";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

/** Una visita del carro, resumida para leer su historia sin abrir orden por orden. */
export type Visita = {
  id: string;
  numero: number;
  estado: EstadoOrden;
  facturadoEn: string | null;
  ingresadoEn: string;
  entregadoEn: string | null;
  km: number | null;
  tecnico: string | null;
  garantia: boolean;
  importada: boolean;
  servicios: string[];
  repuestos: string[];
  diagnostico: string | null;
  /** Notas del ingreso (en lo importado del Excel, el detalle que venía). */
  notas: string | null;
  /** Lo cobrado (boleta, factura o recibo) o, si aún no, lo aprobado. Solo para quien ve dinero. */
  monto: { valor: number; tipo: "cobrado" | "aprobado" } | null;
};

/** Todas las visitas del carro, de la más reciente a la más antigua. */
export async function historialDelCarro(empresaId: string, vehiculoId: string, verDinero: boolean): Promise<Visita[]> {
  const supabase = await clienteServidor();
  const { data: ordenes } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, estado, facturado_en, ingresado_en, entregado_en, kilometraje_ingreso, tecnico_id, es_reingreso_garantia, importada, diagnostico, observaciones_ingreso, anulada, orden_servicios (descripcion)")
    .eq("empresa_id", empresaId)
    .eq("vehiculo_id", vehiculoId)
    .order("ingresado_en", { ascending: false })
    .limit(200);
  const lista = (ordenes ?? []).filter((o) => !o.anulada);
  if (!lista.length) return [];
  const ids = lista.map((o) => o.id);

  const [nombres, { data: salidas }, { data: comprados }, dinero] = await Promise.all([
    nombresPersonal(empresaId),
    supabase.from("movimientos_inventario").select("orden_id, cantidad, repuestos (nombre)").in("orden_id", ids).eq("tipo", "salida").eq("estado", "vigente"),
    // Repuestos comprados para la orden (compra confirmada).
    supabase.from("compra_items").select("orden_id, descripcion, cantidad, compras!inner (estado)").in("orden_id", ids).eq("compras.estado", "confirmado"),
    verDinero
      ? Promise.all([
          supabase.from("cotizaciones").select("orden_id, total, cotizacion_items (descripcion, tipo, cantidad)").in("orden_id", ids).eq("estado", "aprobada"),
          supabase.from("comprobantes_venta").select("orden_id, total").in("orden_id", ids).eq("estado", "confirmado"),
          supabase.from("notas_credito").select("orden_id, total").in("orden_id", ids).eq("estado", "confirmado"),
          supabase.from("recibos").select("orden_id, total").in("orden_id", ids).neq("estado", "anulado"),
        ])
      : null,
  ]);

  const repuestos = new Map<string, string[]>();
  // El mismo repuesto puede venir de la compra y de la cotización: se anota una vez.
  const clave = (t: string) => t.toLowerCase().replace(/^\d+(\.\d+)? × /, "").trim();
  const agregar = (orden: string, texto: string) => {
    const l = repuestos.get(orden) ?? [];
    if (!l.some((x) => clave(x) === clave(texto))) l.push(texto);
    repuestos.set(orden, l);
  };
  const cantidad = (c: number, nombre: string) => (c && c !== 1 ? `${c} × ${nombre}` : nombre);
  for (const s of (salidas ?? []) as { orden_id: string; cantidad: Num; repuestos: { nombre: string } | { nombre: string }[] | null }[]) {
    const r = Array.isArray(s.repuestos) ? s.repuestos[0] : s.repuestos;
    if (r) agregar(s.orden_id, cantidad(-n(s.cantidad), r.nombre));
  }

  for (const c of (comprados ?? []) as { orden_id: string; descripcion: string; cantidad: Num }[]) agregar(c.orden_id, cantidad(n(c.cantidad), c.descripcion));

  const suma = (filas: { orden_id: string; total: Num }[] | null) => {
    const m = new Map<string, number>();
    for (const f of filas ?? []) m.set(f.orden_id, redondear((m.get(f.orden_id) ?? 0) + n(f.total)));
    return m;
  };
  let aprobado = new Map<string, number>();
  let comprobantes = new Map<string, number>();
  let notas = new Map<string, number>();
  let recibos = new Map<string, number>();
  if (dinero) {
    const [{ data: cots }, { data: comps }, { data: ncs }, { data: recs }] = dinero;
    aprobado = suma(cots);
    comprobantes = suma(comps);
    notas = suma(ncs);
    recibos = suma(recs);
    for (const c of (cots ?? []) as { orden_id: string; cotizacion_items: { descripcion: string; tipo: string; cantidad: Num }[] | null }[]) {
      for (const i of c.cotizacion_items ?? []) if (i.tipo === "repuesto") agregar(c.orden_id, cantidad(n(i.cantidad), i.descripcion));
    }
  }

  return lista.map((o) => {
    const cobrado = comprobantes.has(o.id) ? redondear(comprobantes.get(o.id)! - (notas.get(o.id) ?? 0)) : recibos.get(o.id);
    const ap = aprobado.get(o.id);
    return {
      id: o.id,
      numero: o.numero,
      estado: o.estado as EstadoOrden,
      facturadoEn: o.facturado_en,
      ingresadoEn: o.ingresado_en,
      entregadoEn: o.entregado_en,
      km: o.kilometraje_ingreso,
      tecnico: o.tecnico_id ? (nombres.get(o.tecnico_id) ?? null) : null,
      garantia: o.es_reingreso_garantia,
      importada: o.importada,
      servicios: ((o.orden_servicios ?? []) as { descripcion: string }[]).map((s) => s.descripcion),
      repuestos: repuestos.get(o.id) ?? [],
      diagnostico: o.diagnostico,
      notas: o.observaciones_ingreso,
      monto: !verDinero ? null : cobrado != null ? { valor: cobrado, tipo: "cobrado" } : ap != null ? { valor: ap, tipo: "aprobado" } : null,
    };
  });
}

/** Totales de la vida del carro: visitas, cobrado y kilometraje recorrido entre la primera y la última. */
export function resumenHistorial(visitas: Visita[]) {
  const kms = visitas.map((v) => v.km).filter((k): k is number => k != null);
  const cobrado = visitas.reduce((a, v) => a + (v.monto?.tipo === "cobrado" ? v.monto.valor : 0), 0);
  return {
    visitas: visitas.length,
    cobrado: redondear(cobrado),
    primera: visitas.at(-1)?.ingresadoEn ?? null,
    recorrido: kms.length >= 2 ? Math.max(...kms) - Math.min(...kms) : null,
  };
}
