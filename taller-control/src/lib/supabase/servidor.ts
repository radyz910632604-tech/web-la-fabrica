import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Cliente de Supabase con la sesión de quien navega: la base aplica sus permisos (RLS). */
export async function clienteServidor() {
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
