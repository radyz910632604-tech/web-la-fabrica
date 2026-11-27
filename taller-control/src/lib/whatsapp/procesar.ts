import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarCelular } from "@/lib/celulares";
import { desdeTotal, montoNeto, montosLinea, redondear, saldo as calcularSaldo, sumarMontos } from "@/lib/dinero";
import { mensajeVacio, type ComprobanteLeido, type Intencion, type MensajeInterpretado, type PlacaLeida } from "@/lib/ia/esquemas";
import { interpretarMensaje, leerComprobante, leerPlaca, leerRepuestos, transcribirAudio, type Archivo } from "@/lib/ia/proveedor";
import { fechaHoraDesdeTexto, interpretarSinIa, itemsDesdeTexto, normalizarPlaca } from "@/lib/ia/sin-ia";
import { cuandoEntrega } from "@/lib/taller/entrega";
import { NOMBRE_ESTADO, type EstadoOrden } from "@/lib/taller/estados";
import { cuadreComprobante } from "@/lib/avisos/textos";
import { validarPlaca } from "@/lib/placas";
import { CAJA, tieneAlguno, type Rol } from "@/lib/roles";
import { pdfCaja, pdfCotizacion, pdfHistorial, pdfOrden, pdfRecibo, type Pdf } from "@/lib/pdf/documentos";
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

/** Guarda ya (sin «¿Confirmo?») y deja el borrador como confirmado, para poder corregirlo después. */
async function guardarAhora(ctx: Ctx, intencion: string, datos: Record<string, unknown>, borradorId?: string): Promise<{ texto: string; ok: boolean; id?: string }> {
  // En repuestos, la lista de lo que se cargó (y qué se reconoció del inventario) va en la respuesta.
  const lista = intencion === "recepcion" ? `${resumen(intencion, datos)}\n\n` : "";
  let id = borradorId;
  if (!id) {
    const { data } = await ctx.db.from("borradores_whatsapp").insert({ empresa_id: ctx.empresa, perfil_id: ctx.perfil, intencion, datos, faltan: [], resumen: null }).select("id").single();
    id = data?.id;
  }
  const r = await ejecutar(ctx, intencion, datos);
  if (id) await ctx.db.from("borradores_whatsapp").update({ estado: r.ok ? "confirmado" : "fallido", resultado: r, datos }).eq("id", id);
  return { texto: r.ok && CORREGIBLES.has(intencion) ? `${r.texto}${PIE_CORREGIR}` : r.ok ? `${lista}${r.texto}` : r.texto, ok: r.ok, id };
}

type Ctx = { db: SupabaseClient; empresa: string; perfil: string; nombre: string; roles: Rol[]; celular: string; hoy: string };
type Preparado = { datos: Record<string, unknown>; faltan: string[] } | { respuesta: Respuesta; resultado?: string };

const hoyLima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const ahoraTexto = () =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
const SI = /^(si|sí|ok|okey|dale|confirmo|confirmar|correcto|listo)\.?$/i;
/**
 * Lo que se guarda al toque y se avisa (la persona corrige después si hace falta).
 * Pagos y cotizaciones se muestran antes con «Confirmar»: tocan lo que paga el cliente.
 * Compras y comprobantes leídos por IA igual quedan «por confirmar» en la app (lo fuerza la base).
 */
