"use server";

import { revalidatePath } from "next/cache";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CANALES_PERMITIDOS, TIPOS_AVISO } from "./avisos-tipos";

/** Guarda el canal de cada tipo de aviso (gerencia y administración). */
export async function guardarAvisos(_previo: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) return { error: "Solo gerencia o administración cambian los avisos." };
  const filas = TIPOS_AVISO.map((t) => ({ empresa_id: ctx.taller.id, tipo: t.tipo, canal: String(form.get(t.tipo) ?? t.defecto) }));
  if (filas.some((f) => !CANALES_PERMITIDOS[TIPOS_AVISO.find((t) => t.tipo === f.tipo)!.destino].includes(f.canal))) return { error: "Canal no válido." };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("config_avisos").upsert(filas.map((f) => ({ ...f, actualizado_en: new Date().toISOString() })), { onConflict: "empresa_id,tipo" });
  if (error) return { error: "No se pudo guardar." };
  revalidatePath("/configuracion");
  return { ok: "Avisos guardados." };
}
