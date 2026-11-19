import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { celularAEmail } from "@/lib/celulares";
import { clienteAdmin } from "@/lib/supabase/admin";

/**
 * Abre una sesión de Supabase COMO la persona que escribió por WhatsApp, para
 * que la base aplique sus permisos (RLS) igual que en la app. La llave de
 * servicio solo se usa para emitir ese acceso de un solo uso; nada del taller
 * se escribe con ella. Al terminar, la sesión se cierra.
 */
export async function sesionDe(celular: string): Promise<{ db: SupabaseClient; cerrar: () => Promise<void> } | null> {
  const admin = clienteAdmin();
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: celularAEmail(celular) });
  if (error || !data.properties?.hashed_token) return null;
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: s, error: e2 } = await db.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (e2 || !s.session) return null;
  return {
    db,
    cerrar: async () => {
      // Solo esta sesión: la app abierta en el celular de la persona sigue igual.
      await db.auth.signOut({ scope: "local" });
    },
  };
}