const DIRECTAS = new Set(["nuevo_ingreso", "avance", "repuestos", "recepcion", "compra", "comprobante_venta", "cita"]);
const CORREGIBLES = new Set(["nuevo_ingreso", "avance"]);
const PIE_CORREGIR = "\n\n¿Algo que corregir? Dímelo, por ejemplo «No, el kilometraje es 58 mil».";
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
    if ((b.faltan ?? []).length) return listo({ texto: pedirDato(b.faltan[0], b.datos as Record<string, unknown>) }, "pide_dato");
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

  // Fotos seguidas sin texto mientras se espera la placa: se juntan y no se vuelve a preguntar.
  if (pendiente && pendiente.intencion === "avance" && pendiente.faltan.includes("placa") && archivo?.mime.startsWith("image/") && !texto) {
    const pl = await leerPlaca(archivo);
    if (!pl.ok || !pl.datos.placa) {
      const temporales = [...((pendiente.datos.temporales as Temporal[] | undefined) ?? [])];
      const t = await subirTemporal(ctx, archivo, pl.ok ? pl.datos : null);
      if (t) temporales.push(t);
      await ctx.db.from("borradores_whatsapp").update({ datos: { ...pendiente.datos, temporales } }).eq("id", pendiente.id);
      extra.borrador_id = pendiente.id;
      return listo({ texto: `📷 Van ${temporales.length} fotos.` }, "pide_dato");
    }
  }

  // Si nombra OTRA placa, no es la respuesta a lo pendiente: se deja y se atiende como mensaje nuevo.
  const placaNueva = normalizarPlaca(texto);
  const placaPendiente = typeof pendiente?.datos.placa === "string" ? pendiente.datos.placa : null;
  const otroCarro = Boolean(pendiente && placaNueva && placaPendiente && placaNueva !== placaPendiente);

  // ¿Completa un dato que se pidió antes?
  if (pendiente && pendiente.faltan.length && !otroCarro) {
    const m0 = (pendiente.datos.m ?? mensajeVacio(pendiente.intencion as Intencion)) as MensajeInterpretado;
    const m = await completar(ctx, m0, pendiente.faltan, texto, archivo);
    // En la recepción de repuestos, «sin foto» deja seguir sin evidencia.
    const previoDatos = pendiente.intencion === "recepcion" && /\bsin foto\b|no tengo foto/i.test(texto) ? { ...pendiente.datos, sinFoto: true } : pendiente.datos;
    const conArchivo = archivo && ["avance", "recepcion", "repuestos"].includes(pendiente.intencion) ? archivo : undefined;
    const p = await preparar(ctx, pendiente.intencion as Intencion, m, conArchivo, previoDatos);
    extra.borrador_id = pendiente.id;
    extra.intencion = pendiente.intencion;
    if ("respuesta" in p) {
      await ctx.db.from("borradores_whatsapp").update({ estado: "corregido" }).eq("id", pendiente.id);
      return listo(p.respuesta, p.resultado ?? "respondido");
    }
    const res = resumen(pendiente.intencion, p.datos);
    await ctx.db.from("borradores_whatsapp").update({ datos: { ...p.datos, m }, faltan: p.faltan, resumen: res }).eq("id", pendiente.id);
    if (p.faltan.length) return listo({ texto: pedirDato(p.faltan[0], p.datos) }, "pide_dato");
    if (DIRECTAS.has(pendiente.intencion)) {
      const g = await guardarAhora(ctx, pendiente.intencion, { ...p.datos, m }, pendiente.id);
      return listo({ texto: g.texto }, g.ok ? "confirmado" : "error");
    }
    return listo({ texto: `${res}\n\n¿Lo guardo?`, botones: botonesConfirmar(pendiente.id) }, "borrador");
  }
  if (pendiente) await ctx.db.from("borradores_whatsapp").update({ estado: "corregido" }).eq("id", pendiente.id);

  // Foto o PDF sin texto: comprobante, placa o evidencia.
  let m: MensajeInterpretado;
  let lectura: { lectura: ComprobanteLeido; archivo?: string } | undefined;
  let foto: PlacaLeida | null = null;
  const esDocumento = archivo && (archivo.mime === "application/pdf" || /factura|boleta|ticket|compra|comprobante/i.test(texto));
  // Toda foto se mira primero: qué muestra (placa, tablero, daño, repuestos, un papel…).
  if (archivo && e.tipo !== "video" && !esDocumento && archivo.mime.startsWith("image/")) {
    const pl = await leerPlaca(archivo);
    foto = pl.ok ? pl.datos : null;
  }
  const esRepuestos = archivo && foto?.tipo_foto === "repuestos" && tieneAlguno(ctx.roles, PERMITIDO.repuestos) && !/llegaron|lleg[oó]|proveedor|factura|compr/i.test(texto);
  if (esRepuestos) {
    const v = await leerRepuestos(archivo!);
    const extraTexto = texto ? (await interpretar(ctx, texto)).items_compra : [];
    m = {
      ...mensajeVacio("repuestos"),
      placa: normalizarPlaca(texto) ?? (v.ok ? v.datos.placa : null) ?? foto?.placa ?? null,
      items_compra: [...(v.ok ? v.datos.items.map((i) => ({ descripcion: [i.codigo, i.descripcion].filter(Boolean).join(" "), cantidad: i.cantidad, precio_unitario: null })) : []), ...extraTexto],
    };
  } else if (archivo && e.tipo !== "video" && (esDocumento || !texto)) {
    const pista = tieneAlguno(ctx.roles, ["almacen"]) || /factura|compra|proveedor/i.test(texto) ? "compra" : /boleta|venta|cliente/i.test(texto) ? "venta" : tieneAlguno(ctx.roles, ["recepcion"]) ? "venta" : "compra";
    const r = esDocumento || foto?.tipo_foto === "documento" ? await leerComprobante(archivo, pista) : null;
    if (r?.ok && r.datos.es_comprobante) {
      const destino = pista === "compra" ? "compras" : "ventas";
      lectura = { lectura: r.datos, archivo: await subir(ctx, "comprobantes", `${ctx.empresa}/${destino}/${randomUUID()}`, archivo) };
      m = { ...mensajeVacio(pista === "compra" ? "compra" : "comprobante_venta"), placa: normalizarPlaca(texto) ?? r.datos.placa };
    } else if (!texto) {
      m = { ...mensajeVacio("avance"), placa: foto?.placa ?? null };
      if (!m.placa) {
        if (!tieneAlguno(ctx.roles, PERMITIDO.avance)) return listo({ texto: "Recibí la foto, pero tu rol no sube fotos a las órdenes." }, "rechazado");
        const t = await subirTemporal(ctx, archivo, foto);
        const { data: b } = await ctx.db
          .from("borradores_whatsapp")
          .insert({ empresa_id: ctx.empresa, perfil_id: ctx.perfil, intencion: "avance", datos: { temporales: t ? [t] : [], m }, faltan: ["placa"], resumen: null })
          .select("id")
          .single();
        extra.borrador_id = b?.id;
        return listo({ texto: "📷 Recibí la foto. ¿De qué placa es? Si vas a mandar más fotos del mismo carro, mándalas y al final me dices la placa." }, "pide_dato");
      }
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

  if (m.intencion === "correccion") {
    const c = await corregir(ctx, m);
    return listo({ texto: c.texto }, c.ok ? "corregido" : "respondido");
  }

  const previoBase: Record<string, unknown> = lectura ? { lectura: lectura.lectura, archivo: lectura.archivo } : foto ? { foto } : {};
  const p = await preparar(ctx, m.intencion, m, ["avance", "recepcion", "repuestos"].includes(m.intencion) ? archivo : undefined, previoBase);
  if ("respuesta" in p) return listo(p.respuesta, p.resultado ?? "respondido");
  if (!p.faltan.length && DIRECTAS.has(m.intencion)) {
    const g = await guardarAhora(ctx, m.intencion, { ...p.datos, m });
    extra.borrador_id = g.id;
    return listo({ texto: g.texto }, g.ok ? "confirmado" : "error");
  }
  const res = resumen(m.intencion, p.datos);
  const { data: b, error } = await ctx.db
    .from("borradores_whatsapp")
    .insert({ empresa_id: ctx.empresa, perfil_id: ctx.perfil, intencion: m.intencion, datos: { ...p.datos, m }, faltan: p.faltan, resumen: res })
    .select("id")
    .single();
  if (error || !b) return listo({ texto: "No pude preparar el registro. Intenta otra vez." }, "error");
  extra.borrador_id = b.id;
  return p.faltan.length
    ? listo({ texto: pedirDato(p.faltan[0], p.datos) }, "pide_dato")
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
    if (campo.startsWith("costo:")) {
      const i = Number(campo.slice(6));
      const valor = Number((/(\d+(?:[.,]\d{1,2})?)/.exec(texto)?.[1] ?? "").replace(",", "."));
      n.items_compra = itemsValidos(n).map((x, j) => (j === i && valor > 0 ? { ...x, precio_unitario: valor } : x));
    }
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
    if (tipo === "historial") {
      const h = await conCliente(ctx.db, () => pdfHistorial(ctxPdf, placaOk, tieneAlguno(ctx.roles, CAJA)));
      if (!h) return { texto: `No encontré el carro ${placaBonita(placaOk)}.` };
      return await entregarPdf(ctx, h, `Aquí está el historial de ${placaBonita(placaOk)}.`);
    }
    const { orden } = await ordenDe(ctx, placaOk, false);
    if (!orden) return { texto: `No encontré órdenes de ${placaBonita(placaOk)}.` };
    const ot = `OT-${String(orden.numero).padStart(6, "0")}`;
    if (tipo === "orden" || tipo === "resumen") {
      // El resumen para facturar es la orden con servicios, repuestos, abonos y total (solo para quien ve la caja).
      if (tipo === "resumen" && !tieneAlguno(ctx.roles, CAJA)) return { texto: "El resumen para facturar lo piden caja, el asesor y gerencia." };
      pdf = await conCliente(ctx.db, () => pdfOrden(ctxPdf, orden.id, tieneAlguno(ctx.roles, CAJA)));
      texto = tipo === "resumen" ? `Aquí está el resumen para facturar de ${placaBonita(placaOk)} (${ot}): servicios, repuestos, abonos y total.` : `Aquí está la orden de reparación ${ot} de ${placaBonita(placaOk)}.`;
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
  return entregarPdf(ctx, pdf, texto);
}

/** Deja el PDF un momento en el bucket «documentos» para que WhatsApp lo descargue con un enlace que vence en una hora. */
async function entregarPdf(ctx: Ctx, pdf: NonNullable<Pdf>, texto: string): Promise<Respuesta> {
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
          carro: { marca: m.marca?.trim() || null, modelo: m.modelo?.trim() || null, anio: m.anio && m.anio >= 1950 && m.anio <= 2100 ? Math.round(m.anio) : null, color: m.color?.trim() || null },
          entregaPrometida: entrega?.toISOString() ?? null, entregaTexto: entrega ? cuandoEntrega(entrega) : "por definir",
        },
        faltan,
      };
    }
    case "avance": {
      const temporales = (previo.temporales as Temporal[] | undefined) ?? [];
      if (!placaOk) return { datos: { temporales, m }, faltan: ["placa"] };
      const { orden } = await ordenDe(ctx, placaOk);
      if (!orden) {
        const { vehiculo } = await ordenDe(ctx, placaOk, false);
        // Quien no abre ingresos (técnico) solo ve sus órdenes: no se le ofrece abrir una.
        if (!tieneAlguno(ctx.roles, PERMITIDO.nuevo_ingreso)) return { respuesta: { texto: `No tienes una orden abierta de ${placaBonita(placaOk)}. Revisa la placa o pregúntale al asesor.` } };
        return { respuesta: { texto: vehiculo ? `${placaBonita(placaOk)} no tiene una orden abierta. Si volvió al taller, mándame el ingreso.` : `No tengo ningún carro con placa ${placaBonita(placaOk)} en taller. ¿Es un ingreso nuevo? Mándame los datos: «Ingresa placa ${placaBonita(placaOk)}, cliente…, por…».` } };
      }
      const archivos = [...((previo.archivos as Adjunto[] | undefined) ?? [])];
      // Las fotos que llegaron antes de saber la placa pasan a la carpeta de la orden.
      for (const t of temporales) {
        const destino = `${ctx.empresa}/${orden.id}/${t.ruta.split("/").pop()!.replace(/^pendiente-/, "")}`;
        const { error } = await clienteAdmin().storage.from("ordenes").move(t.ruta, destino);
        if (!error) archivos.push({ ruta: destino, mime: t.mime, etiqueta: t.etiqueta ?? null, km: t.km ?? null });
      }
      if (archivo) {
        const ruta = await subir(ctx, "ordenes", `${ctx.empresa}/${orden.id}/${randomUUID()}`, archivo);
        const f = previo.foto as PlacaLeida | undefined;
        if (ruta) archivos.push({ ruta, mime: archivo.mime, etiqueta: f?.tipo_foto ?? null, km: f?.kilometraje ?? null });
      }
      const texto = (m.texto_avance ?? m.observaciones ?? "").trim();
      const diagnostico = m.diagnostico?.trim() || null;
      if (!texto && !m.nuevo_estado && !archivos.length && !diagnostico) faltan.push("texto_avance");
      const kms = archivos.map((x) => x.km).filter((k): k is number => typeof k === "number" && k > 0);
      return {
        datos: {
          placa: placaOk, ordenId: orden.id, ordenNumero: orden.numero, texto: texto || (archivos.length && !diagnostico && !m.nuevo_estado ? "Fotos del carro" : ""),
          diagnostico, estado: m.nuevo_estado, archivos, kmTablero: kms.length ? Math.max(...kms) : null,
        },
        faltan,
      };
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
    case "repuestos": {
      const temporales = (previo.temporales as Temporal[] | undefined) ?? [];
      if (!placaOk) {
        const t = archivo ? await subirTemporal(ctx, archivo, { placa: null, legible: "no_se_lee", tipo_foto: "repuestos", kilometraje: null }) : undefined;
        return { datos: { temporales: t ? [...temporales, t] : temporales, m }, faltan: ["placa"] };
      }
      const { orden } = await ordenDe(ctx, placaOk);
      if (!orden) return { respuesta: { texto: `No tengo ningún carro con placa ${placaBonita(placaOk)} en taller. Revisa la placa.` } };
      const items = itemsValidos(m);
      if (!items.length) faltan.push("items_compra");
      const { data: inventario } = await ctx.db.from("repuestos").select("id, codigo, nombre, stock, costo_promedio_sin_igv").eq("empresa_id", ctx.empresa).eq("activo", true);
      const lista = (inventario ?? []) as RepuestoInventario[];
      const filas = items.map((i, idx) => {
        const r = emparejarRepuesto(i.descripcion, lista);
        // Si no alcanza el stock, se trata como repuesto comprado aparte.
        const usa = r && Number(r.stock) >= i.cantidad ? r : null;
        const costo = usa ? redondear(Number(usa.costo_promedio_sin_igv) * 1.18) : i.precio_unitario;
        if (!usa && (costo === null || !(costo > 0))) faltan.push(`costo:${idx}`);
        return { descripcion: i.descripcion.slice(0, 200), cantidad: i.cantidad, repuestoId: usa?.id ?? null, repuesto: usa ? `${usa.codigo} ${usa.nombre}` : null, costo: costo ?? null, stock: r ? Number(r.stock) : null };
      });
      const archivos: Adjunto[] = [];
      for (const t of temporales) {
        const destino = `${ctx.empresa}/${orden.id}/${t.ruta.split("/").pop()!.replace(/^pendiente-/, "")}`;
        const { error } = await clienteAdmin().storage.from("ordenes").move(t.ruta, destino);
        if (!error) archivos.push({ ruta: destino, mime: t.mime, etiqueta: "repuestos" });
      }
      for (const a of (previo.archivos as Adjunto[] | undefined) ?? []) archivos.push(a);
      if (archivo?.mime.startsWith("image/")) {
        // El almacén no sube fotos a las órdenes con su sesión; la evidencia del vale la guarda el
        // servidor, solo si esa persona ve la orden (ordenDe ya lo revisó con su sesión).
        const ruta = `${ctx.empresa}/${orden.id}/${randomUUID()}.${EXT[archivo.mime] ?? "jpg"}`;
        const { error } = await clienteAdmin().storage.from("ordenes").upload(ruta, archivo.datos, { contentType: archivo.mime, upsert: false });
        if (!error) archivos.push({ ruta, mime: archivo.mime, etiqueta: "repuestos" });
      }
      return { datos: { placa: placaOk, ordenId: orden.id, ordenNumero: orden.numero, items: filas, archivos }, faltan };
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

type Adjunto = { ruta: string; mime: string; etiqueta?: string | null; km?: number | null };
type RepuestoInventario = { id: string; codigo: string; nombre: string; stock: number | string; costo_promedio_sin_igv: number | string };
const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Ítems que sirven (con nombre y cantidad), en el mismo orden siempre: el «costo:N» que se pregunta apunta a este orden. */
function itemsValidos(m: MensajeInterpretado) {
  return m.items_compra.map((i) => ({ ...i, descripcion: i.descripcion.trim() })).filter((i) => i.descripcion.length >= 2 && i.cantidad > 0).slice(0, 30);
}

/** Busca un repuesto del inventario por código o por las palabras de su nombre. */
function emparejarRepuesto<T extends { codigo: string; nombre: string }>(desc: string, lista: T[]): T | null {
  const simple = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const d = simple(desc);
  const palabras = d.split(" ").filter((w) => w.length >= 3);
  let mejor: (T & { puntos: number }) | null = null;
  for (const r of lista) {
    const nombre = simple(r.nombre);
    if (simple(r.codigo) && d.includes(simple(r.codigo))) return r;
    const puntos = palabras.filter((w) => nombre.includes(w)).length;
    if (puntos >= Math.min(2, palabras.length) && (!mejor || puntos > mejor.puntos)) mejor = { ...r, puntos };
  }
  return mejor;
}
type Temporal = Adjunto;
const ETIQUETA_FOTO: Record<string, string> = { ingreso: "ingreso", dano: "daño", tablero: "tablero", trabajo: "trabajo", salida: "salida", repuestos: "repuestos", documento: "documento" };
const soloConValor = (o: unknown) => Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== ""));

