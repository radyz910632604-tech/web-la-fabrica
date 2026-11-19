import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la llave de servicio: se salta RLS.
 * Solo para lo que la API normal no permite (crear logins, cambiar celular
 * o contraseña), y SIEMPRE después de verificar el permiso con clienteServidor().
 */
export function clienteAdmin() {
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!llave) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.");
  return createClient(process.env.SUPABASE_URL!, llave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
