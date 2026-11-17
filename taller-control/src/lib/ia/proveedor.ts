import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaContentBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { esquemaComprobante, esquemaMensaje, esquemaPlaca, esquemaVale, type ComprobanteLeido, type MensajeInterpretado, type PlacaLeida, type ValeLeido } from "./esquemas";
import { interpretarSinIa, normalizarPlaca } from "./sin-ia";

/**
 * Inteligencia artificial del taller, con el proveedor que diga el entorno:
 *
 *   IA_PROVEEDOR        claude (por defecto) | openai | prueba   → leer documentos, fotos y mensajes
 *   IA_PROVEEDOR_AUDIO  openai (por defecto) | prueba            → pasar audios a texto
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY                           → las llaves (solo en el servidor)
 *   IA_MODELO_CLAUDE, IA_MODELO_OPENAI, IA_MODELO_AUDIO          → cambiar de modelo sin tocar código
 *
 * Sin llave, la app sigue funcionando: los mensajes simples se entienden sin
 * IA y los documentos se registran a mano. Nada de lo que lee la IA queda
 * como definitivo: se guarda «por confirmar» hasta que una persona lo aprueba.
 * Los prompts están en n8n/prompts/ (texto plano, fáciles de revisar).
 */

export type Archivo = { datos: Buffer; mime: string; nombre?: string };
export type Resultado<T> = { ok: true; datos: T; proveedor: string } | { ok: false; error: string };

const MIMES_IMAGEN = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MIMES_DOCUMENTO = [...MIMES_IMAGEN, "application/pdf"];
const LIMITE_BYTES = 5 * 1024 * 1024;

type Proveedor = "claude" | "openai" | "prueba";

function proveedorLectura(): Proveedor {
  const p = (process.env.IA_PROVEEDOR ?? "claude").toLowerCase();
  return p === "openai" || p === "prueba" ? p : "claude";
}
function proveedorAudio(): "openai" | "prueba" {
  return (process.env.IA_PROVEEDOR_AUDIO ?? "openai").toLowerCase() === "prueba" ? "prueba" : "openai";
}

/** ¿Hay IA lista para leer y para escuchar? (Para mostrar u ocultar botones.) */
export function estadoIa(): { lectura: boolean; audio: boolean; proveedor: Proveedor } {
  const p = proveedorLectura();
  const lectura = p === "prueba" || (p === "claude" ? Boolean(process.env.ANTHROPIC_API_KEY) : Boolean(process.env.OPENAI_API_KEY));
  const audio = proveedorAudio() === "prueba" || Boolean(process.env.OPENAI_API_KEY);
  return { lectura, audio, proveedor: p };
}

const cache = new Map<string, string>();
async function prompt(nombre: string): Promise<string> {
  const guardado = cache.get(nombre);
  if (guardado) return guardado;
  const texto = await readFile(path.join(process.cwd(), "n8n", "prompts", `${nombre}.txt`), "utf8");
  cache.set(nombre, texto);
  return texto;
}

