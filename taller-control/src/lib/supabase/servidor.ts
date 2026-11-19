import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Sesión prestada: WhatsApp abre una sesión como la persona que escribe y,
 * mientras dura `conCliente`, todo lo que pide `clienteServidor()` (por
 * ejemplo, armar un PDF) usa esa sesión. Así la base aplica sus permisos.
 */
const prestada = new AsyncLocalStorage<SupabaseClient>();

export function conCliente<T>(db: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  return prestada.run(db, fn);
}

/** Cliente de Supabase con la sesión de quien navega: la base aplica sus permisos (RLS). */
export async function clienteServidor(): Promise<SupabaseClient> {
  const forzado = prestada.getStore();
  if (forzado) return forzado;
  const almacen = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => almacen.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) almacen.set(name, value, options);
        } catch {
          // En una página (no en una acción) no se pueden escribir cookies; el proxy las renueva.
        }
      },
    },
  });
}
