import "server-only";
import { MEDIOS, MOTIVOS_NOTA, montoNeto, redondear, TIPO_PAGO_CORTO, type MedioPago } from "../dinero";
import { formatearCelular } from "../celulares";
import { NOMBRE_ROL, type Rol } from "../roles";
import type { Contexto } from "../sesion";
import { clienteServidor } from "../supabase/servidor";
import { detalleCaja } from "../taller/caja-consultas";
import { cierreDelDia } from "../taller/cierre-consultas";
import { nombresPersonal } from "../taller/consultas";
import { dineroDeOrden } from "../taller/dinero-consultas";
import { CARROCERIAS as CARROCERIAS_ES, COMBUSTIBLES, numeroOrden, TRANSMISIONES } from "../taller/estados";
const CARROCERIAS: Record<string, string> = CARROCERIAS_ES;
import { mesesHasta, personalDelMes, reporteMensual, sumarFilas } from "../taller/reportes";
import { cantidadTexto, valorStock } from "../inventario";
import { kardex, listarRepuestos, repuesto } from "../taller/inventario-consultas";
import { montoEnLetras } from "../letras";
import { Documento, fechaCorta, fechaHora, fechaHoraLarga, importe, soles, type DatosTaller } from "./documento";

/**
 * Cada documento lee con la sesión de quien lo pide: si su rol no puede ver
 * algo, la base no se lo da y el PDF no se arma (responde «no encontrado»).
 */

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);
const uno = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : (x ?? undefined));
export type ModoIgv = "con" | "sin";
export type Pdf = { bytes: Uint8Array; archivo: string } | null;

const DOC: Record<string, string> = { dni: "DNI", ruc: "RUC", ce: "C.E." };
const DOC_LARGO: Record<string, string> = { dni: "DOCUMENTO NACIONAL DE IDENTIDAD (DNI)", ruc: "R.U.C.", ce: "CARNÉ DE EXTRANJERÍA" };

/** Datos del taller para la cabecera, con su logo si lo subieron en Configuración. */
async function base(ctx: Contexto): Promise<{ taller: DatosTaller; pie: string }> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("empresas").select("nombre, razon_social, ruc, direccion, telefono, correo, lema, logo_ruta").eq("id", ctx.taller.id).single();
  let logo: DatosTaller["logo"] = null;
  if (data?.logo_ruta) {
    const { data: archivo } = await supabase.storage.from("marca").download(data.logo_ruta);
    if (archivo) {
      const bytes = new Uint8Array(await archivo.arrayBuffer());
      logo = { bytes, tipo: bytes[0] === 0x89 && bytes[1] === 0x50 ? "png" : "jpg" };
    }
  }
  return {
    taller: { nombre: data?.nombre ?? ctx.taller.nombre, razonSocial: data?.razon_social, ruc: data?.ruc, direccion: data?.direccion, telefono: data?.telefono, correo: data?.correo, lema: data?.lema, logo },
    pie: `Generado con Taller Control el ${fechaHora(new Date().toISOString())} por ${ctx.perfil.nombre}`,
  };
}

const carro = (v?: { placa?: string | null; marca?: string | null; modelo?: string | null; anio?: number | null; color?: string | null }) =>
  [v?.marca, v?.modelo, v?.anio ? String(v.anio) : null, v?.color].filter(Boolean).join(" ") || null;
const placa = (p?: string | null) => (p && /^[A-Z0-9]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : (p ?? null));
const telefono = (c?: string | null) => (c ? c.replace(/^\+51(\d{9})$/, "+51 $1") : null);
const docCliente = (cl?: { tipo_documento?: string | null; numero_documento?: string | null }) =>
  cl?.numero_documento ? `${DOC[cl.tipo_documento ?? ""] ?? ""} ${cl.numero_documento}`.trim() : null;

/** Totales para el pie del documento: Otros cargos, Gravado/Exento, Subtotal, Descuento, IGV. */
function gruposTotales(sinIgv: number, igv: number, total: number, tasa: number): [string, string][][] {
  return [
    [
      ["Otros Cargos", soles(0)],
      ...(tasa > 0 ? ([["Total Gravado", soles(sinIgv)]] as [string, string][]) : []),
      ["Total Exento", soles(tasa > 0 ? 0 : total)],
    ],
    [
      ["Subtotal", soles(tasa > 0 ? sinIgv : total)],
      ["Descuento", soles(0)],
      [`IGV${tasa > 0 ? ` ${Math.round(tasa * 100)}%` : ""}`, soles(igv)],
    ],
  ];
}

type ItemCot = { tipo: string; descripcion: string; cantidad: Num; precio_unitario_total: Num; subtotal_sin_igv: Num; total: Num };

/** Filas CANTIDAD · DESCRIPCIÓN · UNITARIO · DESC. · IMP · TOTAL. */
function filasDetalle(items: ItemCot[], tasa: number, verSinIgv: boolean): string[][] {
  return items.map((i) => {
    const cant = n(i.cantidad);
    const monto = verSinIgv ? n(i.subtotal_sin_igv) : n(i.total);
    return [cant.toFixed(2), i.descripcion.toUpperCase(), importe(monto / cant), "0.00%", tasa > 0 ? "IGV" : "Exe", importe(monto)];
  });
}
const COLUMNAS_DETALLE = [
  { titulo: "Cantidad", ancho: 0.9, alinear: "der" as const },
  { titulo: "Descripción", ancho: 5 },
  { titulo: "Unitario", ancho: 1.2, alinear: "der" as const },
  { titulo: "Desc.", ancho: 0.9, alinear: "der" as const },
  { titulo: "Imp", ancho: 0.7 },
  { titulo: "Total", ancho: 1.2, alinear: "der" as const },
];

