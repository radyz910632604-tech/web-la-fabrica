import "server-only";
import { clienteServidor } from "../supabase/servidor";
import { enSoles, manoObra, montoNeto, redondear, saldo as calcularSaldo, utilidad as calcularUtilidad } from "../dinero";
import { limitesDiaLima } from "./consultas";

/**
 * Consultas de dinero. Leen con la sesión de quien navega: si su rol no puede
 * ver compras, ventas o sueldos, la base le devuelve listas vacías.
 */

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type ConfigDinero = { tasaIgv: number; regla: "prorrateo_mensual" | "fijo_por_servicio"; margenMinimo: number; horasSinCambio: number };

export async function configDinero(empresaId: string): Promise<ConfigDinero> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("configuracion_empresa")
    .select("tasa_igv, regla_mano_obra, margen_minimo_pct, horas_orden_sin_cambio")
    .eq("empresa_id", empresaId)
    .single();
  return {
    tasaIgv: n(data?.tasa_igv ?? 0.18),
    regla: (data?.regla_mano_obra ?? "prorrateo_mensual") as ConfigDinero["regla"],
    margenMinimo: n(data?.margen_minimo_pct ?? 20),
    horasSinCambio: Number(data?.horas_orden_sin_cambio ?? 48),
  };
}

/**
 * Costo mensual vigente de cada persona (vacío si quien mira no ve sueldos).
 * Con `antesDe` ("2026-10-01"), el que regía antes de ese día: así un mes
 * pasado usa el sueldo de entonces y no cuenta a quien aún no trabajaba.
 */
export async function costosVigentes(empresaId: string, antesDe?: string): Promise<Map<string, number>> {
  const supabase = await clienteServidor();
  let q = supabase.from("costos_personal").select("perfil_id, costo_mensual, vigente_desde").eq("empresa_id", empresaId);
  if (antesDe) q = q.lt("vigente_desde", antesDe);
  const { data } = await q.order("vigente_desde", { ascending: true });
  const mapa = new Map<string, number>();
  for (const c of data ?? []) mapa.set(c.perfil_id, n(c.costo_mensual));
  return mapa;
}

/** Inicio de un mes de Lima ("2026-11") y del siguiente. */
export function limitesMes(mes: string): { desde: Date; hasta: Date; desdeDia: string; hastaDia: string } {
  const [a, m] = mes.split("-").map(Number);
  const siguiente = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 7);
  return { desde: limitesDiaLima(`${mes}-01`).desde, hasta: limitesDiaLima(`${siguiente}-01`).desde, desdeDia: `${mes}-01`, hastaDia: `${siguiente}-01` };
}

export type DineroOrden = {
  verVentas: boolean;
  verUtilidad: boolean;
  comprobantes: { id: string; tipo: string; serie: string; numero: string; fecha: string; total: number; sinIgv: number; estado: string; detalle: string | null }[];
  notas: { id: string; comprobanteId: string; serie: string; numero: string; fecha: string; total: number; sinIgv: number; estado: string; motivoCodigo: string; motivo: string | null }[];
  pagos: { id: string; monto: number; tipo: string; medio: string; pagadoEn: string; estado: string; operacion: string | null }[];
  cotizaciones: { id: string; version: number; adicional: boolean; estado: string; total: number; medio: string | null; items: { descripcion: string; tipo: string; cantidad: number; total: number }[] }[];
  repuestos: { descripcion: string; cantidad: number; sinIgv: number; deInventario?: boolean }[];
  /** Recibos de venta (el vigente, si hay, y los anulados). */
  recibos: { id: string; numero: number; emitidoEn: string; total: number; sinIgv: number; estado: string }[];
  ventaSinIgv: number;
  comprasSinIgv: number;
  manoObra: number | null;
  utilidad: number | null;
  margen: number | null;
  aCobrar: number;
  pagado: number;
  saldo: number;
};

