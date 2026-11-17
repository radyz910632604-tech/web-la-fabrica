"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { pushConfigurado } from "@/lib/avisos/push";
import { hacerRespaldo } from "@/lib/respaldo/copia";
import { obtenerContexto } from "@/lib/sesion";

export type ResultadoCopia = { ok?: string; error?: string };
export type ResultadoLlaves = { lineas?: string; error?: string };

/** Copia de seguridad a pedido. Solo gerencia. */
export async function copiaAhora(): Promise<ResultadoCopia> {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("gerencia")) return { error: "Solo gerencia hace copias de seguridad." };
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { error: "Falta la llave de servicio (SUPABASE_SERVICE_ROLE_KEY) en EasyPanel." };
  const r = await hacerRespaldo("manual");
  revalidatePath("/sistema");
  if (!r.ok) return { error: `No se pudo hacer la copia. ${r.error}` };
  return { ok: r.modo === "completo" ? "Copia completa guardada." : "Copia guardada (sin las contraseñas del personal)." };
}

/**
 * Crea llaves nuevas para pegar en EasyPanel. No se guardan en ningún lado:
 * solo se muestran una vez a gerencia, que las pega en «Entorno».
 * Si las de avisos ya existen no se crean otras (cambiarlas apagaría los
 * avisos de todos los celulares ya activados).
 */
export async function crearLlaves(_previo: ResultadoLlaves, form: FormData): Promise<ResultadoLlaves> {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("gerencia")) return { error: "Solo gerencia crea llaves." };
  const cual = form.get("cual");
  if (cual === "avisos") {
    if (pushConfigurado()) return { error: "Las llaves de avisos ya están puestas. No hace falta crear otras." };
    const { generateVAPIDKeys } = await import("web-push");
    const k = generateVAPIDKeys();
    return { lineas: `VAPID_PUBLICA=${k.publicKey}\nVAPID_PRIVADA=${k.privateKey}` };
  }
  if (cual === "n8n") {
    if ((process.env.CLAVE_API_INTERNA ?? "").length >= 32) return { error: "La clave para n8n ya está puesta." };
    return { lineas: `CLAVE_API_INTERNA=${randomBytes(32).toString("hex")}` };
  }
  return { error: "No se reconoció qué llave crear." };
}