// ---------------------------------------------------------------------------
// Proforma (cotización)
// ---------------------------------------------------------------------------
export async function pdfCotizacion(ctx: Contexto, id: string, modo: ModoIgv): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: c } = await supabase
    .from("cotizaciones")
    .select("version, es_adicional, estado, respuesta_en, aprobada_por_medio, tasa_igv, subtotal_sin_igv, igv, total, creado_en, cotizacion_items (tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total), ordenes_trabajo (numero, kilometraje_ingreso, vehiculos (placa, marca, modelo, anio, color), clientes (nombre, celular, tipo_documento, numero_documento))")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!c) return null;
  const o = uno(c.ordenes_trabajo);
  const v = uno(o?.vehiculos);
  const cl = uno(o?.clientes);
  const tasa = n(c.tasa_igv);
  const { taller, pie } = await base(ctx);
  const numero = `N° ${o ? String(o.numero).padStart(6, "0") : ""}-${c.version}`;
  const vence = new Date(new Date(c.creado_en).getTime() + 30 * 86_400_000).toISOString();
  const d = await Documento.crear(taller, c.es_adicional ? "Proforma adicional" : "Proforma", numero, pie, {
    colorTitulo: "azul",
    cabecera: [
      ["Fecha", fechaHoraLarga(c.creado_en).replace(/^(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1")],
      ["Fecha Vencimiento", fechaHoraLarga(vence).slice(0, 10)],
      ["Orden", o ? numeroOrden(o.numero) : null],
    ],
  });
  d.recuadro(null, [
    ["Cliente", cl?.nombre],
    ["Documento", docCliente(cl)],
    ["Teléfono", telefono(cl?.celular)],
    ["Placa", placa(v?.placa)],
    ["Vehículo", carro(v)],
    ["Kilometraje", o?.kilometraje_ingreso != null ? `${Number(o.kilometraje_ingreso).toLocaleString("es-PE")} km` : null],
  ]);
  const verSinIgv = modo === "sin" && tasa > 0;
  d.tabla(COLUMNAS_DETALLE, filasDetalle((c.cotizacion_items ?? []) as ItemCot[], tasa, verSinIgv), { cebra: true });
  d.ultimaLinea();
  d.cierre(`Firmado por ${taller.razonSocial || taller.nombre}`, gruposTotales(n(c.subtotal_sin_igv), n(c.igv), n(c.total), tasa), ["Total", soles(n(c.total))]);
  const MEDIO: Record<string, string> = { whatsapp: "por WhatsApp", presencial: "en persona", llamada: "por llamada" };
  const estado = c.estado === "aprobada" ? `Aprobada por el cliente${c.aprobada_por_medio ? ` ${MEDIO[c.aprobada_por_medio]}` : ""}${c.respuesta_en ? ` el ${fechaCorta(c.respuesta_en)}` : ""}.` : c.estado === "rechazada" ? "El cliente no la aprobó." : "";
  d.nota(`PRECIOS SUJETOS A CAMBIOS SIN PREVIO AVISO.${estado ? ` ${estado}` : ""}`);
  return { bytes: await d.bytes(), archivo: `proforma-${numero.replace(/\D+/g, "-")}.pdf` };
}

// ---------------------------------------------------------------------------
// Orden de reparación
// ---------------------------------------------------------------------------
export async function pdfOrden(ctx: Contexto, id: string, verDinero: boolean): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: o } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, estado, tecnico_id, creado_por, entregado_en, listo_en, entrega_prometida, nivel_combustible, kilometraje_ingreso, observaciones_ingreso, ingresado_en, es_reingreso_garantia, vehiculos (placa, marca, modelo, anio, color, combustible, transmision, carroceria), clientes (nombre, celular, tipo_documento, numero_documento)")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!o) return null;
  const [{ data: servicios }, { data: avances }, { data: inicio }, nombres] = await Promise.all([
    supabase.from("orden_servicios").select("descripcion, es_adicional").eq("orden_id", id).order("creado_en"),
    supabase.from("orden_avances").select("texto, autor_id, creado_en").eq("orden_id", id).order("creado_en"),
    supabase.from("orden_estados_historial").select("cambiado_en").eq("orden_id", id).eq("estado_nuevo", "en_proceso").order("cambiado_en").limit(1),
    nombresPersonal(ctx.taller.id),
  ]);
  const v = uno(o.vehiculos);
  const cl = uno(o.clientes);
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, "Orden de reparación", "", pie, {
    destacados: [`Placa ${placa(v?.placa) ?? "—"}`, `No. ${String(o.numero).padStart(6, "0")}`],
    cabecera: [
      ["Fecha", fechaHora(o.ingresado_en)],
      ["Fecha inicio", inicio?.[0] ? fechaHora(inicio[0].cambiado_en) : "—"],
      ["Fecha final", o.listo_en ? fechaHora(o.listo_en) : "—"],
      ["Entrega prometida", o.entrega_prometida ? fechaHora(o.entrega_prometida) : null],
      ["Responsable", o.creado_por ? (nombres.get(o.creado_por) ?? null) : null],
    ],
  });
  d.recuadro(null, [
    ["Cliente", cl?.nombre],
    ["Identificación", cl?.numero_documento ?? null],
    ["Teléfono", cl?.celular ? formatearCelular(cl.celular) : null],
    ["Whatsapp", cl?.celular ? formatearCelular(cl.celular) : null],
  ]);
  d.recuadro(
    "Detalles del vehículo",
    [
      ["Placa", placa(v?.placa)],
      ["Marca", v?.marca],
      ["Modelo", v?.modelo],
      ["Estilo", v?.carroceria ? CARROCERIAS[v.carroceria] : null],
      ["Año", v?.anio ? String(v.anio) : null],
      ["Color", v?.color],
      ["Combustible", v?.combustible ? COMBUSTIBLES[v.combustible as keyof typeof COMBUSTIBLES] : null],
      ["Caja", v?.transmision ? TRANSMISIONES[v.transmision as keyof typeof TRANSMISIONES] : null],
      ["Kilometraje", o.kilometraje_ingreso != null ? `${Number(o.kilometraje_ingreso).toLocaleString("es-PE")} km` : null],
      ["Técnico", o.tecnico_id ? (nombres.get(o.tecnico_id) ?? null) : "Sin asignar"],
    ],
    { combustible: o.nivel_combustible ?? null },
  );

  // Con permiso de caja: el detalle con precios de lo aprobado; si no, solo los servicios.
  const dinero = verDinero ? await dineroDeOrden(ctx.taller.id, id, { verVentas: true, verUtilidad: false }, { tecnicoId: o.tecnico_id, entregadoEn: o.entregado_en }) : null;
  const items = dinero
    ? ((await supabase.from("cotizaciones").select("tasa_igv, cotizacion_items (tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, total)").eq("orden_id", id).eq("estado", "aprobada")).data ?? []).flatMap((c) => (c.cotizacion_items ?? []) as ItemCot[])
    : [];
  if (dinero && items.length) {
    d.tabla(
      [
        { titulo: "Cantidad", ancho: 0.9, alinear: "der" },
        { titulo: "Descripción", ancho: 6 },
        { titulo: "Unitario", ancho: 1.2, alinear: "der" },
        { titulo: "Total", ancho: 1.2, alinear: "der" },
      ],
      items.map((i) => [n(i.cantidad).toFixed(2), i.descripcion.toUpperCase(), importe(n(i.total) / n(i.cantidad)), importe(n(i.total))]),
      { cebra: true },
    );
    const productos = redondear(items.filter((i) => i.tipo === "repuesto").reduce((a, i) => a + n(i.total), 0));
    const serviciosTotal = redondear(items.filter((i) => i.tipo !== "repuesto").reduce((a, i) => a + n(i.total), 0));
    d.cierre("", [[["Productos", soles(productos)], ["Servicios", soles(serviciosTotal)]], [["Subtotal", soles(dinero.aCobrar)], ["Abonos", soles(dinero.pagado)]]], ["Total", soles(dinero.saldo)], { colorTotal: "rojo" });
  } else {
    d.tabla(
      [
        { titulo: "Cantidad", ancho: 0.9, alinear: "der" },
        { titulo: "Descripción", ancho: 6 },
        { titulo: "Tipo", ancho: 1.4 },
      ],
      (servicios ?? []).map((s) => ["1.00", s.descripcion.toUpperCase(), s.es_adicional ? "Adicional" : "Solicitado"]),
      { cebra: true },
    );
  }
  if (o.observaciones_ingreso) d.nota(o.observaciones_ingreso, "Observaciones de ingreso");
  if (o.es_reingreso_garantia) d.nota("Reingreso por garantía de un trabajo anterior.", "Garantía");
  if ((avances ?? []).length) {
    d.seccion("Avances");
    d.tabla(
      [
        { titulo: "Fecha", ancho: 1.3 },
        { titulo: "Avance", ancho: 4.5 },
        { titulo: "Quién", ancho: 1.4 },
      ],
      (avances ?? []).map((a) => [fechaHora(a.creado_en), a.texto, nombres.get(a.autor_id ?? "") ?? ""]),
    );
  }
  d.parrafo("El cliente declara que el vehículo se recibió en el estado descrito. El taller no se responsabiliza por objetos de valor no declarados.", { tam: 7.5, color: "tenue" });
  d.firmas(["Firma del cliente", "Recibido por el taller"]);
  return { bytes: await d.bytes(), archivo: `orden-${numeroOrden(o.numero)}.pdf` };
}