function revisarArchivo(a: Archivo): string | null {
  if (!MIMES_DOCUMENTO.includes(a.mime)) return "Sube una foto (JPG, PNG o WEBP) o un PDF.";
  if (a.datos.byteLength > LIMITE_BYTES) return "El archivo pesa más de 5 MB. Toma la foto de nuevo o reduce el PDF.";
  return null;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
function bloqueArchivo(a: Archivo): BetaContentBlockParam {
  const data = a.datos.toString("base64");
  if (a.mime === "application/pdf") return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  return { type: "image", source: { type: "base64", media_type: a.mime as (typeof MIMES_IMAGEN)[number], data } };
}

async function conClaude<T extends z.ZodType>(esquema: T, sistema: string, contenido: BetaContentBlockParam[]): Promise<Resultado<z.infer<T>>> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "La IA no está configurada (falta ANTHROPIC_API_KEY)." };
  const cliente = new Anthropic({ timeout: 120_000, maxRetries: 2 });
  try {
    const r = await cliente.beta.messages.parse({
      model: process.env.IA_MODELO_CLAUDE || "claude-opus-5-5",
      max_tokens: 16000,
      // Si el modelo principal declina, la API reintenta sola con otro modelo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(esquema) },
      system: sistema,
      messages: [{ role: "user", content: contenido }],
    });
    if (r.stop_reason === "refusal") return { ok: false, error: "La IA no pudo leer este contenido. Regístralo a mano." };
    if (r.stop_reason === "max_tokens" || !r.parsed_output) return { ok: false, error: "La IA no devolvió datos completos. Inténtalo otra vez o regístralo a mano." };
    return { ok: true, datos: r.parsed_output as z.infer<T>, proveedor: "claude" };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "La llave de IA no es válida. Revisa ANTHROPIC_API_KEY." };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "La IA está ocupada. Prueba en un minuto." };
    if (e instanceof Anthropic.BadRequestError) return { ok: false, error: "La IA no aceptó este archivo. Prueba con otra foto o regístralo a mano." };
    if (e instanceof Anthropic.APIError) return { ok: false, error: "La IA no respondió. Prueba en un momento." };
    return { ok: false, error: "No se pudo conectar con la IA." };
  }
}

// ---------------------------------------------------------------------------
// OpenAI (alternativa para leer, y el proveedor de audio)
// ---------------------------------------------------------------------------
async function conOpenai<T extends z.ZodType>(esquema: T, sistema: string, texto: string, a?: Archivo): Promise<Resultado<z.infer<T>>> {
  const llave = process.env.OPENAI_API_KEY;
  if (!llave) return { ok: false, error: "La IA no está configurada (falta OPENAI_API_KEY)." };
  const partes: unknown[] = [{ type: "text", text: texto }];
  if (a) {
    const url = `data:${a.mime};base64,${a.datos.toString("base64")}`;
    partes.push(a.mime === "application/pdf" ? { type: "file", file: { filename: a.nombre ?? "documento.pdf", file_data: url } } : { type: "image_url", image_url: { url } });
  }
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${llave}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.IA_MODELO_OPENAI || "gpt-4o",
        messages: [{ role: "system", content: sistema }, { role: "user", content: partes }],
        response_format: { type: "json_schema", json_schema: { name: "datos", schema: z.toJSONSchema(esquema), strict: false } },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) return { ok: false, error: r.status === 401 ? "La llave de OpenAI no es válida." : "La IA no respondió. Prueba en un momento." };
    const json = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const v = esquema.safeParse(JSON.parse(json.choices?.[0]?.message?.content ?? "null"));
    return v.success ? { ok: true, datos: v.data, proveedor: "openai" } : { ok: false, error: "La IA devolvió datos incompletos." };
  } catch {
    return { ok: false, error: "No se pudo conectar con la IA." };
  }
}

// ---------------------------------------------------------------------------
// Prueba (sin internet): respuestas fijas para las pruebas automáticas
// ---------------------------------------------------------------------------
function comprobanteDePrueba(a: Archivo, pista: "compra" | "venta"): ComprobanteLeido {
  const n = String(parseInt(createHash("sha1").update(a.datos).digest("hex").slice(0, 6), 16) % 90000 + 1000);
  if (pista === "venta") {
    return {
      es_comprobante: true, tipo: "boleta", emisor_ruc: null, emisor_nombre: null, cliente_documento: "40000000", cliente_nombre: "Cliente de prueba",
      serie: "B001", numero: n, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()), moneda: "PEN",
      subtotal_sin_igv: 254.24, igv: 45.76, total: 300, precios_incluyen_igv: true,
      lineas: [{ descripcion: "Mantenimiento preventivo", cantidad: 1, precio_unitario: 300, importe: 300 }], placa: null, legible: "bien", dudas: null,
    };
  }
  return {
    es_comprobante: true, tipo: "factura", emisor_ruc: "20000000011", emisor_nombre: "Repuestos de prueba IA SAC", cliente_documento: null, cliente_nombre: null,
    serie: "F001", numero: n, fecha: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()), moneda: "PEN",
    subtotal_sin_igv: 150, igv: 27, total: 177, precios_incluyen_igv: false,
    lineas: [{ descripcion: "Pastillas de freno delanteras", cantidad: 2, precio_unitario: 75, importe: 150 }], placa: null, legible: "con_dudas", dudas: "Lectura de prueba: no es un documento real.",
  };
}

