import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarCelular } from "@/lib/celulares";
import { desdeTotal, montoNeto, montosLinea, redondear, saldo as calcularSaldo, sumarMontos } from "@/lib/dinero";
import { mensajeVacio, type ComprobanteLeido, type Intencion, type MensajeInterpretado } from "@/lib/ia/esquemas";
import { interpretarMensaje, leerComprobante, leerPlaca, transcribirAudio, type Archivo } from "@/lib/ia/proveedor";
import { fechaHoraDesdeTexto, interpretarSinIa, itemsDesdeTexto, normalizarPlaca } from "@/lib/ia/sin-ia";
import { cuandoEntrega } from "@/lib/taller/entrega";
import { validarPlaca } from "@/lib/placas";
import { CAJA, tieneAlguno, type Rol } from "@/lib/roles";
import { pdfCaja, pdfCotizacion, pdfOrden, pdfRecibo, type Pdf } from "@/lib/pdf/documentos";
import type { Contexto } from "@/lib/sesion";
import { clienteAdmin } from "@/lib/supabase/admin";
import { conCliente } from "@/lib/supabase/servidor";
import { atenderCliente } from "./clientes";
import { ayuda, botonesConfirmar, historial, pedirDato, PERMITIDO, placaBonita, resumen, SIN_ACCESO, type Respuesta } from "./respuestas";
import { sesionDe } from "./sesion";

/**
 * Un mensaje que llega por WhatsApp, ya descargado por n8n.
 * Todo lo que trae (texto, audio, foto, PDF) es información: nunca una orden
 * para el sistema. Nada se guarda como definitivo sin «Confirmar».
 */
export type Entrada = {
  wa_id: string;
  celular: string;
  nombre?: string;
  tipo: "texto" | "audio" | "imagen" | "documento" | "video" | "boton" | "otro";
  texto?: string;
  boton_id?: string;
  media?: { base64: string; mime: string; nombre?: string };
};
export type Salida = { respuesta: Respuesta; resultado: string; duplicado?: boolean };

type Ctx = { db: SupabaseClient; empresa: string; perfil: string; nombre: string; roles: Rol[]; celular: string; hoy: string };
type Preparado = { datos: Record<string, unknown>; faltan: string[] } | { respuesta: Respuesta; resultado?: string };

const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const ahoraTexto = () =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const SI = /^(si|sí|ok|okey|dale|confirmo|confirmar|correcto|listo)\.?$/i;
const NO = /^(no|corregir|cancelar|cancela|mal)\.?$/i;

export async function procesarMensaje(e: Entrada): Promise<Salida> {
  const admin = clienteAdmin();
  const { data: previo } = await admin.from("mensajes_whatsapp").select("respuesta, resultado").eq("wa_id", e.wa_id).maybeSingle();
  if (previo) return { respuesta: { texto: previo.respuesta ?? "" }, resultado: previo.resultado, duplicado: true };

  const digitos = e.celular.replace(/[^\d+]/g, "");
  const celular = normalizarCelular(digitos.startsWith("+") || digitos.length <= 9 ? digitos : `+${digitos}`) ?? digitos;
  const { data: auditoria } = await admin
    .from("mensajes_whatsapp")
    .insert({ wa_id: e.wa_id, celular, tipo: e.tipo, texto: e.texto?.slice(0, 4000) ?? null, media_mime: e.media?.mime ?? null })
    .select("id")
    .single();
  const cerrarAuditoria = async (s: Salida, extra: Record<string, unknown> = {}) => {
    if (auditoria) await admin.from("mensajes_whatsapp").update({ resultado: s.resultado, respuesta: s.respuesta.texto.slice(0, 4000), procesado_en: new Date().toISOString(), ...extra }).eq("id", auditoria.id);
    return s;
  };

  try {
    // 1. ¿Quién escribe?
    const { data: perfil } = await admin.from("perfiles").select("id, nombre, activo").eq("celular", celular).maybeSingle();
    const { data: miembros } = perfil?.activo ? await admin.from("miembros").select("empresa_id, rol, empresas (nombre)").eq("perfil_id", perfil.id).eq("activo", true) : { data: [] };
    if (!perfil?.activo || !miembros?.length) {
      // Puede ser un cliente respondiendo una encuesta o una cotización.
      const cliente = await atenderCliente(admin, celular, e);
      if (cliente) return cerrarAuditoria(cliente.salida, { empresa_id: cliente.empresaId, cliente_id: cliente.clienteId });
      return cerrarAuditoria({ respuesta: SIN_ACCESO, resultado: "sin_acceso" });
    }

    // 2. ¿En qué taller? (si pertenece a varios, lo elige una vez)
    type Fila = { empresa_id: string; rol: Rol; empresas: { nombre: string } | { nombre: string }[] | null };
    const filas = miembros as Fila[];
    const talleres = [...new Map(filas.map((m) => [m.empresa_id, (Array.isArray(m.empresas) ? m.empresas[0] : m.empresas)?.nombre ?? "Taller"])).entries()];
    let empresa = talleres.length === 1 ? talleres[0][0] : null;
    if (e.boton_id?.startsWith("taller:")) {
      const elegido = e.boton_id.slice(7);
      if (talleres.some(([id]) => id === elegido)) {
        await admin.from("preferencias_whatsapp").upsert({ perfil_id: perfil.id, empresa_id: elegido, actualizado_en: new Date().toISOString() });
        const nombre = talleres.find(([id]) => id === elegido)![1];
        return cerrarAuditoria({ respuesta: { texto: `Listo: por WhatsApp trabajas en *${nombre}*. Ya puedes mandar tu mensaje. Para cambiar, escribe «taller».` }, resultado: "respondido" }, { empresa_id: elegido, perfil_id: perfil.id });
      }
    }
    if (!empresa) {
      const { data: pref } = await admin.from("preferencias_whatsapp").select("empresa_id").eq("perfil_id", perfil.id).maybeSingle();
      empresa = pref && talleres.some(([id]) => id === pref.empresa_id) ? pref.empresa_id : null;
    }
    if (!empresa || (talleres.length > 1 && /^taller$/i.test(e.texto?.trim() ?? ""))) {
      return cerrarAuditoria({
        respuesta: { texto: "¿En qué taller vas a registrar?", botones: talleres.slice(0, 10).map(([id, nombre]) => ({ id: `taller:${id}`, titulo: nombre.slice(0, 20) })) },
        resultado: "pide_dato",
      }, { perfil_id: perfil.id });
    }
    const roles = filas.filter((m) => m.empresa_id === empresa).map((m) => m.rol);

    // 3. Sesión como esa persona: desde aquí, la base aplica sus permisos.
    const sesion = await sesionDe(celular);
    if (!sesion) return cerrarAuditoria({ respuesta: { texto: "No pude abrir tu acceso. Intenta en un momento." }, resultado: "error" }, { empresa_id: empresa, perfil_id: perfil.id });
    const ctx: Ctx = { db: sesion.db, empresa, perfil: perfil.id, nombre: perfil.nombre, roles, celular, hoy: hoyLima() };
    try {
      const { salida, extra } = await atender(ctx, e);
      return cerrarAuditoria(salida, { empresa_id: empresa, perfil_id: perfil.id, ...extra });
    } finally {
      await sesion.cerrar();
    }
  } catch (err) {
    console.error("WhatsApp: error al procesar", err);
    return cerrarAuditoria({ respuesta: { texto: "Algo falló al procesar tu mensaje. No se guardó nada. Intenta otra vez." }, resultado: "error" });
  }
}