// ---------------------------------------------------------------------------
// Recibo de venta (lo que se le entrega al cliente al cobrar)
// ---------------------------------------------------------------------------
export async function pdfRecibo(ctx: Contexto, id: string): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: r } = await supabase
    .from("recibos")
    .select("id, numero, orden_id, emitido_en, tasa_igv, subtotal_sin_igv, igv, total, observaciones, estado, motivo_anulacion, creado_por")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!r) return null;
  const [{ data: o }, { data: cots }, { data: pagos }, nombres] = await Promise.all([
    supabase.from("ordenes_trabajo").select("numero, creado_por, kilometraje_ingreso, vehiculos (placa, marca, modelo, anio, color, carroceria), clientes (nombre, celular, tipo_documento, numero_documento)").eq("id", r.orden_id).maybeSingle(),
    supabase.from("cotizaciones").select("cotizacion_items (tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, total)").eq("orden_id", r.orden_id).eq("estado", "aprobada").order("version"),
    supabase.from("pagos").select("medio, tipo").eq("orden_id", r.orden_id).eq("estado", "confirmado").neq("tipo", "devolucion"),
    nombresPersonal(ctx.taller.id),
  ]);
  const v = uno(o?.vehiculos);
  const cl = uno(o?.clientes);
  const tasa = n(r.tasa_igv);
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, "Recibo", `N° ${r.numero}`, pie, {
    marcaAgua: r.estado === "anulado" ? "ANULADO" : "ORIGINAL",
    cabecera: [
      ["Número orden", o ? String(o.numero).padStart(6, "0") : null],
      ["Fecha", fechaHoraLarga(r.emitido_en)],
      ["Hecho por", nombres.get(r.creado_por ?? "") ?? null],
    ],
  });
  d.recuadro(null, [
    ["Cliente", cl?.nombre],
    ["Teléfono", telefono(cl?.celular)],
    [cl?.numero_documento ? (DOC_LARGO[cl.tipo_documento ?? ""] ?? "Documento") : "Documento", cl?.numero_documento ?? null],
  ]);
  d.recuadro("Información del vehículo", [
    ["Placa", v?.placa ?? null],
    ["Marca", v?.marca?.toUpperCase()],
    ["Modelo", v?.modelo?.toUpperCase()],
    ["Estilo", v?.carroceria ? CARROCERIAS[v.carroceria].toUpperCase() : null],
    ["Color", v?.color],
    ["Año", v?.anio ? String(v.anio) : null],
    ["Kilometraje", o?.kilometraje_ingreso != null ? String(o.kilometraje_ingreso) : null],
  ]);
  const items = (cots ?? []).flatMap((c) => (c.cotizacion_items ?? []) as ItemCot[]);
  d.tabla(COLUMNAS_DETALLE, filasDetalle(items, tasa, false));
  d.ultimaLinea();
  d.cierre("Recibe conforme (Cliente)", gruposTotales(n(r.subtotal_sin_igv), n(r.igv), n(r.total), tasa), ["Total", soles(n(r.total))]);
  const medios = [...new Set((pagos ?? []).map((p) => MEDIOS[p.medio as MedioPago]))];
  d.lineasEnRecuadro([
    ["Método de pago", medios.length ? medios.join(" + ") : "Pendiente de pago"],
    ["Monto en letras", montoEnLetras(n(r.total))],
  ]);
  const asesor = o?.creado_por ? nombres.get(o.creado_por) : null;
  d.nota([r.observaciones, asesor ? `ASESOR ${asesor.split(" ")[0].toUpperCase()}` : null, r.estado === "anulado" ? `ANULADO: ${r.motivo_anulacion}` : null].filter(Boolean).join(" · ") || "—", "Observaciones");
  return { bytes: await d.bytes(), archivo: `recibo-${r.numero}.pdf` };
}

/** Totales según el IGV del documento (resúmenes internos). */
function totalesIgv(sinIgv: number, igv: number, total: number, tasa: number): [string, string, boolean?][] {
  if (tasa === 0) return [["Total (operación sin IGV)", soles(total), true]];
  return [
    ["Op. gravada (sin IGV)", soles(sinIgv)],
    [`IGV ${Math.round(tasa * 100)} %`, soles(igv)],
    ["Total", soles(total), true],
  ];
}