/** Todo el dinero de una orden (ventas, cobros, cotizaciones, compras y utilidad). */
export async function dineroDeOrden(
  empresaId: string,
  ordenId: string,
  permisos: { verVentas: boolean; verUtilidad: boolean },
  orden: { tecnicoId: string | null; entregadoEn: string | null },
): Promise<DineroOrden> {
  const supabase = await clienteServidor();
  const [{ data: comps }, { data: pagos }, { data: cots }, { data: items }, config, { data: notasCrudas }, { data: recibosCrudos }] = await Promise.all([
    supabase.from("comprobantes_venta").select("id, tipo, serie, numero, fecha_emision, total, subtotal_sin_igv, estado, detalle").eq("orden_id", ordenId).order("fecha_emision"),
    supabase.from("pagos").select("id, monto, tipo, medio, pagado_en, estado, numero_operacion").eq("orden_id", ordenId).order("pagado_en"),
    supabase.from("cotizaciones").select("id, version, es_adicional, estado, total, aprobada_por_medio, cotizacion_items (descripcion, tipo, cantidad, total)").eq("orden_id", ordenId).order("version"),
    supabase.from("compra_items").select("descripcion, cantidad, subtotal_sin_igv, compras!inner (estado, moneda, tipo_cambio)").eq("orden_id", ordenId),
    configDinero(empresaId),
    supabase.from("notas_credito").select("id, comprobante_id, serie, numero, fecha_emision, total, subtotal_sin_igv, estado, motivo_codigo, motivo").eq("orden_id", ordenId).order("fecha_emision"),
    supabase.from("recibos").select("id, numero, emitido_en, total, subtotal_sin_igv, estado").eq("orden_id", ordenId).order("numero"),
  ]);
  const recibos = (recibosCrudos ?? []).map((r) => ({ id: r.id, numero: r.numero, emitidoEn: r.emitido_en, total: n(r.total), sinIgv: n(r.subtotal_sin_igv), estado: r.estado }));
  const reciboVigente = recibos.find((r) => r.estado !== "anulado");
  // Repuestos sacados del inventario: su costo (promedio al salir) también es de la orden.
  const { data: salidas } = await supabase
    .from("movimientos_inventario")
    .select("cantidad, costo_unitario_sin_igv, repuestos (nombre)")
    .eq("orden_id", ordenId)
    .eq("tipo", "salida")
    .eq("estado", "vigente");

  const notas = (notasCrudas ?? []).map((x) => ({
    id: x.id, comprobanteId: x.comprobante_id, serie: x.serie, numero: x.numero, fecha: x.fecha_emision, total: n(x.total), sinIgv: n(x.subtotal_sin_igv), estado: x.estado, motivoCodigo: x.motivo_codigo, motivo: x.motivo,
  }));
  const notasVigentes = notas.filter((x) => x.estado === "confirmado");
  const comprobantes = (comps ?? []).map((c) => ({
    id: c.id, tipo: c.tipo, serie: c.serie, numero: c.numero, fecha: c.fecha_emision, total: n(c.total), sinIgv: n(c.subtotal_sin_igv), estado: c.estado, detalle: c.detalle,
  }));
  const vigentes = comprobantes.filter((c) => c.estado === "confirmado");
  const pagosLista = (pagos ?? []).map((p) => ({ id: p.id, monto: n(p.monto), tipo: p.tipo, medio: p.medio, pagadoEn: p.pagado_en, estado: p.estado, operacion: p.numero_operacion }));
  const cotizaciones = (cots ?? []).map((c) => ({
    id: c.id, version: c.version, adicional: c.es_adicional, estado: c.estado, total: n(c.total), medio: c.aprobada_por_medio,
    items: ((c.cotizacion_items ?? []) as { descripcion: string; tipo: string; cantidad: Num; total: Num }[]).map((i) => ({ descripcion: i.descripcion, tipo: i.tipo, cantidad: n(i.cantidad), total: n(i.total) })),
  }));
  type ItemCrudo = { descripcion: string; cantidad: Num; subtotal_sin_igv: Num; compras: { estado: string; moneda: "PEN" | "USD"; tipo_cambio: Num } | { estado: string; moneda: "PEN" | "USD"; tipo_cambio: Num }[] };
  const repuestos = ((items ?? []) as ItemCrudo[])
    .map((i) => ({ ...i, compra: Array.isArray(i.compras) ? i.compras[0] : i.compras }))
    .filter((i) => i.compra?.estado === "confirmado")
    .map((i) => ({ descripcion: i.descripcion, cantidad: n(i.cantidad), sinIgv: enSoles(n(i.subtotal_sin_igv), i.compra.moneda, n(i.compra.tipo_cambio)) }) as DineroOrden["repuestos"][number]);
  type SalidaCruda = { cantidad: Num; costo_unitario_sin_igv: Num; repuestos: { nombre: string } | { nombre: string }[] | null };
  for (const x of (salidas ?? []) as SalidaCruda[]) {
    const rep = Array.isArray(x.repuestos) ? x.repuestos[0] : x.repuestos;
    const cant = -n(x.cantidad);
    repuestos.push({ descripcion: rep?.nombre ?? "Repuesto", cantidad: cant, sinIgv: redondear(cant * n(x.costo_unitario_sin_igv)), deInventario: true });
  }

  // La venta es la boleta o factura; si no hay, el recibo de venta del taller.
  const ventaSinIgv = vigentes.length
    ? redondear(vigentes.reduce((a, c) => a + c.sinIgv, 0) - notasVigentes.reduce((a, x) => a + x.sinIgv, 0))
    : (reciboVigente?.sinIgv ?? 0);
  const comprasSinIgv = redondear(repuestos.reduce((a, r) => a + r.sinIgv, 0));
  const s = calcularSaldo({
    totalComprobantes: redondear(vigentes.reduce((a, c) => a + c.total, 0) - notasVigentes.reduce((a, x) => a + x.total, 0)),
    totalCotizacionesAprobadas: redondear(cotizaciones.filter((c) => c.estado === "aprobada").reduce((a, c) => a + c.total, 0)),
    pagado: redondear(pagosLista.filter((p) => p.estado === "confirmado").reduce((a, p) => a + montoNeto(p), 0)),
    conComprobante: vigentes.length > 0,
  });

  let mo: number | null = null;
  let util: number | null = null;
  let margen: number | null = null;
  if (permisos.verUtilidad) {
    mo = await manoObraDeOrden(empresaId, ordenId, config.regla, orden);
    const u = calcularUtilidad(ventaSinIgv, comprasSinIgv, mo);
    util = u.utilidad;
    margen = u.margen;
  }

  return {
    verVentas: permisos.verVentas,
    verUtilidad: permisos.verUtilidad,
    recibos,
    comprobantes,
    notas,
    pagos: pagosLista,
    cotizaciones,
    repuestos,
    ventaSinIgv,
    comprasSinIgv,
    manoObra: mo,
    utilidad: util,
    margen,
    ...s,
  };
}

