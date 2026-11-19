import "server-only";
import { efectivoEsperado, MEDIOS, montoNeto, redondear, type MedioPago } from "../dinero";
import { clienteServidor } from "../supabase/servidor";
import { numeroOrden } from "./estados";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type Caja = {
  id: string;
  estado: "abierta" | "cerrada";
  montoInicial: number;
  abiertaPor: string | null;
  abiertaEn: string;
  cerradaPor: string | null;
  cerradaEn: string | null;
  esperado: number | null;
  contado: number | null;
  diferencia: number | null;
  observaciones: string | null;
};

export type Movimiento = {
  id: string;
  clase: "pago" | "movimiento";
  momento: string;
  tipo: string;
  concepto: string;
  medio: MedioPago;
  monto: number;
  /** Lo que suma (+) o resta (−) a la caja. */
  efecto: number;
  ordenId: string | null;
  estado: string;
  motivoAnulacion: string | null;
};

export type DetalleCaja = {
  caja: Caja;
  movimientos: Movimiento[];
  porMedio: Record<MedioPago, number>;
  efectivo: ReturnType<typeof efectivoEsperado>;
  totalCobrado: number;
};

const aCaja = (c: Record<string, unknown>): Caja => ({
  id: String(c.id),
  estado: c.estado as Caja["estado"],
  montoInicial: n(c.monto_inicial as Num),
  abiertaPor: (c.abierta_por as string) ?? null,
  abiertaEn: String(c.abierta_en),
  cerradaPor: (c.cerrada_por as string) ?? null,
  cerradaEn: (c.cerrada_en as string) ?? null,
  esperado: c.efectivo_esperado == null ? null : n(c.efectivo_esperado as Num),
  contado: c.efectivo_contado == null ? null : n(c.efectivo_contado as Num),
  diferencia: c.diferencia == null ? null : n(c.diferencia as Num),
  observaciones: (c.observaciones as string) ?? null,
});

const COLUMNAS = "id, estado, monto_inicial, abierta_por, abierta_en, cerrada_por, cerrada_en, efectivo_esperado, efectivo_contado, diferencia, observaciones";

export async function cajaAbierta(empresaId: string): Promise<Caja | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("cajas").select(COLUMNAS).eq("empresa_id", empresaId).eq("estado", "abierta").maybeSingle();
  return data ? aCaja(data) : null;
}

export async function historialCajas(empresaId: string, limite = 10): Promise<Caja[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("cajas").select(COLUMNAS).eq("empresa_id", empresaId).eq("estado", "cerrada").order("abierta_en", { ascending: false }).limit(limite);
  return (data ?? []).map(aCaja);
}

/** Todo lo que entró y salió de una caja, con el efectivo que debería haber. */
export async function detalleCaja(empresaId: string, cajaId: string): Promise<DetalleCaja | null> {
  const supabase = await clienteServidor();
  const [{ data: c }, { data: pagos }, { data: movs }] = await Promise.all([
    supabase.from("cajas").select(COLUMNAS).eq("id", cajaId).eq("empresa_id", empresaId).maybeSingle(),
    supabase.from("pagos").select("id, orden_id, monto, tipo, medio, pagado_en, estado, motivo_anulacion, ordenes_trabajo (numero)").eq("caja_id", cajaId).order("pagado_en"),
    supabase.from("movimientos_caja").select("id, tipo, concepto, monto, medio, creado_en, estado, motivo_anulacion").eq("caja_id", cajaId).order("creado_en"),
  ]);
  if (!c) return null;
  const caja = aCaja(c);
  const TIPO: Record<string, string> = { adelanto: "Adelanto", abono: "Abono", saldo: "Saldo", devolucion: "Devolución" };
  const movimientos: Movimiento[] = [
    ...(pagos ?? []).map((p) => {
      const o = Array.isArray(p.ordenes_trabajo) ? p.ordenes_trabajo[0] : p.ordenes_trabajo;
      const efecto = montoNeto({ tipo: p.tipo, monto: n(p.monto) });
      return {
        id: p.id, clase: "pago" as const, momento: p.pagado_en, tipo: p.tipo, concepto: `${TIPO[p.tipo]}${o ? ` de ${numeroOrden(o.numero)}` : ""}`,
        medio: p.medio as MedioPago, monto: n(p.monto), efecto, ordenId: p.orden_id, estado: p.estado, motivoAnulacion: p.motivo_anulacion,
      };
    }),
    ...(movs ?? []).map((m) => ({
      id: m.id, clase: "movimiento" as const, momento: m.creado_en, tipo: m.tipo, concepto: m.concepto, medio: m.medio as MedioPago,
      monto: n(m.monto), efecto: m.tipo === "egreso" ? -n(m.monto) : n(m.monto), ordenId: null, estado: m.estado, motivoAnulacion: m.motivo_anulacion,
    })),
  ].sort((a, b) => b.momento.localeCompare(a.momento));
  const vigentes = movimientos.filter((m) => m.estado === "confirmado");
  const porMedio = Object.fromEntries(Object.keys(MEDIOS).map((k) => [k, 0])) as Record<MedioPago, number>;
  for (const m of vigentes) if (m.clase === "pago") porMedio[m.medio] = redondear(porMedio[m.medio] + m.efecto);
  const efectivo = efectivoEsperado({
    montoInicial: caja.montoInicial,
    pagos: vigentes.filter((m) => m.clase === "pago").map((m) => ({ tipo: m.tipo, medio: m.medio, monto: m.monto })),
    movimientos: vigentes.filter((m) => m.clase === "movimiento").map((m) => ({ tipo: m.tipo as "ingreso" | "egreso", medio: m.medio, monto: m.monto })),
  });
  return { caja, movimientos, porMedio, efectivo, totalCobrado: redondear(Object.values(porMedio).reduce((a, b) => a + b, 0)) };
}

/** Pagos de hoy que se registraron sin caja abierta (no cuentan en ningún arqueo). */
export async function pagosSinCaja(empresaId: string, desde: Date): Promise<number> {
  const supabase = await clienteServidor();
  const { count } = await supabase.from("pagos").select("id", { count: "exact", head: true }).eq("empresa_id", empresaId).is("caja_id", null).eq("estado", "confirmado").gte("pagado_en", desde.toISOString());
  return count ?? 0;
}