// ---------------------------------------------------------------------------
// Recibo de pago y estado de cuenta (abonos)
// ---------------------------------------------------------------------------
export async function pdfPago(ctx: Contexto, id: string): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: p } = await supabase.from("pagos").select("id, orden_id, monto, tipo, medio, pagado_en, numero_operacion, estado, motivo_anulacion, creado_por").eq("id", id).eq("empresa_id", ctx.taller.id).maybeSingle();
  if (!p) return null;
  const [{ data: o }, nombres] = await Promise.all([
    supabase.from("ordenes_trabajo").select("numero, tecnico_id, entregado_en, vehiculos (placa, marca, modelo), clientes (nombre, celular)").eq("id", p.orden_id).maybeSingle(),
    nombresPersonal(ctx.taller.id),
  ]);
  const dinero = await dineroDeOrden(ctx.taller.id, p.orden_id, { verVentas: true, verUtilidad: false }, { tecnicoId: o?.tecnico_id ?? null, entregadoEn: o?.entregado_en ?? null });
  // Saldo justo después de este pago.
  const hasta = dinero.pagos.filter((x) => x.estado === "confirmado" && x.pagadoEn <= p.pagado_en);
  const pagadoHasta = redondear(hasta.reduce((a, x) => a + montoNeto(x), 0));
  const v = uno(o?.vehiculos);
  const cl = uno(o?.clientes);
  const { taller, pie } = await base(ctx);
  const numero = `R-${p.id.slice(0, 8).toUpperCase()}`;
  const d = await Documento.crear(taller, p.tipo === "devolucion" ? "Constancia de devolución" : "Constancia de pago", numero, pie);
  d.datos([
    ["Cliente", cl?.nombre],
    ["Celular", cl?.celular ? formatearCelular(cl.celular) : null],
    ["Orden", o ? numeroOrden(o.numero) : null],
    ["Placa", placa(v?.placa)],
    ["Fecha y hora", fechaHora(p.pagado_en)],
    ["Tipo", TIPO_PAGO_CORTO[p.tipo]],
    ["Medio", MEDIOS[p.medio as MedioPago]],
    ["N.º de operación", p.numero_operacion],
    ["Registró", nombres.get(p.creado_por ?? "") ?? null],
    ["Estado", p.estado === "anulado" ? `ANULADO: ${p.motivo_anulacion}` : "Confirmado"],
  ]);
  d.seccion("Cuenta de la orden");
  d.totales([
    [p.tipo === "devolucion" ? "Monto devuelto" : "Monto recibido", soles(n(p.monto)), true],
    ["Total a cobrar de la orden", soles(dinero.aCobrar)],
    ["Pagado hasta este recibo", soles(pagadoHasta)],
    [dinero.aCobrar - pagadoHasta < 0 ? "A favor del cliente" : "Saldo pendiente", soles(Math.abs(dinero.aCobrar - pagadoHasta)), true],
  ]);
  d.nota("Constancia interna del pago. El recibo de venta y la boleta o factura electrónica se entregan aparte.");
  d.firmas(["Cliente", "Caja"]);
  return { bytes: await d.bytes(), archivo: `constancia-${numero}.pdf` };
}

export async function pdfEstadoCuenta(ctx: Contexto, ordenId: string): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: o } = await supabase.from("ordenes_trabajo").select("numero, tecnico_id, entregado_en, vehiculos (placa, marca, modelo, anio), clientes (nombre, celular)").eq("id", ordenId).eq("empresa_id", ctx.taller.id).maybeSingle();
  if (!o) return null;
  const dinero = await dineroDeOrden(ctx.taller.id, ordenId, { verVentas: true, verUtilidad: false }, { tecnicoId: o.tecnico_id, entregadoEn: o.entregado_en });
  const v = uno(o.vehiculos);
  const cl = uno(o.clientes);
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, "Estado de cuenta", numeroOrden(o.numero), pie);
  d.datos([
    ["Cliente", cl?.nombre],
    ["Celular", cl?.celular ? formatearCelular(cl.celular) : null],
    ["Placa", placa(v?.placa)],
    ["Vehículo", carro(v)],
  ]);
  type Mov = { fecha: string; concepto: string; cargo: number; abono: number };
  const movs: Mov[] = [];
  const comps = dinero.comprobantes.filter((c) => c.estado === "confirmado");
  if (comps.length) for (const c of comps) movs.push({ fecha: c.fecha, concepto: `${c.tipo === "boleta" ? "Boleta" : "Factura"} ${c.serie}-${c.numero}`, cargo: c.total, abono: 0 });
  else for (const c of dinero.cotizaciones.filter((x) => x.estado === "aprobada")) movs.push({ fecha: "", concepto: `Cotización aprobada (versión ${c.version})`, cargo: c.total, abono: 0 });
  for (const x of dinero.notas.filter((y) => y.estado === "confirmado")) movs.push({ fecha: x.fecha, concepto: `Nota de crédito ${x.serie}-${x.numero} (${MOTIVOS_NOTA[x.motivoCodigo]})`, cargo: -x.total, abono: 0 });
  for (const p of dinero.pagos.filter((y) => y.estado === "confirmado"))
    movs.push({ fecha: p.pagadoEn, concepto: `${TIPO_PAGO_CORTO[p.tipo]} · ${MEDIOS[p.medio as MedioPago]}${p.operacion ? ` · Op. ${p.operacion}` : ""}`, cargo: p.tipo === "devolucion" ? p.monto : 0, abono: p.tipo === "devolucion" ? 0 : p.monto });
  movs.sort((a, b) => (a.fecha || "0").localeCompare(b.fecha || "0"));
  let corrido = 0;
  const filas = movs.map((m) => {
    corrido = redondear(corrido + m.cargo - m.abono);
    return [m.fecha ? fechaCorta(m.fecha) : "—", m.concepto, m.cargo ? soles(m.cargo) : "", m.abono ? soles(m.abono) : "", soles(corrido)];
  });
  d.seccion("Movimientos", "Cargos, notas de crédito, abonos y pagos");
  d.tabla(
    [
      { titulo: "Fecha", ancho: 1.1 },
      { titulo: "Concepto", ancho: 3.6 },
      { titulo: "Cargo", ancho: 1.2, alinear: "der" },
      { titulo: "Abono", ancho: 1.2, alinear: "der" },
      { titulo: "Saldo", ancho: 1.2, alinear: "der" },
    ],
    filas.length ? filas : [["—", "Sin movimientos todavía", "", "", soles(0)]],
  );
  d.totales([
    ["Total a cobrar", soles(dinero.aCobrar)],
    ["Total pagado", soles(dinero.pagado)],
    [dinero.saldo < 0 ? "A favor del cliente" : "Saldo pendiente", soles(Math.abs(dinero.saldo)), true],
  ]);
  return { bytes: await d.bytes(), archivo: `estado-de-cuenta-${numeroOrden(o.numero)}.pdf` };
}

