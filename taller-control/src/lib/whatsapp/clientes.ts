import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entrada, Salida } from "./procesar";

/**
 * Mensajes de CLIENTES (no del personal): respuestas a la encuesta de
 * satisfacción y a la aprobación de cotizaciones. Se completa con los avisos.
 */
export async function atenderCliente(_admin: SupabaseClient, _celular: string, _e: Entrada): Promise<{ salida: Salida; empresaId: string; clienteId: string } | null> {
  return null;
}