// ---------------------------------------------------------------------------
// Atender a una persona del taller
// ---------------------------------------------------------------------------
async function atender(ctx: Ctx, e: Entrada): Promise<{ salida: Salida; extra: Record<string, unknown> }> {
  const extra: Record<string, unknown> = {};
  const listo = (respuesta: Respuesta, resultado: string) => ({ salida: { respuesta, resultado }, extra });

  // Botones Confirmar / Corregir (o «sí» / «no» escrito)
  const pendiente = await borradorPendiente(ctx);
  const texto0 = (e.texto ?? "").trim();
  const boton = e.boton_id ?? (pendiente && pendiente.faltan.length === 0 && SI.test(texto0) ? `confirmar:${pendiente.id}` : pendiente && NO.test(texto0) ? `corregir:${pendiente.id}` : "");
  if (boton.startsWith("confirmar:") || boton.startsWith("corregir:")) {
    const [accion, id] = boton.split(":");
    extra.borrador_id = id;
    const { data: b } = await ctx.db.from("borradores_whatsapp").select("id, intencion, datos, faltan, estado, expira_en").eq("id", id).maybeSingle();
    if (!b || b.estado !== "pendiente" || new Date(b.expira_en) < new Date()) return listo({ texto: "Ese registro ya no está pendiente. Si hace falta, manda el mensaje de nuevo." }, "respondido");
    if (accion === "corregir") {
      await ctx.db.from("borradores_whatsapp").update({ estado: "corregido" }).eq("id", id);
      return listo({ texto: "Listo, no guardé nada. Manda el mensaje corregido." }, "corregido");
    }
    if ((b.faltan ?? []).length) return listo({ texto: pedirDato(b.faltan[0]) }, "pide_dato");
    const r = await ejecutar(ctx, b.intencion, b.datos as Record<string, unknown>);
    await ctx.db.from("borradores_whatsapp").update({ estado: r.ok ? "confirmado" : "fallido", resultado: r }).eq("id", id);
    extra.intencion = b.intencion;
    return listo({ texto: r.texto }, r.ok ? "confirmado" : "error");
  }

  // Audio → texto
  let texto = texto0;
  let archivo: Archivo | undefined;
  if (e.media) archivo = { datos: Buffer.from(e.media.base64, "base64"), mime: e.media.mime.split(";")[0].trim(), nombre: e.media.nombre };
  if (e.tipo === "audio" && archivo) {
    const t = await transcribirAudio(archivo);
    if (!t.ok) return listo({ texto: t.error }, "error");
    texto = t.datos;
    extra.transcripcion = texto.slice(0, 8000);
    archivo = undefined;
  }
  if (!texto && !archivo) return listo(ayuda(ctx.roles, ctx.nombre), "respondido");

  // ¿Completa un dato que se pidió antes?
  if (pendiente && pendiente.faltan.length) {
    const m0 = (pendiente.datos.m ?? mensajeVacio(pendiente.intencion as Intencion)) as MensajeInterpretado;
    const m = await completar(ctx, m0, pendiente.faltan, texto, archivo);
    // En la recepción de repuestos, «sin foto» deja seguir sin evidencia.
    const previoDatos = pendiente.intencion === "recepcion" && /\bsin foto\b|no tengo foto/i.test(texto) ? { ...pendiente.datos, sinFoto: true } : pendiente.datos;
    const conArchivo = archivo && (pendiente.intencion === "avance" || pendiente.intencion === "recepcion") ? archivo : undefined;
    const p = await preparar(ctx, pendiente.intencion as Intencion, m, conArchivo, previoDatos);
    extra.borrador_id = pendiente.id;
    extra.intencion = pendiente.intencion;
    if ("respuesta" in p) {
      await ctx.db.from("borradores_whatsapp").update({ estado: "corregido" }).eq("id", pendiente.id);
      return listo(p.respuesta, p.resultado ?? "respondido");
    }
    const res = resumen(pendiente.intencion, p.datos);
    await ctx.db.from("borradores_whatsapp").update({ datos: { ...p.datos, m }, faltan: p.faltan, resumen: res }).eq("id", pendiente.id);
    return p.faltan.length
      ? listo({ texto: pedirDato(p.faltan[0]) }, "pide_dato")
      : listo({ texto: `${res}\n\n¿Lo guardo?`, botones: botonesConfirmar(pendiente.id) }, "borrador");
  }
  if (pendiente) await ctx.db.from("borradores_whatsapp").update({ estado: "corregido" }).eq("id", pendiente.id);

  // Foto o PDF sin texto: comprobante, placa o evidencia.
  let m: MensajeInterpretado;
  let lectura: { lectura: ComprobanteLeido; archivo?: string } | undefined;
  const esDocumento = archivo && (archivo.mime === "application/pdf" || /factura|boleta|ticket|compra|comprobante/i.test(texto));
  if (archivo && e.tipo !== "video" && (esDocumento || !texto)) {
    const pista = tieneAlguno(ctx.roles, ["almacen"]) || /factura|compra|proveedor/i.test(texto) ? "compra" : /boleta|venta|cliente/i.test(texto) ? "venta" : "compra";
    const r = await leerComprobante(archivo, pista);
    if (r.ok && r.datos.es_comprobante) {
      const destino = pista === "compra" ? "compras" : "ventas";
      lectura = { lectura: r.datos, archivo: await subir(ctx, "comprobantes", `${ctx.empresa}/${destino}/${randomUUID()}`, archivo) };
      m = { ...mensajeVacio(pista === "compra" ? "compra" : "comprobante_venta"), placa: normalizarPlaca(texto) ?? r.datos.placa };
    } else if (!texto) {
      const pl = await leerPlaca(archivo);
      m = { ...mensajeVacio("avance"), placa: pl.ok ? pl.datos.placa : null };
      if (!m.placa) return listo({ texto: "Recibí la foto, pero no sé de qué carro es. Mándala de nuevo escribiendo la placa en el mensaje (por ejemplo «ABC123 avance»)." }, "pide_dato");
    } else {
      m = await interpretar(ctx, texto, archivo);
    }
  } else {
    m = await interpretar(ctx, texto, archivo);
    // Foto o video con texto: si el texto trae placa, es evidencia para la orden.
    if (archivo && m.placa && ["desconocido", "ayuda"].includes(m.intencion)) m = { ...m, intencion: "avance" };
  }
  extra.intencion = m.intencion;
  extra.datos = m;

  if (m.intencion === "ayuda" || m.intencion === "desconocido") {
    const a = ayuda(ctx.roles, ctx.nombre);
    return listo(m.intencion === "ayuda" ? a : { texto: `No entendí qué quieres registrar.\n\n${a.texto}` }, "respondido");
  }
  if (m.intencion === "historial") return listo(await verHistorial(ctx, m.placa), "respondido");
  if (!tieneAlguno(ctx.roles, PERMITIDO[m.intencion])) {
    if (m.intencion === "documento") return listo({ texto: "Los documentos en PDF por WhatsApp los piden gerencia, administración y los asesores." }, "rechazado");
    return listo({ texto: `Tu rol no registra ${NOMBRE[m.intencion]} por WhatsApp. Escribe «ayuda» para ver lo que sí puedes hacer.` }, "rechazado");
  }
  // Pedir un PDF no guarda nada: se arma con la sesión de la persona y se manda.
  if (m.intencion === "documento") {
    const d = await enviarDocumento(ctx, m);
    return listo(d, d.documento ? "documento" : "respondido");
  }

  const p = await preparar(ctx, m.intencion, m, m.intencion === "avance" || m.intencion === "recepcion" ? archivo : undefined, lectura ? { lectura: lectura.lectura, archivo: lectura.archivo } : {});
  if ("respuesta" in p) return listo(p.respuesta, p.resultado ?? "respondido");
  const res = resumen(m.intencion, p.datos);
  const { data: b, error } = await ctx.db
    .from("borradores_whatsapp")
    .insert({ empresa_id: ctx.empresa, perfil_id: ctx.perfil, intencion: m.intencion, datos: { ...p.datos, m }, faltan: p.faltan, resumen: res })
    .select("id")
    .single();
  if (error || !b) return listo({ texto: "No pude preparar el registro. Intenta otra vez." }, "error");
  extra.borrador_id = b.id;
  return p.faltan.length
    ? listo({ texto: pedirDato(p.faltan[0]) }, "pide_dato")
    : listo({ texto: `${res}\n\n¿Lo guardo?`, botones: botonesConfirmar(b.id) }, "borrador");
}