// ---------------------------------------------------------------------------
// Lo que usa la app
// ---------------------------------------------------------------------------

/** Lee una factura, boleta o ticket (foto o PDF). */
export async function leerComprobante(a: Archivo, pista: "compra" | "venta"): Promise<Resultado<ComprobanteLeido>> {
  const problema = revisarArchivo(a);
  if (problema) return { ok: false, error: problema };
  const p = proveedorLectura();
  if (p === "prueba") return { ok: true, datos: comprobanteDePrueba(a, pista), proveedor: "prueba" };
  const sistema = await prompt("leer-comprobante");
  const pedido = pista === "compra" ? "Es un comprobante de COMPRA: el emisor es el proveedor del taller." : "Es un comprobante de VENTA emitido por el taller a su cliente.";
  return p === "claude" ? conClaude(esquemaComprobante, sistema, [bloqueArchivo(a), { type: "text", text: pedido }]) : conOpenai(esquemaComprobante, sistema, pedido, a);
}

/** Modo de prueba: el nombre del archivo dice qué es («ABC123-tablero-85120.jpg»). */
function fotoDePrueba(nombre?: string): PlacaLeida["tipo_foto"] {
  const n = (nombre ?? "").toLowerCase();
  return /factura|boleta|ticket|comprobante/.test(n) ? "documento" : n.includes("tablero") ? "tablero" : n.includes("dano") || n.includes("golpe") ? "dano" : n.includes("repuesto") || n.includes("vale") ? "repuestos" : n.includes("listo") || n.includes("salida") ? "salida" : null;
}

/** Lee la placa de una foto y qué muestra (tablero con su kilometraje, daño, trabajo…). */
export async function leerPlaca(a: Archivo): Promise<Resultado<PlacaLeida>> {
  const problema = revisarArchivo(a);
  if (problema) return { ok: false, error: problema };
  const p = proveedorLectura();
  if (p === "prueba") return { ok: true, datos: { placa: normalizarPlaca(a.nombre ?? "") ?? null, legible: normalizarPlaca(a.nombre ?? "") ? "bien" : "no_se_lee", tipo_foto: fotoDePrueba(a.nombre), kilometraje: /tablero[-_ ]?(\d{3,7})/i.exec(a.nombre ?? "")?.[1] ? Number(/tablero[-_ ]?(\d{3,7})/i.exec(a.nombre ?? "")![1]) : null }, proveedor: "prueba" };
  const sistema = await prompt("leer-placa");
  const r = p === "claude" ? await conClaude(esquemaPlaca, sistema, [bloqueArchivo(a), { type: "text", text: "Lee la placa y di qué muestra la foto." }]) : await conOpenai(esquemaPlaca, sistema, "Lee la placa y di qué muestra la foto.", a);
  return r.ok ? { ...r, datos: { ...r.datos, placa: normalizarPlaca(r.datos.placa) } } : r;
}

