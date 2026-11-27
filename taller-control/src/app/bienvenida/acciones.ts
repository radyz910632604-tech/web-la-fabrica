"use server";

import { redirect } from "next/navigation";
import { obtenerContexto } from "@/lib/sesion";
import { clienteAdmin } from "@/lib/supabase/admin";
import { clienteServidor } from "@/lib/supabase/servidor";
import { esUsuarioValido, normalizarUsuario, REGLA_USUARIO } from "@/lib/usuarios";

export type EstadoBienvenida = { error?: string; errores?: Record<string, string> };

/** Primer ingreso: la persona elige su usuario y su contraseña (con su propia sesión). */
export async function guardarPrimerIngreso(_previo: EstadoBienvenida, form: FormData): Promise<EstadoBienvenida> {
  const ctx = await obtenerContexto();
  const usuario = normalizarUsuario(String(form.get("usuario") ?? ""));
  const clave = String(form.get("clave") ?? "");
  const repetir = String(form.get("repetir") ?? "");
  if (!esUsuarioValido(usuario)) return { errores: { usuario: REGLA_USUARIO } };
  if (clave.length < 8) return { errores: { clave: "Mínimo 8 caracteres." } };
  if (clave.length > 72) return { errores: { clave: "Máximo 72 caracteres." } };
  if (clave !== repetir) return { errores: { repetir: "No coincide con la contraseña de arriba." } };

  const supabase = await clienteServidor();
  if (usuario !== ctx.perfil.usuario) {
    const { error } = await supabase.from("perfiles").update({ usuario }).eq("id", ctx.perfil.id);
    if (error?.code === "23505") {
      const { data: otro } = await supabase.rpc("sugerir_usuario", { p_texto: usuario });
      return { errores: { usuario: `Ese usuario ya está en uso. Prueba con «${otro ?? `${usuario}2`}».` } };
    }
    if (error) return { error: "No se pudo guardar el usuario." };
  }
  const { error: e2 } = await supabase.auth.updateUser({ password: clave });
  if (e2) return { error: e2.message.includes("different") ? "La contraseña nueva debe ser distinta a la temporal." : "No se pudo cambiar la contraseña." };
  // La marca la quita el servidor, solo para la persona que acaba de cambiar su contraseña.
  await clienteAdmin().from("perfiles").update({ debe_cambiar_clave: false }).eq("id", ctx.perfil.id);
  redirect("/");
}

/** «Ahora no»: sigue con la contraseña temporal; podrá cambiarla luego. */
export async function omitirPrimerIngreso(): Promise<void> {
  const ctx = await obtenerContexto();
  await clienteAdmin().from("perfiles").update({ debe_cambiar_clave: false }).eq("id", ctx.perfil.id);
  redirect("/");
}
