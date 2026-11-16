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
import { COMBUSTIBLES, NOMBRE_ESTADO, numeroOrden, TRANSMISIONES, type EstadoOrden } from "../taller/estados";
import { mesesHasta, personalDelMes, reporteMensual, sumarFilas } from "../taller/reportes";
import { cantidadTexto, valorStock } from "../inventario";
import { kardex, listarRepuestos, repuesto } from "../taller/inventario-consultas";
import { Documento, fechaCorta, fechaHora, soles, type DatosTaller } from "./documento";

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

async function base(ctx: Contexto): Promise<{ taller: DatosTaller; pie: string }> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("empresas").select("nombre, razon_social, ruc, direccion, telefono").eq("id", ctx.taller.id).single();
  return {
    taller: { nombre: data?.nombre ?? ctx.taller.nombre, razonSocial: data?.razon_social, ruc: data?.ruc, direccion: data?.direccion, telefono: data?.telefono },
    pie: `Generado con Taller Control el ${fechaHora(new Date().toISOString())} por ${ctx.perfil.nombre}`,
  };
}

const carro = (v?: { placa?: string | null; marca?: string | null; modelo?: string | null; anio?: number | null; color?: string | null }) =>
  [v?.marca, v?.modelo, v?.anio ? String(v.anio) : null, v?.color].filter(Boolean).join(" ") || null;
const placa = (p?: string | null) => (p && /^[A-Z0-9]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : (p ?? null));

/** Totales según el IGV del documento y cómo se quieren ver los precios. */
function totalesIgv(sinIgv: number, igv: number, total: number, tasa: number): [string, string, boolean?][] {
  if (tasa === 0) return [["Total (operación sin IGV)", soles(total), true]];
  return [
    ["Op. gravada (sin IGV)", soles(sinIgv)],
    [`IGV ${Math.round(tasa * 100)} %`, soles(igv)],
    ["Total", soles(total), true],
  ];
}

// ---------------------------------------------------------------------------
// Cotización
// ---------------------------------------------------------------------------
export async function pdfCotizacion(ctx: Contexto, id: string, modo: ModoIgv): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: c } = await supabase
    .from("cotizaciones")
    .select("version, es_adicional, estado, enviada_en, respuesta_en, aprobada_por_medio, tasa_igv, subtotal_sin_igv, igv, total, creado_en, cotizacion_items (tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total), ordenes_trabajo (numero, kilometraje_ingreso, vehiculos (placa, marca, modelo, anio, color), clientes (nombre, celular, tipo_documento, numero_documento))")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!c) return null;
  const o = uno(c.ordenes_trabajo);
  const v = uno(o?.vehiculos);
  const cl = uno(o?.clientes);
  const tasa = n(c.tasa_igv);
  const { taller, pie } = await base(ctx);
  const numero = `${o ? numeroOrden(o.numero) : ""}-V${c.version}`;
  const d = await Documento.crear(taller, c.es_adicional ? "Cotización adicional" : "Cotización", numero, pie);
  const MEDIO: Record<string, string> = { whatsapp: "por WhatsApp", presencial: "en persona", llamada: "por llamada" };
  d.datos([
    ["Cliente", cl?.nombre],
    ["Documento", cl?.numero_documento ? `${DOC[cl.tipo_documento] ?? ""} ${cl.numero_documento}`.trim() : null],
    ["Celular", cl?.celular ? formatearCelular(cl.celular) : null],
    ["Fecha", fechaCorta(c.creado_en)],
    ["Placa", placa(v?.placa)],
    ["Vehículo", carro(v)],
    ["Kilometraje", o?.kilometraje_ingreso != null ? `${Number(o.kilometraje_ingreso).toLocaleString("es-PE")} km` : null],
    ["Estado", c.estado === "aprobada" ? `Aprobada${c.aprobada_por_medio ? ` ${MEDIO[c.aprobada_por_medio]}` : ""}${c.respuesta_en ? ` el ${fechaCorta(c.respuesta_en)}` : ""}` : c.estado === "rechazada" ? "Rechazada" : c.estado === "enviada" ? "Enviada al cliente" : "Borrador"],
  ]);
  const verSinIgv = modo === "sin" && tasa > 0;
  const items = ((c.cotizacion_items ?? []) as { tipo: string; descripcion: string; cantidad: Num; subtotal_sin_igv: Num; total: Num }[]).map((i) => {
    const cant = n(i.cantidad);
    const importe = verSinIgv ? n(i.subtotal_sin_igv) : n(i.total);
    return [String(cant), i.descripcion, i.tipo === "servicio" ? "Servicio" : "Repuesto", soles(importe / cant), soles(importe)];
  });
  d.seccion("Detalle", tasa === 0 ? "Operación sin IGV" : verSinIgv ? "Precios sin IGV" : "Precios con IGV incluido");
  d.tabla(
    [
      { titulo: "Cant.", ancho: 0.6, alinear: "der" },
      { titulo: "Descripción", ancho: 4 },
      { titulo: "Tipo", ancho: 1.1 },
      { titulo: verSinIgv ? "Valor unit." : "P. unit.", ancho: 1.3, alinear: "der" },
      { titulo: verSinIgv ? "Valor venta" : "Importe", ancho: 1.3, alinear: "der" },
    ],
    items,
  );
  d.totales(totalesIgv(n(c.subtotal_sin_igv), n(c.igv), n(c.total), tasa));
  d.parrafo("Precios en soles. Cotización válida por 7 días. El precio de los repuestos puede variar según su disponibilidad.", { tam: 8.5, color: "tenue" });
  d.firmas(["Aprobado por el cliente", "Asesor de servicio"]);
  return { bytes: await d.bytes(), archivo: `cotizacion-${numero}.pdf` };
}