// ---------------------------------------------------------------------------
// Comprobante registrado (resumen interno) y compra
// ---------------------------------------------------------------------------
export async function pdfComprobante(ctx: Contexto, id: string): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: c } = await supabase
    .from("comprobantes_venta")
    .select("id, tipo, serie, numero, fecha_emision, documento_cliente, tasa_igv, subtotal_sin_igv, igv, total, detalle, estado, motivo_anulacion, origen_datos, orden_id, ordenes_trabajo (numero, vehiculos (placa), clientes (nombre))")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!c) return null;
  const { data: notas } = await supabase.from("notas_credito").select("serie, numero, fecha_emision, motivo_codigo, motivo, subtotal_sin_igv, igv, total, estado").eq("comprobante_id", id).order("fecha_emision");
  const o = uno(c.ordenes_trabajo);
  const { taller, pie } = await base(ctx);
  const numero = `${c.serie}-${c.numero}`;
  const d = await Documento.crear(taller, c.tipo === "boleta" ? "Boleta (registro)" : "Factura (registro)", numero, pie);
  d.nota("Resumen interno del comprobante registrado en Taller Control. El comprobante electrónico válido es el que emitiste en tu sistema de facturación o en SUNAT.");
  d.datos([
    ["Fecha de emisión", fechaCorta(c.fecha_emision)],
    ["DNI o RUC del cliente", c.documento_cliente],
    ["Cliente", uno(o?.clientes)?.nombre],
    ["Orden", o ? numeroOrden(o.numero) : "Sin orden asignada"],
    ["Placa", placa(uno(o?.vehiculos)?.placa)],
    ["Origen", c.origen_datos === "xml_sunat" ? "Leído del XML de SUNAT" : "Registrado a mano"],
    ["Estado", c.estado === "anulado" ? `ANULADO: ${c.motivo_anulacion}` : "Vigente"],
  ]);
  if (c.detalle) {
    d.seccion("Detalle");
    d.parrafo(c.detalle);
  }
  d.totales(totalesIgv(n(c.subtotal_sin_igv), n(c.igv), n(c.total), n(c.tasa_igv)));
  const vigentes = (notas ?? []).filter((x) => x.estado === "confirmado");
  if ((notas ?? []).length) {
    d.seccion("Notas de crédito");
    d.tabla(
      [
        { titulo: "Nota", ancho: 1.2 },
        { titulo: "Fecha", ancho: 1 },
        { titulo: "Motivo", ancho: 3.2 },
        { titulo: "Total", ancho: 1.2, alinear: "der" },
      ],
      (notas ?? []).map((x) => [`${x.serie}-${x.numero}`, fechaCorta(x.fecha_emision), `${MOTIVOS_NOTA[x.motivo_codigo]}${x.motivo ? ` · ${x.motivo}` : ""}${x.estado === "anulado" ? " (anulada)" : ""}`, soles(-n(x.total))]),
    );
    const neto = n(c.total) - vigentes.reduce((a, x) => a + n(x.total), 0);
    d.totales([["Neto después de notas de crédito", soles(neto), true]]);
  }
  return { bytes: await d.bytes(), archivo: `${c.tipo}-${numero}.pdf` };
}

export async function pdfCompra(ctx: Contexto, id: string, modo: ModoIgv): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: k } = await supabase
    .from("compras")
    .select("tipo_comprobante, serie, numero, fecha_emision, moneda, tipo_cambio, tasa_igv, subtotal_sin_igv, igv, total, estado, motivo_anulacion, proveedores (razon_social, ruc), compra_items (descripcion, cantidad, precio_unitario_sin_igv, subtotal_sin_igv, total, destino, orden_id, ordenes_trabajo (numero))")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!k) return null;
  const pr = uno(k.proveedores);
  const { taller, pie } = await base(ctx);
  const numero = k.serie ? `${k.serie}-${k.numero}` : "Sin número";
  const d = await Documento.crear(taller, "Registro de compra", numero, pie);
  const TIPO: Record<string, string> = { factura: "Factura", boleta: "Boleta", nota_venta: "Nota de venta", ticket: "Ticket", sin_comprobante: "Sin comprobante" };
  const mon = k.moneda === "USD" ? "US$" : "S/";
  const dinero = (x: number) => (k.moneda === "USD" ? `US$ ${x.toFixed(2)}` : soles(x));
  d.datos([
    ["Proveedor", pr?.razon_social],
    ["RUC", pr?.ruc],
    ["Comprobante", `${TIPO[k.tipo_comprobante]} ${k.serie ? numero : ""}`.trim()],
    ["Fecha", fechaCorta(k.fecha_emision)],
    ["Moneda", k.moneda === "USD" ? `Dólares (cambio ${n(k.tipo_cambio)})` : "Soles"],
    ["Estado", k.estado === "anulado" ? `ANULADA: ${k.motivo_anulacion}` : "Vigente"],
  ]);
  const tasa = n(k.tasa_igv);
  const conIgv = modo === "con" && tasa > 0;
  type Item = { descripcion: string; cantidad: Num; subtotal_sin_igv: Num; total: Num; destino: string; ordenes_trabajo: { numero: number } | { numero: number }[] | null };
  d.seccion("Repuestos", conIgv ? `Precios con IGV (${mon})` : `Precios sin IGV (${mon})`);
  d.tabla(
    [
      { titulo: "Cant.", ancho: 0.6, alinear: "der" },
      { titulo: "Repuesto", ancho: 3.4 },
      { titulo: "Para", ancho: 1.3 },
      { titulo: "P. unit.", ancho: 1.2, alinear: "der" },
      { titulo: "Importe", ancho: 1.2, alinear: "der" },
    ],
    ((k.compra_items ?? []) as Item[]).map((i) => {
      const imp = conIgv ? n(i.total) : n(i.subtotal_sin_igv);
      const ord = uno(i.ordenes_trabajo);
      return [String(n(i.cantidad)), i.descripcion, ord ? numeroOrden(ord.numero) : "Stock", dinero(imp / n(i.cantidad)), dinero(imp)];
    }),
  );
  d.totales(tasa === 0 ? [["Total (sin crédito de IGV)", dinero(n(k.total)), true]] : [["Sin IGV", dinero(n(k.subtotal_sin_igv))], [`IGV ${Math.round(tasa * 100)} %`, dinero(n(k.igv))], ["Total", dinero(n(k.total)), true]]);
  return { bytes: await d.bytes(), archivo: `compra-${numero}.pdf` };
}

