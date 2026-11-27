/**
 * Ingresos del taller = pagos CONFIRMADOS de clientes (la fuente de verdad del dinero recibido).
 * Lo usan el cierre diario, el reporte Word y el Excel acumulativo: los tres dicen lo mismo.
 * Cada pago es una fila (los abonos van uno por uno); una devolución es una fila aparte, en negativo.
 * Lo que sale de la base se lee de nuevo cada vez: exportar dos veces no duplica nada.
 */
import { redondear, type MedioPago } from "@/lib/dinero";
import type { Ingreso } from "@/lib/caja/ingresos-calculo";
import { clienteServidor } from "@/lib/supabase/servidor";
import { nombresPersonal } from "@/lib/taller/consultas";
import { instantesPeriodo } from "@/lib/taller/periodo";

const ZONA = "America/Lima";
const diaLima = (f: string) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(f));
const horaLima = (f: string) => new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(f));
const n = (x: unknown) => Number(x ?? 0);
const uno = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

/** Pagos confirmados entre dos días de Lima (incluidos), con todo lo que piden el cierre, el Word y el Excel. */
export async function ingresosEntre(empresaId: string, desdeDia: string, hastaDia: string): Promise<Ingreso[]> {
  const supabase = await clienteServidor();
  const { inicio, fin } = instantesPeriodo(desdeDia, hastaDia);
  const { data: pagos } = await supabase
    .from("pagos")
    .select("id, orden_id, monto, tipo, medio, pagado_en, numero_operacion, creado_por, ordenes_trabajo (numero, vehiculos (placa), clientes (nombre, numero_documento))")
    .eq("empresa_id", empresaId)
    .eq("estado", "confirmado")
    .gte("pagado_en", inicio)
    .lt("pagado_en", fin)
    .order("pagado_en")
    .limit(10000);
  const lista = pagos ?? [];
  const ordenes = [...new Set(lista.map((p) => p.orden_id))];
  const [nombres, { data: cots }, { data: servs }, { data: comps }, { data: recibos }] = await Promise.all([
    nombresPersonal(empresaId),
    ordenes.length ? supabase.from("cotizaciones").select("orden_id, tasa_igv, cotizacion_items (descripcion)").in("orden_id", ordenes).eq("estado", "aprobada").order("version") : Promise.resolve({ data: [] }),
    ordenes.length ? supabase.from("orden_servicios").select("orden_id, descripcion").in("orden_id", ordenes).order("creado_en") : Promise.resolve({ data: [] }),
    ordenes.length ? supabase.from("comprobantes_venta").select("orden_id, tipo, serie, numero, subtotal_sin_igv, total").in("orden_id", ordenes).eq("estado", "confirmado") : Promise.resolve({ data: [] }),
    ordenes.length ? supabase.from("recibos").select("orden_id, numero, tasa_igv").in("orden_id", ordenes).neq("estado", "anulado") : Promise.resolve({ data: [] }),
  ]);
  type Cot = { orden_id: string; tasa_igv: unknown; cotizacion_items: { descripcion: string }[] | null };
  const concepto = new Map<string, string[]>();
  const tasa = new Map<string, number>();
  for (const c of (cots ?? []) as Cot[]) {
    concepto.set(c.orden_id, [...(concepto.get(c.orden_id) ?? []), ...(c.cotizacion_items ?? []).map((i) => i.descripcion)]);
    if (!tasa.has(c.orden_id)) tasa.set(c.orden_id, n(c.tasa_igv));
  }
  for (const s of (servs ?? []) as { orden_id: string; descripcion: string }[]) if (!concepto.has(s.orden_id)) concepto.set(s.orden_id, [s.descripcion]);
  const comprobante = new Map<string, string>();
  for (const r of (recibos ?? []) as { orden_id: string; numero: number; tasa_igv: unknown }[]) {
    comprobante.set(r.orden_id, `Recibo N° ${r.numero}`);
    tasa.set(r.orden_id, n(r.tasa_igv));
  }
  for (const c of (comps ?? []) as { orden_id: string; tipo: string; serie: string; numero: string; subtotal_sin_igv: unknown; total: unknown }[]) {
    comprobante.set(c.orden_id, `${c.tipo === "factura" ? "Factura" : "Boleta"} ${c.serie}-${c.numero}`);
    if (n(c.subtotal_sin_igv) > 0) tasa.set(c.orden_id, redondear(n(c.total) / n(c.subtotal_sin_igv) - 1));
  }
  return lista.map((p) => {
    const o = uno(p.ordenes_trabajo as unknown) as { numero: number; vehiculos: unknown; clientes: unknown } | null;
    const v = uno(o?.vehiculos) as { placa: string } | null;
    const cl = uno(o?.clientes) as { nombre: string; numero_documento: string | null } | null;
    const monto = p.tipo === "devolucion" ? -n(p.monto) : n(p.monto);
    const t = tasa.get(p.orden_id) ?? 0;
    const subtotal = redondear(monto / (1 + t));
    const lineas = concepto.get(p.orden_id) ?? [];
    return {
      id: p.id,
      momento: p.pagado_en,
      dia: diaLima(p.pagado_en),
      hora: horaLima(p.pagado_en),
      ordenId: p.orden_id,
      orden: o?.numero ?? null,
      cliente: cl?.nombre ?? null,
      documento: cl?.numero_documento ?? null,
      placa: v?.placa ?? null,
      concepto: p.tipo === "devolucion" ? `Devolución${p.numero_operacion ? ` · ${p.numero_operacion.replace(/^Devolución:\s*/, "")}` : ""}` : lineas.length ? lineas.slice(0, 3).join(", ") + (lineas.length > 3 ? ` y ${lineas.length - 3} más` : "") : "Pago de la orden",
      medio: p.medio as MedioPago,
      tipo: p.tipo,
      monto,
      subtotal,
      igv: redondear(monto - subtotal),
      comprobante: comprobante.get(p.orden_id) ?? "Constancia",
      usuario: nombres.get(p.creado_por ?? "") ?? "—",
      operacion: p.tipo === "devolucion" ? null : (p.numero_operacion ?? null),
    };
  });
}


export { GRUPOS, filtrarIngresos, grupoDe, resumirIngresos, type GrupoMedio, type Ingreso, type ResumenIngresos } from "@/lib/caja/ingresos-calculo";
