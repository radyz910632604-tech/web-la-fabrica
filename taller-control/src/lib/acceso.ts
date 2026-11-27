import "server-only";
import { celularAEmail, DOMINIO_LOGIN, normalizarCelular } from "@/lib/celulares";
import { clienteAdmin } from "@/lib/supabase/admin";
import { normalizarUsuario } from "@/lib/usuarios";

/**
 * Con qué correo interno de Supabase entra cada persona. Ese correo no cambia nunca (aunque cambie
 * su celular); por eso se busca a la persona por su usuario o por su celular ACTUAL y se usa el
 * correo que ya tiene. Corre en el servidor con la llave de servicio (es parte del acceso).
 */
export async function correoDeAcceso(escrito: string): Promise<string | null> {
  const admin = clienteAdmin();
  const celular = normalizarCelular(escrito);
  const usuario = normalizarUsuario(escrito);
  const { data: perfil } = celular
    ? await admin.from("perfiles").select("id").eq("celular", celular).maybeSingle()
    : await admin.from("perfiles").select("id").eq("usuario", usuario).maybeSingle();
  if (perfil) {
    const { data } = await admin.auth.admin.getUserById(perfil.id);
    if (data.user?.email) return data.user.email;
  }
  // Compatibilidad: quien entraba con su celular de siempre.
  return celular ? celularAEmail(celular) : null;
}

/** Correo interno de una persona por su id (para WhatsApp y cambios de contraseña). */
export async function correoDePerfil(perfilId: string): Promise<string | null> {
  const { data } = await clienteAdmin().auth.admin.getUserById(perfilId);
  return data.user?.email ?? null;
}

/** Correo interno para una persona nueva: no depende del celular, así el número se puede cambiar. */
export function correoNuevo(): string {
  return `u-${crypto.randomUUID()}@${DOMINIO_LOGIN}`;
}