// ---------------------------------------------------------------------------
// Caja y cierre del día
// ---------------------------------------------------------------------------
export async function pdfCaja(ctx: Contexto, id: string): Promise<Pdf> {
  const [det, nombres] = await Promise.all([detalleCaja(ctx.taller.id, id), nombresPersonal(ctx.taller.id)]);
  if (!det) return null;
  const { caja } = det;
  const supabase = await clienteServidor();
  const vigentes = det.movimientos.filter((m) => m.estado !== "anulado");
  const pagos = vigentes.filter((m) => m.clase === "pago");
  const ids = [...new Set(pagos.map((p) => p.ordenId).filter(Boolean))] as string[];
  const { data: recibos } = ids.length ? await supabase.from("recibos").select("orden_id, numero").in("orden_id", ids).neq("estado", "anulado") : { data: [] };
  const reciboDe = new Map(((recibos ?? []) as { orden_id: string; numero: number }[]).map((r) => [r.orden_id, r.numero]));
  const medios = Object.keys(MEDIOS) as MedioPago[];
  type M = (typeof vigentes)[number];
  const suma = (lista: M[], medio?: MedioPago) => redondear(lista.filter((x) => !medio || x.medio === medio).reduce((a, x) => a + x.monto, 0));
  const ventas = pagos.filter((p) => p.tipo === "saldo");
  const abonos = pagos.filter((p) => p.tipo === "abono");
  const iniciales = pagos.filter((p) => p.tipo === "adelanto");
  const devoluciones = pagos.filter((p) => p.tipo === "devolucion");
  const entradas = vigentes.filter((m) => m.clase === "movimiento" && m.tipo === "ingreso");
  const salidas = vigentes.filter((m) => m.clase === "movimiento" && m.tipo === "egreso");
  const fila = (concepto: string, monto: number) => [concepto, importe(monto)];
  const total = (monto: number) => ["Total", soles(monto)];
  const cols = [
    { titulo: "Concepto", ancho: 4 },
    { titulo: "Monto", ancho: 1.4, alinear: "der" as const },
  ];

  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, caja.estado === "cerrada" ? "Arqueo de caja" : "Caja abierta", fechaCorta(caja.abiertaEn), pie, {
    cabecera: [
      ["Cajero", nombres.get(caja.abiertaPor ?? "") ?? null],
      ["Fecha de apertura", fechaHora(caja.abiertaEn)],
      ["Fecha de cierre", caja.cerradaEn ? fechaHora(caja.cerradaEn) : "Todavía abierta"],
      ["Cerró", caja.cerradaPor ? (nombres.get(caja.cerradaPor) ?? null) : null],
    ],
  });
  d.seccion("Ingreso ventas", "Pagos que cancelan la orden");
  d.tabla(cols, [...medios.map((m) => fila(`Ingreso ${MEDIOS[m].toLowerCase()}`, suma(ventas, m))), total(suma(ventas))], { resaltarUltima: true });
  d.seccion("Otras entradas");
  d.tabla(
    cols,
    [
      ...medios.map((m) => fila(`Ingreso abonos ${MEDIOS[m].toLowerCase()}`, suma(abonos, m))),
      ...medios.map((m) => fila(`Ingreso pago inicial ${MEDIOS[m].toLowerCase()}`, suma(iniciales, m))),
      fila("Ingreso entradas (mov. caja)", suma(entradas)),
      total(suma(abonos) + suma(iniciales) + suma(entradas)),
    ],
    { resaltarUltima: true },
  );
  d.seccion("Total consolidado por medio de pago");
  d.tabla(
    [
      { titulo: "Medio", ancho: 2 },
      { titulo: "Ventas", ancho: 1.1, alinear: "der" },
      { titulo: "Abonos", ancho: 1.1, alinear: "der" },
      { titulo: "Pago inicial", ancho: 1.1, alinear: "der" },
      { titulo: "Devoluciones", ancho: 1.1, alinear: "der" },
      { titulo: "Total", ancho: 1.1, alinear: "der" },
    ],
    [
      ...medios.map((m) => [MEDIOS[m], importe(suma(ventas, m)), importe(suma(abonos, m)), importe(suma(iniciales, m)), importe(-suma(devoluciones, m)), importe(suma(ventas, m) + suma(abonos, m) + suma(iniciales, m) - suma(devoluciones, m))]),
      ["Total", importe(suma(ventas)), importe(suma(abonos)), importe(suma(iniciales)), importe(-suma(devoluciones)), soles(det.totalCobrado)],
    ],
    { resaltarUltima: true },
  );
  d.seccion("Salidas");
  d.tabla(cols, [fila("Devoluciones al cliente", suma(devoluciones)), fila("Gastos y retiros (mov. caja)", suma(salidas)), ["Total salidas", soles(suma(devoluciones) + suma(salidas))]], { resaltarUltima: true });

  d.seccion("Cierre de caja", "Solo efectivo");
  const esperado = caja.esperado ?? det.efectivo.esperado;
  d.totales([
    ["+ Saldo apertura caja", soles(caja.montoInicial)],
    ["+ Cobros en efectivo (menos devoluciones)", soles(det.efectivo.cobros)],
    ["+ Entradas (mov. caja)", soles(det.efectivo.ingresos)],
    ["- Salidas", soles(-det.efectivo.egresos)],
    ["Efectivo esperado", soles(esperado), true],
    ...(caja.contado !== null
      ? ([
          ["Efectivo contado", soles(caja.contado)],
          [caja.diferencia === 0 ? "Descuadre (cuadra)" : (caja.diferencia ?? 0) > 0 ? "Sobrante" : "Faltante", soles(Math.abs(caja.diferencia ?? 0)), true],
        ] as [string, string, boolean?][])
      : []),
  ]);
  if (pagos.length) {
    d.seccion("Detalle de cobros");
    const TIPO: Record<string, string> = { saldo: "Venta", abono: "Abono", adelanto: "Pago inicial", devolucion: "Devolución" };
    const hora = (iso: string) => new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(iso));
    d.tabla(
      [
        { titulo: "Recibo", ancho: 0.9 },
        { titulo: "Fecha", ancho: 1.1 },
        { titulo: "Detalle", ancho: 3 },
        { titulo: "Referencia", ancho: 1.3 },
        { titulo: "Monto", ancho: 1.1, alinear: "der" },
      ],
      [...pagos]
        .sort((a, b) => a.momento.localeCompare(b.momento))
        .map((p) => [p.ordenId && reciboDe.get(p.ordenId) ? String(reciboDe.get(p.ordenId)) : "—", hora(p.momento), `${TIPO[p.tipo] ?? p.tipo} · ${p.concepto.replace(/^\S+ de /, "")}`, MEDIOS[p.medio], (p.tipo === "devolucion" ? "-" : "") + importe(p.monto)]),
      { cebra: true },
    );
  }
  if (caja.observaciones) d.nota(caja.observaciones, "Observaciones");
  d.firmas(["Entrega (caja)", "Recibe (gerencia o administración)"]);
  return { bytes: await d.bytes(), archivo: `arqueo-${caja.abiertaEn.slice(0, 10)}.pdf` };
}