const NOMBRE: Record<string, string> = {
  nuevo_ingreso: "ingresos", avance: "avances", compra: "compras", recepcion: "repuestos que llegaron", documento: "documentos", comprobante_venta: "comprobantes de venta", pago: "pagos", cita: "citas", cotizacion: "cotizaciones",
};

async function interpretar(ctx: Ctx, texto: string, adjunto?: Archivo): Promise<MensajeInterpretado> {
  const r = await interpretarMensaje(texto, { rol: ctx.roles.join(", "), hoy: ahoraTexto(), adjunto: adjunto && adjunto.mime.startsWith("image/") ? adjunto : undefined });
  return r.ok ? r.datos : mensajeVacio();
}

async function borradorPendiente(ctx: Ctx) {
  const { data } = await ctx.db
    .from("borradores_whatsapp")
    .select("id, intencion, datos, faltan, expira_en")
    .eq("perfil_id", ctx.perfil)
    .eq("empresa_id", ctx.empresa)
    .eq("estado", "pendiente")
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expira_en) < new Date()) {
    await ctx.db.from("borradores_whatsapp").update({ estado: "vencido" }).eq("id", data.id);
    return null;
  }
  return data as { id: string; intencion: string; datos: Record<string, unknown>; faltan: string[] };
}

/** Llena los datos que se pidieron con lo que la persona respondió. */
async function completar(ctx: Ctx, m: MensajeInterpretado, faltan: string[], texto: string, archivo?: Archivo): Promise<MensajeInterpretado> {
  const n = { ...m };
  const ia = texto ? await interpretar(ctx, texto) : mensajeVacio();
  for (const campo of faltan) {
    if (campo === "placa") {
      n.placa = normalizarPlaca(texto) ?? ia.placa;
      if (!n.placa && archivo?.mime.startsWith("image/")) {
        const pl = await leerPlaca(archivo);
        if (pl.ok) n.placa = pl.datos.placa;
      }
    }
    if (campo === "cliente_celular") n.cliente_celular = normalizarCelular(texto.replace(/[^\d+]/g, "")) ?? ia.cliente_celular;
    if (campo === "cliente_nombre" && /[a-záéíóúñ]{2}/i.test(texto)) n.cliente_nombre = ia.cliente_nombre ?? texto.slice(0, 120);
    if (campo === "servicios") n.servicios = ia.servicios.length ? ia.servicios : texto.split(/\s*(?:,|\by\b)\s*/).filter((s) => s.length > 2);
    if (campo === "texto_avance") n.texto_avance = texto;
    if (campo === "monto") n.monto = ia.monto ?? (Number((/(\d+(?:[.,]\d{1,2})?)/.exec(texto)?.[1] ?? "").replace(",", ".")) || null);
    if (campo === "medio_pago") n.medio_pago = ia.medio_pago ?? (["efectivo", "yape", "plin", "tarjeta", "transferencia"].find((x) => texto.toLowerCase().includes(x)) as MensajeInterpretado["medio_pago"]) ?? null;
    if (campo === "fecha_hora") n.fecha_hora = ia.fecha_hora ?? fechaHoraDesdeTexto(texto, ctx.hoy);
    // Al responder «mañana 10am» la IA puede verlo como fecha de cita: sirve igual.
    if (campo === "entrega_prometida") n.entrega_prometida = ia.entrega_prometida ?? ia.fecha_hora ?? texto;
    if (campo === "items_cotizacion") n.items_cotizacion = ia.items_cotizacion.length ? ia.items_cotizacion : itemsDesdeTexto(texto);
    if (campo === "items_compra") n.items_compra = ia.items_compra.length ? ia.items_compra : interpretarSinIa(`llegaron: ${texto}`).items_compra;
    if (campo === "proveedor" && /[a-záéíóúñ]{2}/i.test(texto)) n.proveedor = ia.proveedor ?? texto.trim().slice(0, 160);
  }
  return n;
}