/** Lee los repuestos de una foto (repuestos sobre la mesa o vale de salida de almacén). */
export async function leerRepuestos(a: Archivo): Promise<Resultado<ValeLeido>> {
  const problema = revisarArchivo(a);
  if (problema) return { ok: false, error: problema };
  const p = proveedorLectura();
  if (p === "prueba") {
    // Modo de prueba: el nombre del archivo trae la lista («vale ABC123 1 sincronizador 3ra, 4 aceite ATF.png»).
    const nombre = (a.nombre ?? "").replace(/\.[a-z0-9]+$/i, "");
    const items = [...nombre.matchAll(/(\d+(?:[.,]\d+)?)\s+([^,\d][^,]*)/g)].map((x) => ({ descripcion: x[2].trim(), codigo: null, cantidad: Number(x[1].replace(",", ".")) }));
    return { ok: true, datos: { placa: normalizarPlaca(nombre), items, legible: items.length ? "bien" : "no_se_lee" }, proveedor: "prueba" };
  }
  const sistema = await prompt("leer-repuestos");
  const r = p === "claude" ? await conClaude(esquemaVale, sistema, [bloqueArchivo(a), { type: "text", text: "Lee los repuestos." }]) : await conOpenai(esquemaVale, sistema, "Lee los repuestos.", a);
  return r.ok ? { ...r, datos: { ...r.datos, placa: normalizarPlaca(r.datos.placa) } } : r;
}

/** Entiende un mensaje de WhatsApp (texto o audio ya transcrito). */
export async function interpretarMensaje(texto: string, contexto: { rol: string; hoy: string; adjunto?: Archivo }): Promise<Resultado<MensajeInterpretado>> {
  const p = proveedorLectura();
  if (p === "prueba" || !estadoIa().lectura) return { ok: true, datos: interpretarSinIa(texto), proveedor: "sin_ia" };
  const sistema = await prompt("interpretar-mensaje");
  // El mensaje va entre etiquetas: es dato, no instrucción.
  const pedido = `Hoy es ${contexto.hoy} (hora de Lima). Quien escribe tiene el rol «${contexto.rol}».\n<mensaje>\n${texto.slice(0, 4000)}\n</mensaje>`;
  const bloques: BetaContentBlockParam[] = contexto.adjunto && !revisarArchivo(contexto.adjunto) ? [bloqueArchivo(contexto.adjunto), { type: "text", text: pedido }] : [{ type: "text", text: pedido }];
  const r = p === "claude" ? await conClaude(esquemaMensaje, sistema, bloques) : await conOpenai(esquemaMensaje, sistema, pedido, contexto.adjunto);
  if (!r.ok) return { ok: true, datos: interpretarSinIa(texto), proveedor: "sin_ia" };
  return { ...r, datos: { ...r.datos, placa: normalizarPlaca(r.datos.placa) } };
}

/** Pasa un audio a texto (OpenAI). */
export async function transcribirAudio(a: Archivo): Promise<Resultado<string>> {
  if (proveedorAudio() === "prueba") return { ok: true, datos: a.nombre?.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ") ?? "audio de prueba", proveedor: "prueba" };
  const llave = process.env.OPENAI_API_KEY;
  if (!llave) return { ok: false, error: "Los audios necesitan OPENAI_API_KEY. Mientras tanto, escribe el mensaje." };
  if (a.datos.byteLength > 24 * 1024 * 1024) return { ok: false, error: "El audio es muy largo. Manda uno de menos de 10 minutos." };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(a.datos)], { type: a.mime }), a.nombre ?? "audio.ogg");
  form.append("model", process.env.IA_MODELO_AUDIO || "whisper-1");
  form.append("language", "es");
  form.append("prompt", await prompt("transcribir-audio"));
  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { authorization: `Bearer ${llave}` }, body: form, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return { ok: false, error: "No se pudo pasar el audio a texto. Prueba otra vez o escríbelo." };
    const json = (await r.json()) as { text?: string };
    return json.text?.trim() ? { ok: true, datos: json.text.trim(), proveedor: "openai" } : { ok: false, error: "El audio no se entendió." };
  } catch {
    return { ok: false, error: "No se pudo conectar con el servicio de audio." };
  }
}