/** Mano de obra de una orden con la regla del taller. */
export async function manoObraDeOrden(
  empresaId: string,
  ordenId: string,
  regla: ConfigDinero["regla"],
  orden: { tecnicoId: string | null; entregadoEn: string | null },
): Promise<number> {
  const supabase = await clienteServidor();
  if (regla === "fijo_por_servicio") {
    const [{ data: servicios }, { data: fijos }] = await Promise.all([
      supabase.from("orden_servicios").select("servicio_id").eq("orden_id", ordenId),
      supabase.from("mano_obra_servicio").select("servicio_id, monto").eq("empresa_id", empresaId),
    ]);
    const mapa = new Map((fijos ?? []).map((f) => [f.servicio_id, n(f.monto)]));
    return manoObra("fijo_por_servicio", { montosFijos: (servicios ?? []).map((s) => mapa.get(s.servicio_id) ?? 0) });
  }
  if (!orden.tecnicoId) return 0;
  const mes = (orden.entregadoEn ?? new Date().toISOString()).slice(0, 7);
  const { desde, hasta, hastaDia } = limitesMes(mes);
  const costos = await costosVigentes(empresaId, hastaDia);
  const costo = costos.get(orden.tecnicoId) ?? 0;
  const { count } = await supabase
    .from("ordenes_trabajo")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("tecnico_id", orden.tecnicoId)
    .eq("estado", "entregado")
    .gte("entregado_en", desde.toISOString())
    .lt("entregado_en", hasta.toISOString());
  return manoObra("prorrateo_mensual", { costoMensualTecnico: costo, ordenesEntregadasMes: count ?? 0 });
}

