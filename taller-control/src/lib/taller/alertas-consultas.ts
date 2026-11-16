import "server-only";
import { calcularAlertas, type Alerta, type CompraItemParaAlertas, type OrdenParaAlertas } from "../alertas";
import { enSoles, manoObra, montoNeto, redondear, saldo as calcularSaldo, utilidad } from "../dinero";
import { clienteServidor } from "../supabase/servidor";
import { listarOrdenes } from "./consultas";
import { configDinero, costosVigentes } from "./dinero-consultas";
import { numeroOrden } from "./estados";
import { formatearPlaca } from "../placas";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);
const uno = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined));

/**
 * Reúne lo necesario para las alertas: órdenes abiertas y entregadas en los
 * últimos 30 días, sus fotos, servicios, cotizaciones, comprobantes, pagos y
 * compras. Lee con la sesión de quien mira: sin permiso, no hay datos de dinero.
 */
export async function alertasDelTaller(empresaId: string, permisos: { verDinero: boolean; verMargen: boolean }, minutosAvisoEntrega = 120): Promise<Alerta[]> {
  const supabase = await clienteServidor();
  const ahora = new Date();
  const hace30 = new Date(ahora.getTime() - 30 * 24 * 3600 * 1000);
  const hace120 = new Date(ahora.getTime() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [abiertas, entregadas, config] = await Promise.all([
    listarOrdenes(empresaId, { estados: ["en_taller", "en_proceso", "esperando_repuesto", "listo"], limite: 150, orden: "reciente" }),
    listarOrdenes(empresaId, { estados: ["entregado"], limite: 120, orden: "reciente" }),
    configDinero(empresaId),
  ]);
  const ordenes = [...abiertas, ...entregadas.filter((o) => new Date(o.estadoCambiadoEn) >= hace30)];
  const ids = ordenes.map((o) => o.id);
  const vacio = Promise.resolve({ data: [] as never[] });

  const [fotos, servicios, cots, comps, pagos, items, sinOrden, fijos, costos, notasRes, salidasRes, repuestosRes, porConfirmarRes] = await Promise.all([
    ids.length ? supabase.from("archivos").select("orden_id").eq("tipo", "foto").in("orden_id", ids) : vacio,
    ids.length ? supabase.from("orden_servicios").select("orden_id, es_adicional, servicio_id").in("orden_id", ids) : vacio,
    ids.length && permisos.verDinero ? supabase.from("cotizaciones").select("orden_id, es_adicional, estado, total").in("orden_id", ids) : vacio,
    ids.length && permisos.verDinero ? supabase.from("comprobantes_venta").select("orden_id, subtotal_sin_igv, total, detalle").eq("estado", "confirmado").in("orden_id", ids) : vacio,
    ids.length && permisos.verDinero ? supabase.from("pagos").select("orden_id, monto, tipo").eq("estado", "confirmado").in("orden_id", ids) : vacio,
    supabase
      .from("compra_items")
      .select("orden_id, descripcion, cantidad, precio_unitario_sin_igv, subtotal_sin_igv, compras!inner (estado, fecha_emision, moneda, tipo_cambio, proveedores (razon_social))")
      .eq("empresa_id", empresaId)
      .eq("compras.estado", "confirmado")
      .gte("compras.fecha_emision", hace120),
    permisos.verDinero
      ? supabase.from("comprobantes_venta").select("serie, numero").eq("empresa_id", empresaId).eq("estado", "confirmado").is("orden_id", null)
      : vacio,
    permisos.verMargen && config.regla === "fijo_por_servicio" ? supabase.from("mano_obra_servicio").select("servicio_id, monto").eq("empresa_id", empresaId) : vacio,
    permisos.verMargen ? costosVigentes(empresaId) : Promise.resolve(new Map<string, number>()),
    ids.length && permisos.verDinero ? supabase.from("notas_credito").select("orden_id, subtotal_sin_igv, total").eq("estado", "confirmado").in("orden_id", ids) : vacio,
    ids.length ? supabase.from("movimientos_inventario").select("orden_id, cantidad, costo_unitario_sin_igv, repuestos (nombre)").eq("tipo", "salida").eq("estado", "vigente").in("orden_id", ids) : vacio,
    supabase.from("repuestos").select("codigo, nombre, stock, stock_minimo").eq("empresa_id", empresaId).eq("activo", true).gt("stock_minimo", 0),
    Promise.all([
      supabase.from("compras").select("serie, numero, tipo_comprobante, proveedores (razon_social)").eq("empresa_id", empresaId).eq("estado", "por_confirmar"),
      permisos.verDinero ? supabase.from("comprobantes_venta").select("serie, numero, tipo").eq("empresa_id", empresaId).eq("estado", "por_confirmar") : vacio,
      permisos.verDinero ? supabase.from("pagos").select("monto, medio").eq("empresa_id", empresaId).eq("estado", "por_confirmar") : vacio,
    ]),
  ]);

  const contar = <T extends { orden_id: string | null }>(filas: T[] | null, filtro: (f: T) => boolean = () => true) => {
    const m = new Map<string, number>();
    for (const f of filas ?? []) if (f.orden_id && filtro(f)) m.set(f.orden_id, (m.get(f.orden_id) ?? 0) + 1);
    return m;
  };
  const fotosPor = contar(fotos.data as { orden_id: string }[]);
  const servPor = contar(servicios.data as { orden_id: string }[]);
  const adicPor = contar(servicios.data as { orden_id: string; es_adicional: boolean }[], (s) => s.es_adicional);
  const cotsLista = (cots.data ?? []) as { orden_id: string; es_adicional: boolean; estado: string; total: Num }[];
  const compsLista = (comps.data ?? []) as { orden_id: string | null; subtotal_sin_igv: Num; total: Num; detalle: string | null }[];
  const pagosLista = (pagos.data ?? []) as { orden_id: string; monto: Num; tipo: string }[];
  const notasLista = (notasRes.data ?? []) as { orden_id: string | null; subtotal_sin_igv: Num; total: Num }[];

  type ItemCrudo = {
    orden_id: string | null;
    descripcion: string;
    cantidad: Num;
    precio_unitario_sin_igv: Num;
    subtotal_sin_igv: Num;
    compras: { fecha_emision: string; moneda: "PEN" | "USD"; tipo_cambio: Num; proveedores: { razon_social: string } | { razon_social: string }[] | null } | { fecha_emision: string; moneda: "PEN" | "USD"; tipo_cambio: Num; proveedores: { razon_social: string } | { razon_social: string }[] | null }[];
  };
  const itemsLista = ((items.data ?? []) as ItemCrudo[]).map((i) => {
    const c = uno(i.compras)!;
    return {
      ordenId: i.orden_id,
      descripcion: i.descripcion,
      fecha: c.fecha_emision,
      proveedor: uno(c.proveedores)?.razon_social ?? "Proveedor",
      precio: enSoles(n(i.precio_unitario_sin_igv), c.moneda, n(c.tipo_cambio)),
      sinIgv: enSoles(n(i.subtotal_sin_igv), c.moneda, n(c.tipo_cambio)),
    };
  });

  // Repuestos sacados del inventario: cuentan como costo de la orden y deben cobrarse.
  type SalidaCruda = { orden_id: string; cantidad: Num; costo_unitario_sin_igv: Num; repuestos: { nombre: string } | { nombre: string }[] | null };
  for (const x of (salidasRes.data ?? []) as SalidaCruda[]) {
    itemsLista.push({ ordenId: x.orden_id, descripcion: uno(x.repuestos)?.nombre ?? "Repuesto", fecha: "", proveedor: "", precio: 0, sinIgv: redondear(-n(x.cantidad) * n(x.costo_unitario_sin_igv)) });
  }

  // Mano de obra por orden (solo para el margen de gerencia).
  const fijoPor = new Map(((fijos.data ?? []) as { servicio_id: string; monto: Num }[]).map((f) => [f.servicio_id, n(f.monto)]));
  const entregadasPorTecnicoMes = new Map<string, number>();
  for (const o of entregadas) if (o.tecnicoId) {
    const k = `${o.tecnicoId}|${o.estadoCambiadoEn.slice(0, 7)}`;
    entregadasPorTecnicoMes.set(k, (entregadasPorTecnicoMes.get(k) ?? 0) + 1);
  }

  const paraAlertas: OrdenParaAlertas[] = ordenes.map((o) => {
    const susComps = compsLista.filter((c) => c.orden_id === o.id);
    const susNotas = notasLista.filter((x) => x.orden_id === o.id);
    const ventaSinIgv = redondear(susComps.reduce((a, c) => a + n(c.subtotal_sin_igv), 0) - susNotas.reduce((a, x) => a + n(x.subtotal_sin_igv), 0));
    const susItems = itemsLista.filter((i) => i.ordenId === o.id);
    const s = calcularSaldo({
      totalComprobantes: redondear(susComps.reduce((a, c) => a + n(c.total), 0) - susNotas.reduce((a, x) => a + n(x.total), 0)),
      totalCotizacionesAprobadas: redondear(cotsLista.filter((c) => c.orden_id === o.id && c.estado === "aprobada").reduce((a, c) => a + n(c.total), 0)),
      pagado: redondear(pagosLista.filter((p) => p.orden_id === o.id).reduce((a, p) => a + montoNeto({ tipo: p.tipo, monto: n(p.monto) }), 0)),
      conComprobante: susComps.length > 0,
    });
    let margen: number | null = null;
    if (permisos.verMargen && o.estado === "entregado" && ventaSinIgv > 0) {
      const mo =
        config.regla === "fijo_por_servicio"
          ? manoObra("fijo_por_servicio", { montosFijos: ((servicios.data ?? []) as { orden_id: string; servicio_id: string | null }[]).filter((x) => x.orden_id === o.id).map((x) => fijoPor.get(x.servicio_id ?? "") ?? 0) })
          : o.tecnicoId
            ? manoObra("prorrateo_mensual", { costoMensualTecnico: costos.get(o.tecnicoId) ?? 0, ordenesEntregadasMes: entregadasPorTecnicoMes.get(`${o.tecnicoId}|${o.estadoCambiadoEn.slice(0, 7)}`) ?? 1 })
            : 0;
      margen = utilidad(ventaSinIgv, redondear(susItems.reduce((a, i) => a + i.sinIgv, 0)), mo).margen;
    }
    return {
      id: o.id,
      numero: numeroOrden(o.numero),
      estado: o.estado,
      estadoCambiadoEn: o.estadoCambiadoEn,
      fotos: fotosPor.get(o.id) ?? 0,
      servicios: servPor.get(o.id) ?? 0,
      adicionales: adicPor.get(o.id) ?? 0,
      cotizacionesAdicionalesAprobadas: cotsLista.filter((c) => c.orden_id === o.id && c.es_adicional && c.estado === "aprobada").length,
      tieneComprobante: susComps.length > 0,
      detalleComprobantes: susComps.map((c) => c.detalle ?? "").join(" "),
      repuestosComprados: susItems.map((i) => i.descripcion),
      saldo: permisos.verDinero ? s.saldo : null,
      ventaSinIgv: permisos.verMargen ? ventaSinIgv : null,
      margen,
      entregaPrometida: o.entregaPrometida,
      placa: formatearPlaca(o.placa),
    };
  });

  const stockBajo = ((repuestosRes.data ?? []) as { codigo: string; nombre: string; stock: Num; stock_minimo: Num }[])
    .filter((r) => n(r.stock) <= n(r.stock_minimo))
    .map((r) => ({ codigo: r.codigo, nombre: r.nombre, stock: n(r.stock), minimo: n(r.stock_minimo) }));
  const [comprasPc, ventasPc, pagosPc] = porConfirmarRes;
  const porConfirmar = [
    ...((comprasPc.data ?? []) as { serie: string | null; numero: string | null; proveedores: { razon_social: string } | { razon_social: string }[] | null }[]).map(
      (c) => ({ texto: `La compra ${c.serie ? `${c.serie}-${c.numero} ` : ""}de ${uno(c.proveedores)?.razon_social ?? "un proveedor"}`, href: "/compras?ver=por-confirmar" }),
    ),
    ...((ventasPc.data ?? []) as { serie: string; numero: string; tipo: string }[]).map((c) => ({ texto: `La ${c.tipo} ${c.serie}-${c.numero}`, href: "/ventas?ver=por-confirmar" })),
    ...((pagosPc.data ?? []) as { monto: Num; medio: string }[]).map((p) => ({ texto: `Un pago de S/ ${n(p.monto).toFixed(2)} (${p.medio})`, href: "/cobros?ver=por-confirmar" })),
  ];

  const itemsCompra: CompraItemParaAlertas[] = itemsLista.filter((i) => i.fecha).map((i) => ({ proveedor: i.proveedor, descripcion: i.descripcion, precioUnitarioSinIgv: i.precio, fecha: i.fecha }));
  return calcularAlertas({
    ahora,
    ordenes: paraAlertas,
    itemsCompra,
    comprobantesSinOrden: ((sinOrden.data ?? []) as { serie: string; numero: string }[]).map((c) => `${c.serie}-${c.numero}`),
    horasSinCambio: config.horasSinCambio,
    margenMinimoPct: config.margenMinimo,
    stockBajo,
    porConfirmar,
    verDinero: permisos.verDinero,
    verMargen: permisos.verMargen,
    minutosAvisoEntrega,
  });
}