export async function pdfCierre(ctx: Contexto, dia: string): Promise<Pdf> {
  const verUtilidad = ctx.roles.includes("gerencia");
  const c = await cierreDelDia(ctx.taller.id, dia, verUtilidad);
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, "Cierre del día", fechaCorta(dia), pie);
  d.datos([
    ["Carros entregados", String(c.entregadas)],
    ["Total vendido", soles(c.boletas.total + c.facturas.total - c.notas.total)],
  ]);
  d.seccion("Ventas", "Comprobantes emitidos este día");
  d.tabla(
    [
      { titulo: "Concepto", ancho: 3 },
      { titulo: "Cantidad", ancho: 1, alinear: "der" },
      { titulo: "Sin IGV", ancho: 1.4, alinear: "der" },
      { titulo: "IGV", ancho: 1.2, alinear: "der" },
      { titulo: "Total", ancho: 1.4, alinear: "der" },
    ],
    [
      ["Boletas", String(c.boletas.cantidad), soles(c.boletas.sinIgv), soles(c.boletas.igv), soles(c.boletas.total)],
      ["Facturas", String(c.facturas.cantidad), soles(c.facturas.sinIgv), soles(c.facturas.igv), soles(c.facturas.total)],
      ["Notas de crédito", String(c.notas.cantidad), soles(-c.notas.sinIgv), soles(-c.notas.igv), soles(-c.notas.total)],
      ["Total", "", soles(c.boletas.sinIgv + c.facturas.sinIgv - c.notas.sinIgv), soles(c.boletas.igv + c.facturas.igv - c.notas.igv), soles(c.boletas.total + c.facturas.total - c.notas.total)],
    ],
    { resaltarUltima: true },
  );
  d.seccion("Cobros", "Por medio de pago, menos devoluciones");
  d.tabla(
    [
      { titulo: "Medio", ancho: 3 },
      { titulo: "Monto", ancho: 1.5, alinear: "der" },
    ],
    [...(Object.keys(MEDIOS) as MedioPago[]).map((m) => [MEDIOS[m], soles(c.cobros[m])]), ["Total cobrado", soles(c.cobros.total)]],
    { resaltarUltima: true },
  );
  d.seccion("Compras");
  d.totales([
    [`Compras (${c.compras.cantidad}) sin IGV`, soles(c.compras.sinIgv)],
    ["Compras con IGV", soles(c.compras.total)],
    ...(verUtilidad ? ([["Mano de obra del día", soles(-c.manoObra)], ["Utilidad estimada (sin IGV)", soles(c.utilidadEstimada), true]] as [string, string, boolean?][]) : []),
  ]);
  d.seccion("Lo que no cuadra");
  if (c.descuadres.length) for (const x of c.descuadres) d.parrafo(`• ${x}`);
  else d.parrafo("Todo cuadra: lo vendido es lo cobrado y cada entrega tiene su comprobante.", { color: "tenue" });
  d.firmas(["Cerró", "Revisó"]);
  return { bytes: await d.bytes(), archivo: `cierre-${dia}.pdf` };
}