// ---------------------------------------------------------------------------
// Orden de trabajo
// ---------------------------------------------------------------------------
export async function pdfOrden(ctx: Contexto, id: string, verDinero: boolean): Promise<Pdf> {
  const supabase = await clienteServidor();
  const { data: o } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, estado, tecnico_id, entregado_en, kilometraje_ingreso, observaciones_ingreso, ingresado_en, es_reingreso_garantia, vehiculos (placa, marca, modelo, anio, color, combustible, transmision), clientes (nombre, celular, tipo_documento, numero_documento)")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!o) return null;
  const [{ data: servicios }, { data: avances }, nombres] = await Promise.all([
    supabase.from("orden_servicios").select("descripcion, es_adicional").eq("orden_id", id).order("creado_en"),
    supabase.from("orden_avances").select("texto, autor_id, creado_en").eq("orden_id", id).order("creado_en"),
    nombresPersonal(ctx.taller.id),
  ]);
  const v = uno(o.vehiculos);
  const cl = uno(o.clientes);
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, "Orden de trabajo", numeroOrden(o.numero), pie);
  d.datos([
    ["Cliente", cl?.nombre],
    ["Celular", cl?.celular ? formatearCelular(cl.celular) : null],
    ["Placa", placa(v?.placa)],
    ["Vehículo", carro(v)],
    ["Kilometraje", o.kilometraje_ingreso != null ? `${Number(o.kilometraje_ingreso).toLocaleString("es-PE")} km` : null],
    [
      "Combustible y caja",
      [v?.combustible ? COMBUSTIBLES[v.combustible as keyof typeof COMBUSTIBLES] : null, v?.transmision ? TRANSMISIONES[v.transmision as keyof typeof TRANSMISIONES] : null].filter(Boolean).join(" · ") || null,
    ],
    ["Ingreso", fechaHora(o.ingresado_en)],
    ["Estado", `${NOMBRE_ESTADO[o.estado as EstadoOrden]}${o.entregado_en ? ` el ${fechaHora(o.entregado_en)}` : ""}${o.es_reingreso_garantia ? " · Reingreso por garantía" : ""}`],
    ["Técnico", o.tecnico_id ? (nombres.get(o.tecnico_id) ?? null) : "Sin asignar"],
  ]);
  d.seccion("Servicios");
  d.tabla(
    [
      { titulo: "#", ancho: 0.4, alinear: "der" },
      { titulo: "Servicio", ancho: 5 },
      { titulo: "Tipo", ancho: 1.2 },
    ],
    (servicios ?? []).map((s, i) => [String(i + 1), s.descripcion, s.es_adicional ? "Adicional" : "Solicitado"]),
  );
  if (o.observaciones_ingreso) {
    d.seccion("Observaciones de ingreso");
    d.parrafo(o.observaciones_ingreso);
  }
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
  if (verDinero) {
    const dinero = await dineroDeOrden(ctx.taller.id, id, { verVentas: true, verUtilidad: false }, { tecnicoId: o.tecnico_id, entregadoEn: o.entregado_en });
    d.seccion("Cuenta");
    d.totales([
      ["A cobrar", soles(dinero.aCobrar)],
      ["Pagado", soles(dinero.pagado)],
      [dinero.saldo < 0 ? "A favor del cliente" : "Saldo", soles(Math.abs(dinero.saldo)), true],
    ]);
  }
  d.parrafo("El cliente declara que el vehículo se recibió en el estado descrito. El taller no se responsabiliza por objetos de valor no declarados.", { tam: 8, color: "tenue" });
  d.firmas(["Cliente", "Recibido por el taller"]);
  return { bytes: await d.bytes(), archivo: `orden-${numeroOrden(o.numero)}.pdf` };
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
  const d = await Documento.crear(taller, p.tipo === "devolucion" ? "Constancia de devolución" : "Recibo de pago", numero, pie);
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
  d.nota("Este recibo es una constancia interna del taller. No reemplaza a la boleta o factura electrónica.");
  d.firmas(["Cliente", "Caja"]);
  return { bytes: await d.bytes(), archivo: `recibo-${numero}.pdf` };
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
  const { taller, pie } = await base(ctx);
  const d = await Documento.crear(taller, caja.estado === "cerrada" ? "Arqueo de caja" : "Caja abierta", fechaCorta(caja.abiertaEn), pie);
  d.datos([
    ["Abrió", `${nombres.get(caja.abiertaPor ?? "") ?? ""} · ${fechaHora(caja.abiertaEn)}`],
    ["Cerró", caja.cerradaEn ? `${nombres.get(caja.cerradaPor ?? "") ?? ""} · ${fechaHora(caja.cerradaEn)}` : "Todavía abierta"],
  ]);
  d.seccion("Efectivo");
  const esperado = caja.esperado ?? det.efectivo.esperado;
  d.totales([
    ["Sencillo inicial", soles(caja.montoInicial)],
    ["Cobros en efectivo (menos devoluciones)", soles(det.efectivo.cobros)],
    ["Otros ingresos", soles(det.efectivo.ingresos)],
    ["Gastos y retiros", soles(-det.efectivo.egresos)],
    ["Efectivo esperado", soles(esperado), true],
    ...(caja.contado !== null
      ? ([
          ["Efectivo contado", soles(caja.contado)],
          [caja.diferencia === 0 ? "Diferencia (cuadra)" : (caja.diferencia ?? 0) > 0 ? "Sobrante" : "Faltante", soles(Math.abs(caja.diferencia ?? 0)), true],
        ] as [string, string, boolean?][])
      : []),
  ]);
  d.seccion("Cobrado por medio de pago");
  d.tabla(
    [
      { titulo: "Medio", ancho: 3 },
      { titulo: "Cobrado", ancho: 1.5, alinear: "der" },
    ],
    [...(Object.keys(MEDIOS) as MedioPago[]).map((m) => [MEDIOS[m], soles(det.porMedio[m])]), ["Total", soles(det.totalCobrado)]],
    { resaltarUltima: true },
  );
  if (det.movimientos.length) {
    d.seccion("Movimientos");
    d.tabla(
      [
        { titulo: "Hora", ancho: 0.9 },
        { titulo: "Concepto", ancho: 3.4 },
        { titulo: "Medio", ancho: 1.2 },
        { titulo: "Monto", ancho: 1.3, alinear: "der" },
      ],
      [...det.movimientos]
        .reverse()
        .map((m) => [
          new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(m.momento)),
          `${m.concepto}${m.estado === "anulado" ? ` (anulado: ${m.motivoAnulacion})` : ""}`,
          MEDIOS[m.medio],
          m.estado === "anulado" ? "-" : soles(m.efecto),
        ]),
    );
  }
  if (caja.observaciones) {
    d.seccion("Observaciones");
    d.parrafo(caja.observaciones);
  }
  d.firmas(["Entrega (caja)", "Recibe (gerencia o administración)"]);
  return { bytes: await d.bytes(), archivo: `caja-${caja.abiertaEn.slice(0, 10)}.pdf` };
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
    ["Utilidad", `${soles(actual.utilidad)}${actual.margen !== null ? ` (margen ${(actual.margen * 100).toFixed(1)} %)` : ""}`],
    ["Carros entregados", String(actual.entregados)],
  ]);
  if (actual.parcial) d.parrafo("El mes está en curso: los montos van hasta hoy.", { tam: 8.5, color: "tenue" });
  const COLS = [
    { titulo: "", ancho: 1.8 },
    { titulo: "Ventas", ancho: 1.3, alinear: "der" as const },
    { titulo: "Compras", ancho: 1.3, alinear: "der" as const },
    { titulo: "Mano de obra", ancho: 1.3, alinear: "der" as const },
    { titulo: "Utilidad", ancho: 1.3, alinear: "der" as const },
    { titulo: "Margen", ancho: 0.9, alinear: "der" as const },
    { titulo: "Entreg.", ancho: 0.8, alinear: "der" as const },
  ];
  const fila = (t: string, f: (typeof conjunto)[number]) => [t, soles(f.ventas), soles(f.compras), soles(f.manoObra), soles(f.utilidad), f.margen === null ? "-" : `${(f.margen * 100).toFixed(1)} %`, String(f.entregados)];
  d.seccion("Mes a mes", "Montos sin IGV · utilidad = ventas − compras − mano de obra");
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