export type ResumenMesDinero = { ventas: number; ventasConIgv: number; compras: number; manoObra: number; utilidad: number; entregados: number };

/**
 * Totales de un periodo: ventas y compras sin IGV (confirmadas, no anuladas) y
 * el costo del personal técnico prorrateado a los días del periodo.
 */
export async function totalesPeriodo(empresaId: string, desdeDia: string, hastaDia: string, fraccionMes: number, verSueldos: boolean): Promise<ResumenMesDinero> {
  const supabase = await clienteServidor();
  const [{ data: ventas }, { data: compras }, { count }, costos, tecnicos, { data: notas }] = await Promise.all([
    supabase.from("comprobantes_venta").select("subtotal_sin_igv, total").eq("empresa_id", empresaId).eq("estado", "confirmado").gte("fecha_emision", desdeDia).lt("fecha_emision", hastaDia),
    supabase.from("compras").select("subtotal_sin_igv, moneda, tipo_cambio").eq("empresa_id", empresaId).eq("estado", "confirmado").gte("fecha_emision", desdeDia).lt("fecha_emision", hastaDia),
    supabase
      .from("ordenes_trabajo")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("estado", "entregado")
      .gte("entregado_en", limitesDiaLima(desdeDia).desde.toISOString())
      .lt("entregado_en", limitesDiaLima(hastaDia).desde.toISOString()),
    verSueldos ? costosVigentes(empresaId, hastaDia) : Promise.resolve(new Map<string, number>()),
    verSueldos ? supabase.from("miembros").select("perfil_id").eq("empresa_id", empresaId).eq("rol", "tecnico").eq("activo", true) : Promise.resolve({ data: [] }),
    supabase.from("notas_credito").select("subtotal_sin_igv, total").eq("empresa_id", empresaId).eq("estado", "confirmado").gte("fecha_emision", desdeDia).lt("fecha_emision", hastaDia),
  ]);
  // Ventas netas: comprobantes menos sus notas de crédito, más los recibos de venta
  // de órdenes que no tienen boleta ni factura (así no se cuentan dos veces).
  const recibos = await recibosSinComprobante(empresaId, desdeDia, hastaDia);
  const ventasSin = redondear((ventas ?? []).reduce((a, v) => a + n(v.subtotal_sin_igv), 0) - (notas ?? []).reduce((a, x) => a + n(x.subtotal_sin_igv), 0) + recibos.sinIgv);
  const ventasCon = redondear((ventas ?? []).reduce((a, v) => a + n(v.total), 0) - (notas ?? []).reduce((a, x) => a + n(x.total), 0) + recibos.total);
  const comprasSin = redondear((compras ?? []).reduce((a, c) => a + enSoles(n(c.subtotal_sin_igv), c.moneda as "PEN" | "USD", n(c.tipo_cambio)), 0));
  const mo = redondear(((tecnicos.data ?? []) as { perfil_id: string }[]).reduce((a, t) => a + (costos.get(t.perfil_id) ?? 0), 0) * fraccionMes);
  return { ventas: ventasSin, ventasConIgv: ventasCon, compras: comprasSin, manoObra: mo, utilidad: redondear(ventasSin - comprasSin - mo), entregados: count ?? 0 };
}