/**
 * Hora prometida de un ingreso: la fecha si se entendió y es futura, null si
 * dijeron que aún no se sabe, o undefined si hay que preguntarla.
 */
function entregaPrometida(texto: string | null, hoy: string): Date | null | undefined {
  const t = texto?.trim();
  if (!t) return undefined;
  if (/por definir|no (?:se|sé|sabe|sabemos)|despu[eé]s|sin hora|a[uú]n no|todav[ií]a no|diagn[oó]stico/i.test(t)) return null;
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) ? t.slice(0, 16) : fechaHoraDesdeTexto(t, hoy);
  const cuando = iso ? new Date(`${iso}:00-05:00`) : null;
  if (!cuando || Number.isNaN(cuando.getTime()) || cuando.getTime() < Date.now() - 5 * 60_000) return undefined;
  return cuando;
}

// ---------------------------------------------------------------------------
// Pedir un documento en PDF (recibo, cotización, orden o caja)
// ---------------------------------------------------------------------------
async function enviarDocumento(ctx: Ctx, m: MensajeInterpretado): Promise<Respuesta> {
  const tipo = m.documento ?? "orden";
  const placa = m.placa ? validarPlaca(m.placa) : null;
  const placaOk = placa && placa.estado !== "invalida" ? placa.placa : null;
  const { data: empresa } = await ctx.db.from("empresas").select("nombre").eq("id", ctx.empresa).maybeSingle();
  // El PDF se arma igual que en la app, con la sesión (y los permisos) de quien lo pide.
  const ctxPdf = {
    perfil: { id: ctx.perfil, nombre: ctx.nombre, celular: ctx.celular },
    taller: { id: ctx.empresa, nombre: empresa?.nombre ?? "Taller", roles: ctx.roles },
    talleres: [{ id: ctx.empresa, nombre: empresa?.nombre ?? "Taller", roles: ctx.roles }],
    roles: ctx.roles,
    rolPrincipal: ctx.roles[0],
    configuracion: { adminVeUtilidad: false, adminVeSueldos: false, minutosAvisoEntrega: 120 },
  } as Contexto;
  let pdf: Pdf = null;
  let texto = "";
  if (tipo === "caja") {
    const { data: caja } = await ctx.db.from("cajas").select("id, estado").eq("empresa_id", ctx.empresa).order("abierta_en", { ascending: false }).limit(1).maybeSingle();
    if (!caja) return { texto: "Todavía no hay cajas abiertas en el sistema." };
    pdf = await conCliente(ctx.db, () => pdfCaja(ctxPdf, caja.id));
    texto = caja.estado === "abierta" ? "Aquí está la caja de hoy (todavía abierta)." : "Aquí está el último arqueo de caja.";
  } else {
    const nombreDoc = tipo === "cotizacion" ? "cotización" : tipo;
    if (!placaOk) return { texto: `¿De qué carro? Escribe la placa, por ejemplo «${nombreDoc} ABC123».` };
    const { orden } = await ordenDe(ctx, placaOk, false);
    if (!orden) return { texto: `No encontré órdenes de ${placaBonita(placaOk)}.` };
    const ot = `OT-${String(orden.numero).padStart(6, "0")}`;
    if (tipo === "orden") {
      pdf = await conCliente(ctx.db, () => pdfOrden(ctxPdf, orden.id, tieneAlguno(ctx.roles, CAJA)));
      texto = `Aquí está la orden de reparación ${ot} de ${placaBonita(placaOk)}.`;
    } else if (tipo === "cotizacion") {
      const { data: c } = await ctx.db.from("cotizaciones").select("id, version").eq("orden_id", orden.id).order("version", { ascending: false }).limit(1).maybeSingle();
      if (!c) return { texto: `La orden ${ot} de ${placaBonita(placaOk)} todavía no tiene cotización.` };
      pdf = await conCliente(ctx.db, () => pdfCotizacion(ctxPdf, c.id, "con"));
      texto = `Aquí está la proforma de ${placaBonita(placaOk)} (${ot}, versión ${c.version}).`;
    } else {
      const { data: r } = await ctx.db.from("recibos").select("id, numero").eq("orden_id", orden.id).neq("estado", "anulado").maybeSingle();
      if (!r) return { texto: `La orden ${ot} de ${placaBonita(placaOk)} todavía no tiene recibo. Emítelo en la app: orden → Dinero → Recibo de venta.` };
      pdf = await conCliente(ctx.db, () => pdfRecibo(ctxPdf, r.id));
      texto = `Aquí está el recibo N° ${r.numero} de ${placaBonita(placaOk)}.`;
    }
  }
  if (!pdf) return { texto: "No pude armar ese documento: puede que tu rol no lo vea." };
  // Se guarda un momento para que WhatsApp lo descargue con un enlace que vence en una hora.
  const admin = clienteAdmin();
  const ruta = `${ctx.empresa}/${randomUUID()}/${pdf.archivo.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const { error } = await admin.storage.from("documentos").upload(ruta, pdf.bytes, { contentType: "application/pdf" });
  const { data: firmado } = error ? { data: null } : await admin.storage.from("documentos").createSignedUrl(ruta, 3600);
  if (!firmado?.signedUrl) return { texto: "Armé el documento, pero no pude prepararlo para enviarlo. Ábrelo en la app." };
  return { texto, documento: { url: firmado.signedUrl, nombre: pdf.archivo } };
}

// ---------------------------------------------------------------------------
// Preparar el borrador de cada intención (lee con la sesión de la persona)
// ---------------------------------------------------------------------------
async function ordenDe(ctx: Ctx, placa: string, abiertas = true) {
  const { data: v } = await ctx.db.from("vehiculos").select("id, cliente_id").eq("empresa_id", ctx.empresa).eq("placa", placa).maybeSingle();
  if (!v) return { vehiculo: null, orden: null };
  let q = ctx.db.from("ordenes_trabajo").select("id, numero, estado").eq("vehiculo_id", v.id).eq("anulada", false).order("creado_en", { ascending: false }).limit(1);
  if (abiertas) q = q.neq("estado", "entregado");
  const { data: o } = await q.maybeSingle();
  return { vehiculo: v as { id: string; cliente_id: string }, orden: o as { id: string; numero: number; estado: string } | null };
}

async function preparar(ctx: Ctx, intencion: Intencion, m: MensajeInterpretado, archivo?: Archivo, previo: Record<string, unknown> = {}): Promise<Preparado> {
  const faltan: string[] = [];
  const placa = m.placa ? validarPlaca(m.placa) : null;
  const placaOk = placa && placa.estado !== "invalida" ? placa.placa : null;

  switch (intencion) {
    case "nuevo_ingreso": {
      if (!placaOk) faltan.push("placa");
      const servicios = m.servicios.map((s) => s.trim()).filter((s) => s.length >= 2).slice(0, 10);
      let cliente: { id?: string; nombre: string | null; celular: string | null; nuevo: boolean } = { nombre: m.cliente_nombre, celular: normalizarCelular(m.cliente_celular ?? ""), nuevo: true };
      let vehiculoId: string | null = null;
      if (placaOk) {
        const { vehiculo, orden } = await ordenDe(ctx, placaOk);
        if (orden) return { respuesta: { texto: `${placaBonita(placaOk)} ya tiene una orden abierta (OT-${String(orden.numero).padStart(6, "0")}). Para contar cómo va, manda un avance: «${placaBonita(placaOk)} …».` } };
        if (vehiculo) {
          vehiculoId = vehiculo.id;
          const { data: c } = await ctx.db.from("clientes").select("id, nombre, celular").eq("id", vehiculo.cliente_id).maybeSingle();
          if (c) cliente = { id: c.id, nombre: c.nombre, celular: c.celular, nuevo: false };
        }
      }
      if (cliente.nuevo) {
        if (!cliente.celular) faltan.push("cliente_celular");
        else {
          const { data: c } = await ctx.db.from("clientes").select("id, nombre, celular").eq("empresa_id", ctx.empresa).eq("celular", cliente.celular).maybeSingle();
          if (c) cliente = { id: c.id, nombre: c.nombre, celular: c.celular, nuevo: false };
          else if (!cliente.nombre) faltan.push("cliente_nombre");
        }
      }
      if (!servicios.length) faltan.push("servicios");
      const entrega = entregaPrometida(m.entrega_prometida, ctx.hoy);
      if (entrega === undefined) faltan.push("entrega_prometida");
      return {
        datos: {
          placa: placaOk, vehiculoId, cliente, servicios, kilometraje: m.kilometraje, observaciones: m.observaciones,
          entregaPrometida: entrega?.toISOString() ?? null, entregaTexto: entrega ? cuandoEntrega(entrega) : "por definir",
        },
        faltan,
      };
    }
    case "avance": {
      if (!placaOk) return { datos: { archivos: previo.archivos ?? [] }, faltan: ["placa"] };
      const { orden } = await ordenDe(ctx, placaOk);
      if (!orden) return { respuesta: { texto: `No encontré una orden abierta de ${placaBonita(placaOk)} que puedas actualizar.` } };
      const archivos = [...((previo.archivos as { ruta: string; mime: string }[] | undefined) ?? [])];
      if (archivo) {
        const ruta = await subir(ctx, "ordenes", `${ctx.empresa}/${orden.id}/${randomUUID()}`, archivo);
        if (ruta) archivos.push({ ruta, mime: archivo.mime });
      }
      const texto = (m.texto_avance ?? m.observaciones ?? "").trim();
      if (!texto && !m.nuevo_estado && !archivos.length) faltan.push("texto_avance");
      return { datos: { placa: placaOk, ordenId: orden.id, ordenNumero: orden.numero, texto: texto || (archivos.length ? "Fotos del trabajo" : ""), estado: m.nuevo_estado, archivos }, faltan };
    }
    case "pago": {
      if (!placaOk) return { datos: {}, faltan: ["placa"] };
      const { orden } = await ordenDe(ctx, placaOk, false);
      if (!orden) return { respuesta: { texto: `No encontré órdenes de ${placaBonita(placaOk)}.` } };
      if (!m.monto || m.monto <= 0) faltan.push("monto");
      if (!m.medio_pago) faltan.push("medio_pago");
      const saldo = await saldoDe(ctx, orden.id);
      const tipo = m.tipo_pago ?? (saldo !== null && m.monto && m.monto >= saldo - 0.009 ? "saldo" : "abono");
      return { datos: { placa: placaOk, ordenId: orden.id, ordenNumero: orden.numero, monto: m.monto, medio: m.medio_pago, tipo, saldo }, faltan };
    }
    case "cita": {
      const celular = normalizarCelular(m.cliente_celular ?? "");
      if (!celular) faltan.push("cliente_celular");
      let nombre = m.cliente_nombre;
      if (celular && !nombre) {
        const { data: c } = await ctx.db.from("clientes").select("nombre").eq("empresa_id", ctx.empresa).eq("celular", celular).maybeSingle();
        nombre = c?.nombre ?? null;
      }
      if (!nombre) faltan.push("cliente_nombre");
      const cuando = m.fecha_hora && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(m.fecha_hora) ? new Date(`${m.fecha_hora.slice(0, 16)}:00-05:00`) : null;
      if (!cuando || Number.isNaN(cuando.getTime()) || cuando.getTime() < Date.now() - 3600_000) faltan.push("fecha_hora");
      const servicio = (m.servicios[0] ?? "").trim() || "Por definir";
      const cuandoTexto = cuando ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(cuando) : "";
      return { datos: { nombre, celular, fechaHora: cuando?.toISOString() ?? null, cuandoTexto, servicio: servicio.slice(0, 120), red: m.red_origen ?? "whatsapp", campana: m.campana }, faltan };
    }
    case "cotizacion": {
      if (!placaOk) return { datos: {}, faltan: ["placa"] };
      const { orden } = await ordenDe(ctx, placaOk);
      if (!orden) return { respuesta: { texto: `No encontré una orden abierta de ${placaBonita(placaOk)} para cotizar.` } };
      const items = (m.items_cotizacion.length ? m.items_cotizacion : itemsDesdeTexto(m.observaciones ?? ""))
        .filter((i) => i.descripcion.trim().length >= 2 && i.precio_con_igv > 0 && i.cantidad > 0)
        .map((i) => ({ descripcion: i.descripcion.trim().slice(0, 200), tipo: i.tipo, cantidad: i.cantidad, precio: i.precio_con_igv }));
      if (!items.length) faltan.push("items_cotizacion");
      return { datos: { placa: placaOk, ordenId: orden.id, ordenNumero: orden.numero, items }, faltan };
    }
    case "recepcion": {
      const items = m.items_compra.map((i) => ({ ...i, descripcion: i.descripcion.trim() })).filter((i) => i.descripcion.length >= 2 && i.cantidad > 0).slice(0, 30);
      if (!items.length) faltan.push("items_compra");
      const proveedor = m.proveedor?.trim() || null;
      if (!proveedor) faltan.push("proveedor");
      let orden: { id: string; numero: number } | null = null;
      if (placaOk) {
        orden = (await ordenDe(ctx, placaOk)).orden;
        if (!orden) return { respuesta: { texto: `No encontré una orden abierta de ${placaBonita(placaOk)}. Si los repuestos son para el almacén, manda el mensaje sin la placa.` } };
      }
      // Sin placa van al inventario: se busca cada repuesto por su nombre o código.
      const { data: repuestos } = orden ? { data: [] } : await ctx.db.from("repuestos").select("id, codigo, nombre").eq("empresa_id", ctx.empresa).eq("activo", true);
      const simple = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
      const buscar = (desc: string) => {
        const d = simple(desc);
        const palabras = d.split(" ").filter((w) => w.length >= 3);
        let mejor: { id: string; codigo: string; nombre: string; puntos: number } | null = null;
        for (const r of (repuestos ?? []) as { id: string; codigo: string; nombre: string }[]) {
          const nombre = simple(r.nombre);
          if (simple(r.codigo) && d.includes(simple(r.codigo))) return { ...r, puntos: 99 };
          const puntos = palabras.filter((w) => nombre.includes(w)).length;
          if (puntos >= Math.min(2, palabras.length) && (!mejor || puntos > mejor.puntos)) mejor = { ...r, puntos };
        }
        return mejor;
      };
      const fotos = [...((previo.fotos as { ruta: string }[] | undefined) ?? [])];
      if (archivo && archivo.mime.startsWith("image/")) {
        const ruta = await subir(ctx, "comprobantes", `${ctx.empresa}/compras/${randomUUID()}`, archivo);
        if (ruta) fotos.push({ ruta });
      }
      if (!fotos.length && !previo.sinFoto && !faltan.length) faltan.push("foto_evidencia");
      const comp = /^([FB][A-Z0-9]{3})-(\d{1,8})$/.exec((m.comprobante ?? "").toUpperCase().replace(/\s+/g, ""));
      return {
        datos: {
          proveedor, comprobante: comp ? `${comp[1]}-${comp[2]}` : null, placa: orden ? placaOk : null, ordenId: orden?.id ?? null, ordenNumero: orden?.numero ?? null, fotos, sinFoto: Boolean(previo.sinFoto),
          items: items.map((i) => {
            const r = orden ? null : buscar(i.descripcion);
            return { descripcion: i.descripcion.slice(0, 200), cantidad: i.cantidad, precio: i.precio_unitario, repuestoId: r?.id ?? null, repuesto: r ? `${r.codigo} ${r.nombre}` : null };
          }),
        },
        faltan,
      };
    }
    case "compra":
    case "comprobante_venta": {
      if (!previo.lectura) return { respuesta: { texto: "Manda la foto o el PDF del comprobante y lo leo. También puedes registrarlo en la app." } };
      let orden: { id: string; numero: number } | null = null;
      if (placaOk) orden = (await ordenDe(ctx, placaOk, intencion === "comprobante_venta" ? false : true)).orden;
      return { datos: { lectura: previo.lectura, archivo: previo.archivo, placa: orden ? placaOk : null, ordenId: orden?.id ?? null, ordenNumero: orden?.numero ?? null }, faltan };
    }
    default:
      return { respuesta: ayuda(ctx.roles, ctx.nombre) };
  }
}

async function saldoDe(ctx: Ctx, ordenId: string): Promise<number | null> {
  const [{ data: comps }, { data: cots }, { data: pagos }, { data: notas }] = await Promise.all([
    ctx.db.from("comprobantes_venta").select("total").eq("orden_id", ordenId).eq("estado", "confirmado"),
    ctx.db.from("cotizaciones").select("total").eq("orden_id", ordenId).eq("estado", "aprobada"),
    ctx.db.from("pagos").select("monto, tipo").eq("orden_id", ordenId).eq("estado", "confirmado"),
    ctx.db.from("notas_credito").select("total").eq("orden_id", ordenId).eq("estado", "confirmado"),
  ]);
  if (!comps && !cots) return null;
  const suma = (l: { total: number | string }[] | null) => (l ?? []).reduce((a, x) => a + Number(x.total), 0);
  return calcularSaldo({
    totalComprobantes: redondear(suma(comps) - suma(notas)),
    totalCotizacionesAprobadas: redondear(suma(cots)),
    pagado: redondear((pagos ?? []).reduce((a, p) => a + montoNeto({ tipo: p.tipo, monto: Number(p.monto) }), 0)),
    conComprobante: (comps ?? []).length > 0,
  }).saldo;
}

async function verHistorial(ctx: Ctx, placaCruda: string | null): Promise<Respuesta> {
  const placa = placaCruda ? validarPlaca(placaCruda) : null;
  if (!placa || placa.estado === "invalida") return { texto: "¿De qué placa? Escribe por ejemplo «historial ABC123»." };
  const { data: v } = await ctx.db.from("vehiculos").select("id").eq("empresa_id", ctx.empresa).eq("placa", placa.placa).maybeSingle();
  if (!v) return { texto: historial(placa.placa, []) };
  const { data } = await ctx.db.from("ordenes_trabajo").select("numero, creado_en, estado, orden_servicios (descripcion)").eq("vehiculo_id", v.id).eq("anulada", false).order("creado_en", { ascending: false }).limit(6);
  type F = { numero: number; creado_en: string; estado: string; orden_servicios: { descripcion: string }[] | null };
  return {
    texto: historial(
      placa.placa,
      ((data ?? []) as F[]).map((o) => ({ numero: o.numero, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(o.creado_en)), estado: o.estado, servicios: (o.orden_servicios ?? []).map((s) => s.descripcion) })),
    ),
  };
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov" };

/** Sube un archivo con la sesión de la persona (la base revisa el permiso). */
async function subir(ctx: Ctx, bucket: "ordenes" | "comprobantes", rutaSinExtension: string, a: Archivo): Promise<string | undefined> {
  const ruta = `${rutaSinExtension}.${EXT[a.mime] ?? "bin"}`;
  const { error } = await ctx.db.storage.from(bucket).upload(ruta, a.datos, { contentType: a.mime, upsert: false });
  return error ? undefined : ruta;
}

// ---------------------------------------------------------------------------
// Guardar (solo después de «Confirmar»), con la sesión de la persona
// ---------------------------------------------------------------------------
type Hecho = { ok: boolean; texto: string; ids?: Record<string, string> };

async function ejecutar(ctx: Ctx, intencion: string, d: Record<string, unknown>): Promise<Hecho> {
  const falla = (texto: string): Hecho => ({ ok: false, texto: `No se guardó: ${texto}` });
  const { db, empresa } = ctx;
  switch (intencion) {
    case "nuevo_ingreso": {
      const c = d.cliente as { id?: string; nombre: string; celular: string; nuevo: boolean };
      let clienteId = c.id;
      if (!clienteId) {
        const { data, error } = await db.from("clientes").insert({ empresa_id: empresa, celular: c.celular, nombre: c.nombre, origen: "otro" }).select("id").single();
        if (error || !data) return falla("no se pudo crear al cliente.");
        clienteId = data.id;
      }
      let vehiculoId = d.vehiculoId as string | null;
      if (!vehiculoId) {
        const { data, error } = await db.from("vehiculos").insert({ empresa_id: empresa, placa: d.placa, cliente_id: clienteId }).select("id").single();
        if (error || !data) return falla("no se pudo registrar el carro.");
        vehiculoId = data.id;
      }
      const { data: orden, error } = await db
        .from("ordenes_trabajo")
        .insert({
          empresa_id: empresa, vehiculo_id: vehiculoId, cliente_id: clienteId, kilometraje_ingreso: d.kilometraje ?? null, observaciones_ingreso: d.observaciones ?? null,
          entrega_prometida: (d.entregaPrometida as string | null | undefined) ?? null,
        })
        .select("id, numero")
        .single();
      if (error || !orden) return falla("no se pudo abrir la orden (revisa tu rol).");
      const { data: catalogo } = await db.from("catalogo_servicios").select("id, nombre").eq("empresa_id", empresa).eq("activo", true);
      const simple = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      await db.from("orden_servicios").insert(
        (d.servicios as string[]).map((s) => ({
          empresa_id: empresa, orden_id: orden.id, descripcion: s.slice(0, 160),
          servicio_id: (catalogo ?? []).find((x) => simple(x.nombre).includes(simple(s)) || simple(s).includes(simple(x.nombre)))?.id ?? null,
        })),
      );
      const promesa = d.entregaPrometida
        ? ` Entrega prometida: ${String(d.entregaTexto)}; te aviso si se acerca la hora y el carro no está listo.`
        : " La hora de entrega quedó por definir: ponla en la orden cuando la sepas.";
      return { ok: true, texto: `✅ Orden *OT-${String(orden.numero).padStart(6, "0")}* abierta para ${placaBonita(String(d.placa))}.${promesa} Agrega las fotos del ingreso en la app o mándalas aquí con la placa.`, ids: { orden: orden.id } };
    }
    case "avance": {
      const ordenId = String(d.ordenId);
      let avanceId: string | undefined;
      if (d.texto) {
        const { data, error } = await db.from("orden_avances").insert({ empresa_id: empresa, orden_id: ordenId, texto: String(d.texto).slice(0, 2000), autor_id: ctx.perfil, origen: "whatsapp" }).select("id").single();
        if (error) return falla("no tienes permiso para actualizar esa orden.");
        avanceId = data?.id;
      }
      for (const a of (d.archivos as { ruta: string; mime: string }[] | undefined) ?? []) {
        await db.from("archivos").insert({ empresa_id: empresa, orden_id: ordenId, avance_id: avanceId ?? null, tipo: a.mime.startsWith("video/") ? "video" : "foto", etapa: "proceso", bucket: "ordenes", ruta: a.ruta, mime: a.mime, subido_por: ctx.perfil });
      }
      if (d.estado) {
        const { error } = await db.rpc("cambiar_estado_orden", { p_orden: ordenId, p_estado: d.estado, p_nota: "Por WhatsApp" });
        if (error) return { ok: true, texto: `Guardé el avance, pero no pude cambiar el estado: ${error.message}` };
      }
      return { ok: true, texto: `✅ Avance guardado en OT-${String(d.ordenNumero).padStart(6, "0")}${d.estado ? ` · estado: ${String(d.estado).replace("_", " ")}` : ""}.` };
    }
    case "pago": {
      const { data, error } = await db.from("pagos").insert({ empresa_id: empresa, orden_id: d.ordenId, monto: d.monto, tipo: d.tipo, medio: d.medio, origen: "whatsapp" }).select("id").single();
      if (error || !data) return falla("tu rol no registra pagos o la caja está cerrada.");
      return { ok: true, texto: "✅ Pago registrado. Queda *por confirmar*: revísalo en Caja → Cobros.", ids: { pago: data.id } };
    }
    case "cita": {
      const { data: cliente } = await db.from("clientes").select("id").eq("empresa_id", empresa).eq("celular", d.celular).maybeSingle();
      const { error } = await db.from("citas").insert({
        empresa_id: empresa, cliente_id: cliente?.id ?? null, nombre_cliente: d.nombre, celular: d.celular, fecha_hora: d.fechaHora, servicio: d.servicio,
        red: d.red, campana: d.campana ?? null, vendedor_id: ctx.roles.includes("vendedor_redes") ? ctx.perfil : null,
      });
      if (error) return falla("no se pudo agendar la cita.");
      return { ok: true, texto: `✅ Cita agendada: ${d.cuandoTexto}.` };
    }
    case "cotizacion": {
      const { data: cfg } = await db.from("configuracion_empresa").select("tasa_igv").eq("empresa_id", empresa).maybeSingle();
      const tasa = Number(cfg?.tasa_igv ?? 0.18);
      const items = (d.items as { descripcion: string; tipo: string; cantidad: number; precio: number }[]).map((l) => {
        const m = desdeTotal(l.cantidad * l.precio, tasa);
        return { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio: redondear(m.total / l.cantidad), sin_igv: m.sinIgv, igv: m.igv, total: m.total };
      });
      const { error } = await db.rpc("crear_cotizacion", { p_orden: d.ordenId, p_adicional: false, p_items: items, p_con_igv: true });
      if (error) return falla("no se pudo crear la cotización.");
      return { ok: true, texto: `✅ Cotización creada en OT-${String(d.ordenNumero).padStart(6, "0")}. Envíala al cliente desde la orden.` };
    }
    case "recepcion": {
      const items = d.items as { descripcion: string; cantidad: number; precio: number | null; repuestoId: string | null }[];
      const comp = typeof d.comprobante === "string" ? /^([FB][A-Z0-9]{3})-(\d{1,8})$/.exec(d.comprobante) : null;
      const tipo = comp ? (comp[1].startsWith("F") ? "factura" : "boleta") : "sin_comprobante";
      const { data: cfg } = await db.from("configuracion_empresa").select("tasa_igv").eq("empresa_id", empresa).maybeSingle();
      const tasa = tipo === "factura" ? Number(cfg?.tasa_igv ?? 0.18) : 0;
      const lineas = items.map((x) => {
        const m = montosLinea({ cantidad: x.cantidad, precioUnitario: x.precio ?? 0, incluyeIgv: true }, tasa);
        return { descripcion: x.descripcion, cantidad: x.cantidad, precio_sin_igv: redondear(m.sinIgv / x.cantidad), sin_igv: m.sinIgv, igv: m.igv, total: m.total, orden: d.ordenId ?? null, repuesto: d.ordenId ? null : x.repuestoId };
      });
      const t = sumarMontos(lineas.map((i) => ({ sinIgv: i.sin_igv, igv: i.igv, total: i.total })));
      const fotos = (d.fotos as { ruta: string }[] | undefined) ?? [];
      const { error } = await db.rpc("registrar_compra", {
        p_empresa: empresa,
        p_proveedor: { ruc: null, razon_social: String(d.proveedor).slice(0, 160) },
        p_compra: { tipo, serie: comp?.[1] ?? null, numero: comp?.[2].replace(/^0+(?=\d)/, "") ?? null, fecha: ctx.hoy, moneda: "PEN", tipo_cambio: 1, tasa_igv: tasa, sin_igv: t.sinIgv, igv: t.igv, total: t.total, origen: "ia", archivo: fotos[0]?.ruta ?? null },
        p_items: lineas,
      });
      if (error) return falla(error.code === "23505" ? "esa compra ya estaba registrada." : "tu rol no registra compras o faltan datos.");
      const sinPrecio = items.some((x) => x.precio === null);
      return {
        ok: true,
        texto: `✅ Recepción registrada: ${items.length} ${items.length === 1 ? "repuesto" : "repuestos"} de ${d.proveedor}${t.total ? ` por S/ ${t.total.toFixed(2)}` : ""}. Queda *por confirmar* en Compras → Por confirmar; al confirmarla entra ${d.ordenId ? "a la orden" : "al inventario"}.${sinPrecio ? " Faltan precios: complétalos al confirmar." : ""}`,
      };
    }
    case "compra": {
      const l = d.lectura as ComprobanteLeido;
      const tipo = ["factura", "boleta", "nota_venta", "ticket"].includes(l.tipo) ? l.tipo : "ticket";
      const { data: cfg } = await db.from("configuracion_empresa").select("tasa_igv").eq("empresa_id", empresa).maybeSingle();
      const tasa = tipo === "factura" ? Number(cfg?.tasa_igv ?? 0.18) : 0;
      const lineas = l.lineas.length ? l.lineas : [{ descripcion: "Según comprobante", cantidad: 1, precio_unitario: l.total ?? 0, importe: l.total ?? 0 }];
      const items = lineas.map((x) => {
        const m = montosLinea({ cantidad: x.cantidad || 1, precioUnitario: x.precio_unitario || x.importe, incluyeIgv: l.precios_incluyen_igv }, tasa);
        return { descripcion: x.descripcion.slice(0, 200), cantidad: x.cantidad || 1, precio_sin_igv: redondear(m.sinIgv / (x.cantidad || 1)), sin_igv: m.sinIgv, igv: m.igv, total: m.total, orden: d.ordenId ?? null };
      });
      const t = sumarMontos(items.map((i) => ({ sinIgv: i.sin_igv, igv: i.igv, total: i.total })));
      const serie = (l.serie ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || null;
      const numero = (l.numero ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 8) || null;
      const ruc = l.emisor_ruc && /^(10|15|17|20)\d{9}$/.test(l.emisor_ruc) ? l.emisor_ruc : null;
      const { error } = await db.rpc("registrar_compra", {
        p_empresa: empresa,
        p_proveedor: { ruc, razon_social: (l.emisor_nombre ?? "Proveedor por revisar").slice(0, 160) },
        p_compra: { tipo: serie && numero ? tipo : "sin_comprobante", serie: serie && numero ? serie : null, numero: serie && numero ? numero : null, fecha: l.fecha && /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) ? l.fecha : ctx.hoy, moneda: l.moneda, tipo_cambio: 1, tasa_igv: tasa, sin_igv: t.sinIgv, igv: t.igv, total: t.total, origen: "ia", archivo: d.archivo ?? null },
        p_items: items,
      });
      if (error) return falla(error.code === "23505" ? "esa compra ya estaba registrada." : "tu rol no registra compras o faltan datos.");
      return { ok: true, texto: "✅ Compra registrada. Queda *por confirmar*: revísala en Compras → Por confirmar." };
    }
    case "comprobante_venta": {
      const l = d.lectura as ComprobanteLeido;
      const serie = (l.serie ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      const numero = (l.numero ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 8);
      const total = l.total ?? l.lineas.reduce((a, x) => a + x.importe, 0);
      if (!serie || !numero || !(total > 0)) return falla("no se leyeron la serie, el número o el total. Regístralo en la app.");
      const { data: cfg } = await db.from("configuracion_empresa").select("tasa_igv").eq("empresa_id", empresa).maybeSingle();
      const tasa = Number(cfg?.tasa_igv ?? 0.18);
      const m = l.subtotal_sin_igv !== null && l.igv !== null && Math.abs(l.subtotal_sin_igv + l.igv - total) <= 0.05 ? { sinIgv: l.subtotal_sin_igv, igv: l.igv, total } : desdeTotal(total, tasa);
      const { error } = await db.from("comprobantes_venta").insert({
        empresa_id: empresa, orden_id: d.ordenId ?? null, tipo: l.tipo === "factura" ? "factura" : "boleta", serie, numero, fecha_emision: l.fecha && /^\d{4}-\d{2}-\d{2}$/.test(l.fecha) ? l.fecha : ctx.hoy,
        documento_cliente: l.cliente_documento?.replace(/\D/g, "").slice(0, 11) || null, tasa_igv: tasa, subtotal_sin_igv: m.sinIgv, igv: m.igv, total: m.total,
        detalle: l.lineas.map((x) => `${x.cantidad} × ${x.descripcion}`).join("\n").slice(0, 2000) || null, origen_datos: "ia", archivo_path: d.archivo ?? null,
      });
      if (error) return falla(error.code === "23505" ? "ese comprobante ya estaba registrado." : "tu rol no registra comprobantes.");
      return { ok: true, texto: "✅ Comprobante registrado. Queda *por confirmar*: revísalo en Caja → Comprobantes." };
    }
    default:
      return falla("no sé cómo guardar esto.");
  }
}
