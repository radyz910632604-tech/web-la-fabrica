import "server-only";
import { efectivoEsperado, MEDIOS, montoNeto, redondear, type MedioPago } from "../dinero";
import { clienteServidor } from "../supabase/servidor";
import { numeroOrden } from "./estados";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type AreaCaja = "recepcion" | "almacen";
export const NOMBRE_AREA: Record<AreaCaja, string> = { recepcion: "Recepción", almacen: "Almacén" };

export type Caja = {
  id: string;
  area: AreaCaja;
  fecha: string;
  tipoCierre: "manual" | "automatico_00h" | null;
  requiereArqueo: boolean;
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
  area: (c.tipo_caja as AreaCaja) ?? "recepcion",
  fecha: String(c.fecha),
  tipoCierre: (c.tipo_cierre as Caja["tipoCierre"]) ?? null,
  requiereArqueo: Boolean(c.requiere_arqueo),
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

const COLUMNAS = "id, tipo_caja, fecha, tipo_cierre, requiere_arqueo, estado, monto_inicial, abierta_por, abierta_en, cerrada_por, cerrada_en, efectivo_esperado, efectivo_contado, diferencia, observaciones";

export async function cajaAbierta(empresaId: string, area: AreaCaja = "recepcion"): Promise<Caja | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("cajas").select(COLUMNAS).eq("empresa_id", empresaId).eq("tipo_caja", area).eq("estado", "abierta").maybeSingle();
  return data ? aCaja(data) : null;
}

export async function historialCajas(empresaId: string, limite = 10, area: AreaCaja = "recepcion"): Promise<Caja[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("cajas").select(COLUMNAS).eq("empresa_id", empresaId).eq("tipo_caja", area).eq("estado", "cerrada").order("abierta_en", { ascending: false }).limit(limite);
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

/** Una caja dentro de la Caja Maestra (foto tomada al consolidar). */
export type CajaDelDia = {
  id: string;
  area: AreaCaja;
  tipoCierre: "manual" | "automatico_00h";
  abiertaEn: string;
  cerradaEn: string | null;
  abiertaPor: string | null;
  cerradaPor: string | null;
  montoInicial: number;
  esperado: number;
  contado: number | null;
  diferencia: number | null;
  requiereArqueo: boolean;
  porMedio: Record<MedioPago, { cobros: number; ingresos: number; egresos: number; gastos: number; compras: number }>;
};

export type CajaMaestra = {
  fecha: string;
  cajas: CajaDelDia[];
  efectivoEsperado: number;
  efectivoNeto: number;
  diferencia: number;
  yapePlin: number;
  tarjeta: number;
  transferencia: number;
  cobrado: number;
  egresosGastos: number;
  egresosCompras: number;
  egresosOtros: number;
  cierresAutomaticos: number;
  requiereArqueo: boolean;
  generadaEn: string;
  generadaPor: string;
};

/** La Caja Maestra de un día (solo gerencia y administración: lo exige la base). */
export async function cajaMaestra(empresaId: string, fecha: string): Promise<CajaMaestra | null> {
  const supabase = await clienteServidor();
  const { data: m } = await supabase.from("caja_maestra_diaria").select("*").eq("empresa_id", empresaId).eq("fecha", fecha).maybeSingle();
  if (!m) return null;
  type Medio = { cobros: Num; ingresos: Num; egresos: Num; gastos?: Num; compras?: Num };
  const cajas = ((m.cajas ?? []) as Record<string, unknown>[]).map((c) => {
    const medios = (c.medios ?? {}) as Record<string, Medio>;
    const porMedio = Object.fromEntries(
      Object.keys(MEDIOS).map((k) => {
        const x = medios[k] ?? { cobros: 0, ingresos: 0, egresos: 0 };
        return [k, { cobros: n(x.cobros), ingresos: n(x.ingresos), egresos: n(x.egresos), gastos: n(x.gastos ?? 0), compras: n(x.compras ?? 0) }];
      }),
    ) as CajaDelDia["porMedio"];
    return {
      id: String(c.id),
      area: c.tipo as AreaCaja,
      tipoCierre: c.tipo_cierre as CajaDelDia["tipoCierre"],
      abiertaEn: String(c.abierta_en),
      cerradaEn: (c.cerrada_en as string) ?? null,
      abiertaPor: (c.abierta_por as string) ?? null,
      cerradaPor: (c.cerrada_por as string) ?? null,
      montoInicial: n(c.monto_inicial as Num),
      esperado: n(c.esperado as Num),
      contado: c.contado == null ? null : n(c.contado as Num),
      diferencia: c.diferencia == null ? null : n(c.diferencia as Num),
      requiereArqueo: Boolean(c.requiere_arqueo),
      porMedio,
    };
  });
  return {
    fecha: m.fecha,
    cajas,
    efectivoEsperado: n(m.efectivo_esperado),
    efectivoNeto: n(m.efectivo_neto),
    diferencia: n(m.diferencia),
    yapePlin: n(m.yape_plin),
    tarjeta: n(m.tarjeta),
    transferencia: n(m.transferencia),
    cobrado: n(m.cobrado),
    egresosGastos: n(m.egresos_gastos),
    egresosCompras: n(m.egresos_compras),
    egresosOtros: n(m.egresos_otros),
    cierresAutomaticos: m.cierres_automaticos,
    requiereArqueo: m.requiere_arqueo,
    generadaEn: m.generada_en,
    generadaPor: m.generada_por,
  };
}

/** Días con Caja Maestra (los últimos), para moverse entre ellos. */
export async function diasConMaestra(empresaId: string, limite = 31): Promise<{ fecha: string; requiereArqueo: boolean }[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("caja_maestra_diaria").select("fecha, requiere_arqueo").eq("empresa_id", empresaId).order("fecha", { ascending: false }).limit(limite);
  return (data ?? []).map((d) => ({ fecha: d.fecha, requiereArqueo: d.requiere_arqueo }));
}
