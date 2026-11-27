"use server";

import { z } from "zod";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

const esquema = z.object({ endpoint: z.string().url().startsWith("https://").max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });

/** Guarda este celular o computadora para recibir avisos push. */
export async function guardarSuscripcion(sub: unknown, agente: string): Promise<{ ok?: true; error?: string }> {
  const ctx = await obtenerContexto();
  const r = esquema.safeParse(sub);
  if (!r.success) return { error: "El navegador no dio una suscripción válida." };
  const supabase = await clienteServidor();
  await supabase.from("suscripciones_push").delete().eq("endpoint", r.data.endpoint);
  const { error } = await supabase.from("suscripciones_push").insert({ perfil_id: ctx.perfil.id, endpoint: r.data.endpoint, p256dh: r.data.keys.p256dh, auth: r.data.keys.auth, agente: agente.slice(0, 300) });
  return error ? { error: "No se pudo guardar." } : { ok: true };
}

export async function quitarSuscripcion(endpoint: string): Promise<{ ok?: true }> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  await supabase.from("suscripciones_push").delete().eq("endpoint", endpoint);
  return { ok: true };
}