/**
 * Foto que llegó sin placa: se guarda en una carpeta de espera de esa persona
 * (con la llave de servicio, porque aún no hay orden para revisar el permiso).
 * Cuando dice la placa, pasa a la orden y se registra con su sesión.
 */
async function subirTemporal(ctx: Ctx, a: Archivo, foto: PlacaLeida | null): Promise<Temporal | undefined> {
  if (!a.mime.startsWith("image/")) return undefined;
  const ruta = `${ctx.empresa}/${ctx.perfil}/pendiente-${randomUUID()}.${EXT[a.mime] ?? "jpg"}`;
  const { error } = await clienteAdmin().storage.from("ordenes").upload(ruta, a.datos, { contentType: a.mime, upsert: false });
  return error ? undefined : { ruta, mime: a.mime, etiqueta: foto?.tipo_foto ?? null, km: foto?.kilometraje ?? null };
}

/**
 * Corrige lo último que guardó esta persona (o la orden abierta de la placa
 * que nombre): «No, el kilometraje es 58 mil», «el celular es 987654321».
 */
async function corregir(ctx: Ctx, m: MensajeInterpretado): Promise<{ ok: boolean; texto: string }> {
  let ordenId: string | null = null;
  const placa = m.placa ? validarPlaca(m.placa) : null;
  if (placa && placa.estado !== "invalida") ordenId = (await ordenDe(ctx, placa.placa, false)).orden?.id ?? null;
  if (!ordenId) {
    const { data: ultimo } = await ctx.db
      .from("borradores_whatsapp")
      .select("intencion, datos, resultado")
      .eq("perfil_id", ctx.perfil)
      .eq("empresa_id", ctx.empresa)
      .eq("estado", "confirmado")
      .in("intencion", [...CORREGIBLES])
      .gte("actualizado_en", new Date(Date.now() - 3 * 3600_000).toISOString())
      .order("actualizado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    const r = ultimo?.resultado as { ids?: { orden?: string } } | null;
    ordenId = r?.ids?.orden ?? ((ultimo?.datos as { ordenId?: string } | null)?.ordenId ?? null);
  }
  if (!ordenId) return { ok: false, texto: "¿De qué placa es la corrección? Por ejemplo «ABC-123 el kilometraje es 58 mil»." };
  const { data: o } = await ctx.db.from("ordenes_trabajo").select("id, numero, vehiculo_id, cliente_id, vehiculos (placa)").eq("id", ordenId).maybeSingle();
  if (!o) return { ok: false, texto: "No encontré esa orden, o tu rol no puede cambiarla." };
  const hecho: string[] = [];
  const fallo: string[] = [];
  const intentar = async (nombre: string, accion: PromiseLike<{ error: unknown }>) => ((await accion).error ? fallo.push(nombre) : hecho.push(nombre));
  if (m.kilometraje && m.kilometraje > 0) await intentar(`kilometraje ${Math.round(m.kilometraje).toLocaleString("es-PE")} km`, ctx.db.from("ordenes_trabajo").update({ kilometraje_ingreso: Math.round(m.kilometraje) }).eq("id", o.id));
  if (m.observaciones) await intentar("observaciones", ctx.db.from("ordenes_trabajo").update({ observaciones_ingreso: m.observaciones.slice(0, 1000) }).eq("id", o.id));
  if (m.entrega_prometida) {
    const cuando = entregaPrometida(m.entrega_prometida, ctx.hoy);
    if (cuando) {
      // La reprograman solo recepción, gerencia y administración (lo exige la base).
      const { error } = await ctx.db.rpc("cambiar_hora_prometida", { p_orden: o.id, p_hora: cuando.toISOString() });
      if (!error) hecho.push(`entrega ${cuandoEntrega(cuando)}`);
      else fallo.push(error.code === "42501" ? "la hora de entrega (solo la cambian recepción o gerencia)" : "la hora de entrega");
    }
    else fallo.push("la hora de entrega (dímela como «mañana 5pm»)");
  }
  if (m.diagnostico) await intentar("diagnóstico", ctx.db.rpc("registrar_diagnostico", { p_orden: o.id, p_texto: m.diagnostico }));
  if (m.nuevo_estado) await intentar(`estado ${NOMBRE_ESTADO[m.nuevo_estado]}`, ctx.db.rpc("cambiar_estado_orden", { p_orden: o.id, p_estado: m.nuevo_estado, p_nota: "Corrección por WhatsApp" }));
  const carro = soloConValor({ marca: m.marca, modelo: m.modelo, anio: m.anio, color: m.color });
  if (Object.keys(carro).length) await intentar(Object.entries(carro).map(([k, v]) => `${k === "anio" ? "año" : k} ${v}`).join(", "), ctx.db.from("vehiculos").update(carro).eq("id", o.vehiculo_id));
  const celular = m.cliente_celular ? normalizarCelular(m.cliente_celular) : null;
  if (m.cliente_celular && !celular) fallo.push("el celular (deben ser 9 dígitos)");
  const cliente = soloConValor({ nombre: m.cliente_nombre?.trim().slice(0, 120), celular });
  if (Object.keys(cliente).length && o.cliente_id) await intentar(`cliente ${Object.values(cliente).join(" · ")}`, ctx.db.from("clientes").update(cliente).eq("id", o.cliente_id));
  const v = Array.isArray(o.vehiculos) ? o.vehiculos[0] : o.vehiculos;
  const cabeza = `${placaBonita(v?.placa ?? "")} · OT-${String(o.numero).padStart(6, "0")}`;
  if (!hecho.length && !fallo.length) return { ok: false, texto: `¿Qué dato corrijo de ${cabeza}? Por ejemplo «el kilometraje es 58 mil» o «el celular es 987654321».` };
  return {
    ok: hecho.length > 0,
    texto: [hecho.length ? `✏️ Corregido en ${cabeza}: ${hecho.join(", ")}.` : null, fallo.length ? `⚠️ No pude cambiar: ${fallo.join(", ")}.` : null].filter(Boolean).join("\n"),
  };
}

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
        const { data, error } = await db.from("vehiculos").insert({ empresa_id: empresa, placa: d.placa, cliente_id: clienteId, ...soloConValor(d.carro) }).select("id").single();
        if (error || !data) return falla("no se pudo registrar el carro.");
        vehiculoId = data.id;
      } else if (Object.keys(soloConValor(d.carro)).length) {
        // Carro conocido: se actualiza lo que se dijo (por ejemplo, el color si lo pintaron).
        await db.from("vehiculos").update(soloConValor(d.carro)).eq("id", vehiculoId);
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
      const carro = d.carro as { marca: string | null; modelo: string | null; anio: number | null; color: string | null } | undefined;
      const c2 = d.cliente as { nombre: string; celular: string };
      const lineas = [
        `✅ Ingreso registrado — *${placaBonita(String(d.placa))}* ${[carro?.marca, carro?.modelo, carro?.anio, carro?.color].filter(Boolean).join(" ")}${d.kilometraje ? ` · ${Number(d.kilometraje).toLocaleString("es-PE")} km` : ""}`,
        `Orden: OT-${String(orden.numero).padStart(6, "0")}`,
        `Cliente: ${c2.nombre} · ${String(c2.celular).replace(/^\+51/, "")}`,
        `Motivo: ${(d.servicios as string[]).join(" + ")}`,
        promesa.trim(),
        "Mándame las fotos del ingreso con la placa.",
      ];
      return { ok: true, texto: lineas.join("\n"), ids: { orden: orden.id } };
    }
    case "avance": {
      const ordenId = String(d.ordenId);
      const ot = `OT-${String(d.ordenNumero).padStart(6, "0")}`;
      const hecho: string[] = [];
      let avanceId: string | undefined;
      if (d.diagnostico) {
        const { error } = await db.rpc("registrar_diagnostico", { p_orden: ordenId, p_texto: String(d.diagnostico).slice(0, 2000) });
        if (error) return falla("no tienes permiso para escribir el diagnóstico de esa orden.");
        hecho.push(`Diagnóstico: ${d.diagnostico}`);
      }
      if (d.texto) {
        const { data, error } = await db.from("orden_avances").insert({ empresa_id: empresa, orden_id: ordenId, texto: String(d.texto).slice(0, 2000), autor_id: ctx.perfil, origen: "whatsapp" }).select("id").single();
        if (error) return falla("no tienes permiso para actualizar esa orden.");
        avanceId = data?.id;
        if (d.texto !== "Fotos del carro") hecho.push(`Avance: «${d.texto}»`);
      }
      const archivos = (d.archivos as Adjunto[] | undefined) ?? [];
      for (const a of archivos) {
        const etapa = a.etiqueta === "salida" ? "entrega" : a.etiqueta === "ingreso" || a.etiqueta === "dano" || a.etiqueta === "tablero" ? "ingreso" : "proceso";
        await db.from("archivos").insert({ empresa_id: empresa, orden_id: ordenId, avance_id: avanceId ?? null, tipo: a.mime.startsWith("video/") ? "video" : "foto", etapa, etiqueta: a.etiqueta ?? null, bucket: "ordenes", ruta: a.ruta, mime: a.mime, subido_por: ctx.perfil });
      }
      if (archivos.length) {
        const etiquetas = [...new Set(archivos.map((a) => ETIQUETA_FOTO[a.etiqueta ?? ""]).filter(Boolean))];
        hecho.push(`📷 ${archivos.length} ${archivos.length === 1 ? "foto" : "fotos"} en la galería${etiquetas.length ? ` (${etiquetas.join(", ")})` : ""}`);
      }
      // Kilometraje leído del tablero: se pone si la orden no lo tenía; si no cuadra, se avisa.
      if (typeof d.kmTablero === "number") {
        const { data: o } = await db.from("ordenes_trabajo").select("kilometraje_ingreso").eq("id", ordenId).maybeSingle();
        const km = Math.round(d.kmTablero);
        if (o && o.kilometraje_ingreso == null) {
          const { error } = await db.from("ordenes_trabajo").update({ kilometraje_ingreso: km }).eq("id", ordenId);
          if (!error) hecho.push(`Kilometraje del tablero: ${km.toLocaleString("es-PE")} km`);
        } else if (o && Math.abs(Number(o.kilometraje_ingreso) - km) > 50) {
          hecho.push(`⚠️ El tablero marca ${km.toLocaleString("es-PE")} km y en la orden dice ${Number(o.kilometraje_ingreso).toLocaleString("es-PE")} km. Si hay que cambiarlo: «el kilometraje es ${km}».`);
        }
      }
      if (d.estado) {
        const { error } = await db.rpc("cambiar_estado_orden", { p_orden: ordenId, p_estado: d.estado, p_nota: "Por WhatsApp" });
        if (error) hecho.push(`⚠️ No pude cambiar el estado: ${error.message}`);
        else hecho.push(`Estado: *${NOMBRE_ESTADO[d.estado as EstadoOrden] ?? d.estado}*`);
      }
      return { ok: true, texto: `✅ ${placaBonita(String(d.placa))} · ${ot}\n${hecho.join("\n")}`, ids: { orden: ordenId } };
    }
    case "repuestos": {
      const ordenId = String(d.ordenId);
      const filas = d.items as { descripcion: string; cantidad: number; repuestoId: string | null; costo: number | null }[];
      const lineas: string[] = [];
      const fallas: string[] = [];
      // Del inventario: salen del stock para la orden (el costo lo pone el kardex).
      for (const f of filas.filter((x) => x.repuestoId)) {
        const { error } = await db.from("movimientos_inventario").insert({ empresa_id: empresa, repuesto_id: f.repuestoId, tipo: "salida", cantidad: -f.cantidad, orden_id: ordenId, nota: "Por WhatsApp" });
        if (error) fallas.push(f.descripcion);
        else lineas.push(`• ${f.cantidad}× ${f.descripcion}${f.costo ? ` — ${soles(f.costo)}${f.cantidad !== 1 ? " c/u" : ""}` : ""} (inventario)`);
      }
      // Repuestos nuevos: compra directa para la orden, por confirmar.
      const nuevos = filas.filter((x) => !x.repuestoId && x.costo);
      if (nuevos.length) {
        const items = nuevos.map((x) => {
          const mm = montosLinea({ cantidad: x.cantidad, precioUnitario: Number(x.costo), incluyeIgv: true }, 0);
          return { descripcion: x.descripcion, cantidad: x.cantidad, precio_sin_igv: redondear(mm.sinIgv / x.cantidad), sin_igv: mm.sinIgv, igv: mm.igv, total: mm.total, orden: ordenId, repuesto: null };
        });
        const t = sumarMontos(items.map((i) => ({ sinIgv: i.sin_igv, igv: i.igv, total: i.total })));
        const { error } = await db.rpc("registrar_compra", {
          p_empresa: empresa,
          p_proveedor: { ruc: null, razon_social: "Compra directa (WhatsApp)" },
          p_compra: { tipo: "sin_comprobante", serie: null, numero: null, fecha: ctx.hoy, moneda: "PEN", tipo_cambio: 1, tasa_igv: 0, sin_igv: t.sinIgv, igv: t.igv, total: t.total, origen: "ia", archivo: null },
          p_items: items,
        });
        if (error) fallas.push(...nuevos.map((x) => x.descripcion));
        else lineas.push(...nuevos.map((x) => `• ${x.cantidad}× ${x.descripcion} — ${soles(Number(x.costo))}${x.cantidad !== 1 ? " c/u" : ""} (nuevo, compra por confirmar)`));
      }
      if (!lineas.length) return falla(fallas.length ? "tu rol no carga repuestos a las órdenes." : "no había repuestos para cargar.");
      // La foto del vale queda en la galería de la orden como evidencia (ver preparar).
      for (const a of (d.archivos as Adjunto[] | undefined) ?? []) {
        await clienteAdmin().from("archivos").insert({ empresa_id: empresa, orden_id: ordenId, tipo: "foto", etapa: "proceso", etiqueta: "repuestos", bucket: "ordenes", ruta: a.ruta, mime: a.mime, subido_por: ctx.perfil });
      }
      return {
        ok: true,
        texto: [`📦 Repuestos cargados a *${placaBonita(String(d.placa))}* (OT-${String(d.ordenNumero).padStart(6, "0")}):`, ...lineas, fallas.length ? `⚠️ No pude cargar: ${fallas.join(", ")}.` : null, "¿Correcto? Si algo está mal, anúlalo en la orden → Repuestos."].filter(Boolean).join("\n"),
        ids: { orden: ordenId },
      };
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
      // Se compara al toque con lo aprobado en la orden.
      let aviso = "";
      if (d.ordenId) {
        const { data: cots } = await db.from("cotizaciones").select("total").eq("orden_id", String(d.ordenId)).eq("estado", "aprobada");
        const aprobado = cots?.length ? redondear(cots.reduce((a, c) => a + Number(c.total), 0)) : null;
        const c = cuadreComprobante(m.total, aprobado);
        aviso = aprobado === null ? "\n⚠️ La orden no tiene cotización aprobada: no pude comparar el monto." : c.cuadra ? `\nCuadra con lo aprobado en la orden (${soles(aprobado)}).` : `\n⚠️ No cuadra: la orden aprobó ${soles(aprobado)} y el comprobante es por ${soles(m.total)} (${c.diferencia > 0 ? "sobran" : "faltan"} ${soles(Math.abs(c.diferencia))}). Le aviso a gerencia.`;
      }
      return { ok: true, texto: `✅ Comprobante ${serie}-${numero} registrado por ${soles(m.total)}. Queda *por confirmar* en Caja → Comprobantes.${aviso}` };
    }
    default:
      return falla("no sé cómo guardar esto.");
  }
}