// ---------------------------------------------------------------------------
// Reporte mensual (gerencia)
// ---------------------------------------------------------------------------
export async function pdfReporte(ctx: Contexto, mes: string, todos: boolean): Promise<Pdf> {
  if (!ctx.roles.includes("gerencia")) return null;
  const talleres = ctx.talleres.filter((t) => t.roles.includes("gerencia"));
  const alcance = todos && talleres.length > 1 ? talleres : [ctx.taller];
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const meses = mesesHasta(mes, 6);
  const datos = await Promise.all(alcance.map(async (t) => ({ taller: t, filas: await reporteMensual(t.id, meses, hoy, true), personal: await personalDelMes(t.id, mes) })));
  const conjunto = meses.map((m, i) => sumarFilas(datos.map((x) => x.filas[i]), m));
  const actual = conjunto[conjunto.length - 1];
  const { taller, pie } = await base(ctx);
  const nombreMes = (m: string) => {
    const [a, mm] = m.split("-").map(Number);
    const t = new Intl.DateTimeFormat("es-PE", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(a, mm - 1, 15)));
    return `${t.charAt(0).toUpperCase()}${t.slice(1)} ${a}`;
  };
  const d = await Documento.crear(alcance.length > 1 ? { nombre: "Todos los talleres" } : taller, "Reporte mensual", nombreMes(mes), pie);
  d.datos([
    ["Ventas sin IGV", soles(actual.ventas)],
    ["Ventas con IGV", soles(actual.ventasConIgv)],
    ["Utilidad bruta", `${soles(actual.utilidad)}${actual.margen !== null ? ` (margen ${(actual.margen * 100).toFixed(1)} %)` : ""}`],
    ["Gastos del taller y personal", soles(actual.gastos + actual.personal)],
    ["Utilidad neta", `${soles(actual.utilidadNeta)}${actual.margenNeto !== null ? ` (margen ${(actual.margenNeto * 100).toFixed(1)} %)` : ""}`],
    ["Carros entregados", String(actual.entregados)],
  ]);
  if (actual.parcial) d.parrafo("El mes está en curso: los montos van hasta hoy.", { tam: 8.5, color: "tenue" });
  const COLS = [
    { titulo: "", ancho: 1.8 },
    { titulo: "Ventas", ancho: 1.3, alinear: "der" as const },
    { titulo: "Compras", ancho: 1.3, alinear: "der" as const },
    { titulo: "Mano de obra", ancho: 1.3, alinear: "der" as const },
    { titulo: "U. bruta", ancho: 1.3, alinear: "der" as const },
    { titulo: "Gastos y pers.", ancho: 1.3, alinear: "der" as const },
    { titulo: "U. neta", ancho: 1.3, alinear: "der" as const },
    { titulo: "Entreg.", ancho: 0.7, alinear: "der" as const },
  ];
  const fila = (t: string, f: (typeof conjunto)[number]) => [t, importe(f.ventas), importe(f.compras), importe(f.manoObra), importe(f.utilidad), importe(f.gastos + f.personal), importe(f.utilidadNeta), String(f.entregados)];
  d.seccion("Mes a mes", "Soles sin IGV · neta = bruta − gastos del taller − sueldos del resto del personal − comisiones");
  d.tabla(COLS, [...conjunto].reverse().map((f) => fila(nombreMes(f.mes), f)));
  if (alcance.length > 1) {
    d.seccion("Por taller", nombreMes(mes));
    d.tabla(COLS, [...datos.map((x) => fila(x.taller.nombre, x.filas[x.filas.length - 1])), fila("Total", actual)], { resaltarUltima: true });
  }
  d.seccion("Personal y comisiones", nombreMes(mes));
  const personal = datos.flatMap((x) => x.personal.map((p) => ({ ...p, taller: x.taller.nombre })));
  d.tabla(
    [
      { titulo: "Persona", ancho: 2.4 },
      { titulo: "Rol", ancho: 2 },
      ...(alcance.length > 1 ? [{ titulo: "Taller", ancho: 1.4 }] : []),
      { titulo: "Costo mensual", ancho: 1.3, alinear: "der" as const },
      { titulo: "Comisiones", ancho: 1.2, alinear: "der" as const },
      { titulo: "Total", ancho: 1.2, alinear: "der" as const },
    ],
    [
      ...personal.map((p) => [p.nombre, p.roles, ...(alcance.length > 1 ? [p.taller] : []), p.costo ? soles(p.costo) : "-", p.comision ? soles(p.comision) : "-", soles(p.costo + p.comision)]),
      ["Total", "", ...(alcance.length > 1 ? [""] : []), soles(personal.reduce((a, p) => a + p.costo, 0)), soles(personal.reduce((a, p) => a + p.comision, 0)), soles(personal.reduce((a, p) => a + p.costo + p.comision, 0))],
    ],
    { resaltarUltima: true },
  );
  return { bytes: await d.bytes(), archivo: `reporte-${alcance.length > 1 ? "talleres" : "taller"}-${mes}.pdf` };
}

export const ROL_TEXTO = (roles: Rol[]) => roles.map((r) => NOMBRE_ROL[r]).join(", ");

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------
export async function pdfKardex(ctx: Contexto, repuestoId: string): Promise<Pdf> {
  const r = await repuesto(ctx.taller.id, repuestoId);
  if (!r) return null;
  const movs = (await kardex(ctx.taller.id, repuestoId)).reverse();
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, "Kardex de repuesto", r.codigo, pie);
  d.datos([
    ["Repuesto", r.nombre],
    ["Marca", r.marca ?? "—"],
    ["Stock actual", cantidadTexto(r.stock, r.unidad)],
    ["Stock mínimo", r.stockMinimo ? cantidadTexto(r.stockMinimo, r.unidad) : "Sin mínimo"],
    ["Costo promedio", `${soles(r.costoPromedio)} sin IGV`],
    ["Valor en stock", `${soles(valorStock([r]))} sin IGV`],
  ]);
  d.seccion("Movimientos", "Costos sin IGV. Los anulados no suman.");
  d.tabla(
    [
      { titulo: "Fecha", ancho: 1.3 },
      { titulo: "Movimiento", ancho: 2.6 },
      { titulo: "Cant.", ancho: 0.8, alinear: "der" },
      { titulo: "Costo c/u", ancho: 1, alinear: "der" },
      { titulo: "Saldo", ancho: 0.8, alinear: "der" },
    ],
    movs.map((m) => {
      const que =
        m.tipo === "entrada" ? `Compra ${m.compra ?? ""}` : m.tipo === "salida" ? `Orden ${numeroOrden(m.ordenNumero ?? 0)}` : `Ajuste: ${m.nota ?? ""}`;
      return [
        fechaHora(m.creadoEn),
        m.estado === "anulado" ? `ANULADO · ${que}` : que,
        `${m.cantidad > 0 ? "+" : ""}${m.cantidad}`,
        soles(m.costo),
        m.estado === "anulado" ? "—" : String(m.stockDespues ?? ""),
      ];
    }),
  );
  if (movs.length === 0) d.nota("Sin movimientos todavía.");
  return { bytes: await d.bytes(), archivo: `kardex-${r.codigo}.pdf` };
}

export async function pdfInventario(ctx: Contexto): Promise<Pdf> {
  const lista = await listarRepuestos(ctx.taller.id);
  const { taller, pie } = await base(ctx);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const d = await Documento.crear(taller, "Inventario valorizado", fechaCorta(hoy), pie);
  const bajos = lista.filter((r) => r.bajo);
  d.datos([
    ["Repuestos", String(lista.length)],
    ["Con stock bajo", String(bajos.length)],
    ["Valor del stock", `${soles(valorStock(lista))} sin IGV`],
  ]);
  d.seccion("Repuestos", "Valor = stock × costo promedio, sin IGV.");
  d.tabla(
    [
      { titulo: "Código", ancho: 1.3 },
      { titulo: "Repuesto", ancho: 2.8 },
      { titulo: "Stock", ancho: 0.9, alinear: "der" },
      { titulo: "Mín.", ancho: 0.7, alinear: "der" },
      { titulo: "Costo prom.", ancho: 1.1, alinear: "der" },
      { titulo: "Valor", ancho: 1.1, alinear: "der" },
    ],
    [
      ...lista.map((r) => [r.codigo, r.bajo ? `${r.nombre} (BAJO)` : r.nombre, String(r.stock), r.stockMinimo ? String(r.stockMinimo) : "—", soles(r.costoPromedio), soles(valorStock([r]))]),
      ["", "Total", "", "", "", soles(valorStock(lista))],
    ],
    { resaltarUltima: true },
  );
  return { bytes: await d.bytes(), archivo: `inventario-${hoy}.pdf` };
}