/** Recibos de venta del periodo cuyas órdenes no tienen boleta ni factura confirmada. */
export async function recibosSinComprobante(empresaId: string, desdeDia: string, hastaDia: string): Promise<{ sinIgv: number; total: number; ordenes: string[] }> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("recibos")
    .select("orden_id, subtotal_sin_igv, total")
    .eq("empresa_id", empresaId)
    .eq("estado", "confirmado")
    .gte("emitido_en", limitesDiaLima(desdeDia).desde.toISOString())
    .lt("emitido_en", limitesDiaLima(hastaDia).desde.toISOString());
  const lista = data ?? [];
  if (!lista.length) return { sinIgv: 0, total: 0, ordenes: [] };
  const { data: conComp } = await supabase.from("comprobantes_venta").select("orden_id").eq("estado", "confirmado").in("orden_id", lista.map((r) => r.orden_id));
  const excluir = new Set((conComp ?? []).map((c) => c.orden_id));
  const quedan = lista.filter((r) => !excluir.has(r.orden_id));
  return {
    sinIgv: redondear(quedan.reduce((a, r) => a + n(r.subtotal_sin_igv), 0)),
    total: redondear(quedan.reduce((a, r) => a + n(r.total), 0)),
    ordenes: quedan.map((r) => r.orden_id),
  };
}

export type CuentaOrden = {
  id: string;
  numero: number;
  placa: string;
  cliente: string | null;
  estado: string;
  aCobrar: number;
  pagado: number;
  saldo: number;
  tieneComprobante: boolean;
};

/** Estado de cuenta de las órdenes recientes (para cobros, deudas, cierre y alertas). */
export async function cuentasDeOrdenes(empresaId: string, ordenes: { id: string; numero: number; placa: string; cliente: string | null; estado: string }[]): Promise<CuentaOrden[]> {
  if (ordenes.length === 0) return [];
  const supabase = await clienteServidor();
  const ids = ordenes.map((o) => o.id);
  const [{ data: comps }, { data: cots }, { data: pagos }, { data: notas }] = await Promise.all([
    supabase.from("comprobantes_venta").select("orden_id, total").eq("empresa_id", empresaId).eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("cotizaciones").select("orden_id, total").eq("empresa_id", empresaId).eq("estado", "aprobada").in("orden_id", ids),
    supabase.from("pagos").select("orden_id, monto, tipo").eq("empresa_id", empresaId).eq("estado", "confirmado").in("orden_id", ids),
    supabase.from("notas_credito").select("orden_id, total").eq("empresa_id", empresaId).eq("estado", "confirmado").in("orden_id", ids),
  ]);
  const sumar = (filas: { orden_id: string | null; [k: string]: unknown }[] | null, campo: string) => {
    const m = new Map<string, number>();
    for (const f of filas ?? []) if (f.orden_id) m.set(f.orden_id, redondear((m.get(f.orden_id) ?? 0) + n(f[campo] as Num)));
    return m;
  };
  const porComp = sumar(comps, "total");
  const porCot = sumar(cots, "total");
  const porPago = sumar((pagos ?? []).map((p) => ({ orden_id: p.orden_id, monto: montoNeto({ tipo: p.tipo, monto: n(p.monto) }) })), "monto");
  const porNota = sumar(notas, "total");
  return ordenes.map((o) => {
    const s = calcularSaldo({
      totalComprobantes: redondear((porComp.get(o.id) ?? 0) - (porNota.get(o.id) ?? 0)),
      totalCotizacionesAprobadas: porCot.get(o.id) ?? 0,
      pagado: porPago.get(o.id) ?? 0,
      conComprobante: porComp.has(o.id),
    });
    return { ...o, ...s, tieneComprobante: porComp.has(o.id) };
  });
}
