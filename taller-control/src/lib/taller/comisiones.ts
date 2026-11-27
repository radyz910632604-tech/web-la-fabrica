import { montoNeto, redondear } from "@/lib/dinero";
import { clienteServidor } from "@/lib/supabase/servidor";
import { limitesMes } from "@/lib/taller/dinero-consultas";
import { nombresPersonal } from "@/lib/taller/consultas";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type EstadoComision = "pendiente" | "aprobada" | "pagada" | "anulada";
export type Comision = {
  id: string;
  asesorId: string;
  asesor: string;
  ordenId: string | null;
  ordenNumero: number | null;
  placa: string | null;
  concepto: string;
  base: number | null;
  monto: number;
  estado: EstadoComision;
  medio: string | null;
  motivo: string | null;
  pagadaEn: string | null;
};

/** Las comisiones del mes (solo gerencia y administración las pueden leer: lo exige la base). */
export async function comisionesDelMes(empresaId: string, mes: string): Promise<Comision[]> {
  const supabase = await clienteServidor();
  const [{ data }, nombres] = await Promise.all([
    supabase
      .from("comisiones")
      .select("id, perfil_id, orden_id, concepto, base, monto, estado, medio, motivo_anulacion, pagada_en, ordenes_trabajo (numero, vehiculos (placa))")
      .eq("empresa_id", empresaId)
      .eq("periodo", `${mes}-01`)
      .order("creado_en"),
    nombresPersonal(empresaId),
  ]);
  type Fila = { id: string; perfil_id: string; orden_id: string | null; concepto: string; base: Num; monto: Num; estado: EstadoComision; medio: string | null; motivo_anulacion: string | null; pagada_en: string | null; ordenes_trabajo: unknown };
  const uno = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  return ((data ?? []) as Fila[]).map((c) => {
    const o = uno(c.ordenes_trabajo as { numero: number; vehiculos: { placa: string } | { placa: string }[] | null } | null);
    return {
      id: c.id,
      asesorId: c.perfil_id,
      asesor: nombres.get(c.perfil_id) ?? "—",
      ordenId: c.orden_id,
      ordenNumero: o?.numero ?? null,
      placa: uno(o?.vehiculos)?.placa ?? null,
      concepto: c.concepto,
      base: c.base == null ? null : n(c.base),
      monto: n(c.monto),
      estado: c.estado,
      medio: c.medio,
      motivo: c.motivo_anulacion,
      pagadaEn: c.pagada_en,
    };
  });
}

/**
 * Órdenes del mes que ya comisionan: entregadas en el mes, con asesor y cobradas por completo.
 * Devuelve su venta sin IGV (base de la comisión).
 */
export async function ordenesParaComision(empresaId: string, mes: string): Promise<{ ordenId: string; asesorId: string; numero: number; ventaSinIgv: number }[]> {
  const supabase = await clienteServidor();
  const { desde, hasta } = limitesMes(mes);
  const { data: ordenes } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, asesor_id")
    .eq("empresa_id", empresaId)
    .eq("estado", "entregado")
    .eq("anulada", false)
    .eq("importada", false)
    .not("asesor_id", "is", null)
    .gte("entregado_en", desde.toISOString())
    .lt("entregado_en", hasta.toISOString());
  const ids = (ordenes ?? []).map((o) => o.id);
  if (!ids.length) return [];
  const [{ data: comps }, { data: notas }, { data: recibos }, { data: cots }, { data: pagos }] = await Promise.all([
    supabase.from("comprobantes_venta").select("orden_id, total, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("notas_credito").select("orden_id, total, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("recibos").select("orden_id, total, subtotal_sin_igv").neq("estado", "anulado").in("orden_id", ids),
    supabase.from("cotizaciones").select("orden_id, total, subtotal_sin_igv").eq("estado", "aprobada").in("orden_id", ids),
    supabase.from("pagos").select("orden_id, monto, tipo").eq("estado", "confirmado").in("orden_id", ids),
  ]);
  const suma = (filas: { orden_id: string | null; total: Num; subtotal_sin_igv: Num }[] | null) => {
    const m = new Map<string, { total: number; sinIgv: number }>();
    for (const f of filas ?? []) {
      if (!f.orden_id) continue;
      const a = m.get(f.orden_id) ?? { total: 0, sinIgv: 0 };
      m.set(f.orden_id, { total: a.total + n(f.total), sinIgv: a.sinIgv + n(f.subtotal_sin_igv) });
    }
    return m;
  };
  const [c, nc, r, q] = [suma(comps), suma(notas), suma(recibos), suma(cots)];
  const pagado = new Map<string, number>();
  for (const p of pagos ?? []) pagado.set(p.orden_id, (pagado.get(p.orden_id) ?? 0) + montoNeto({ tipo: p.tipo, monto: n(p.monto) }));

  const salida: { ordenId: string; asesorId: string; numero: number; ventaSinIgv: number }[] = [];
  for (const o of ordenes ?? []) {
    // Lo vendido: boleta o factura (menos notas de crédito); si no, el recibo; si no, lo aprobado.
    const venta = c.has(o.id)
      ? { total: c.get(o.id)!.total - (nc.get(o.id)?.total ?? 0), sinIgv: c.get(o.id)!.sinIgv - (nc.get(o.id)?.sinIgv ?? 0) }
      : (r.get(o.id) ?? q.get(o.id));
    if (!venta || venta.sinIgv <= 0) continue;
    // Cobrada por completo (con un margen de céntimos).
    if ((pagado.get(o.id) ?? 0) + 0.01 < venta.total) continue;
    salida.push({ ordenId: o.id, asesorId: o.asesor_id as string, numero: o.numero, ventaSinIgv: redondear(venta.sinIgv) });
  }
  return salida;
}
