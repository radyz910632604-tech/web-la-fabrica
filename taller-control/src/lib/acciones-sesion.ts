"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clienteServidor } from "./supabase/servidor";
import { correoDeAcceso } from "./acceso";
import { COOKIE_TALLER, obtenerContexto } from "./sesion";

export type EstadoIngreso = { error?: string; usuario?: string };

export async function ingresar(_previo: EstadoIngreso, form: FormData): Promise<EstadoIngreso> {
  const escrito = String(form.get("usuario") ?? "").trim();
  const clave = String(form.get("clave") ?? "");
  if (!escrito) return { error: "Escribe tu usuario.", usuario: escrito };
  if (!clave) return { error: "Escribe tu contraseña.", usuario: escrito };

  // Se acepta el usuario o, por compatibilidad, el celular.
  const email = await correoDeAcceso(escrito);
  const mensaje = "Ese usuario y esa contraseña no coinciden. Revísalos e intenta otra vez.";
  if (!email) return { error: mensaje, usuario: escrito };

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
  if (error) {
    return { error: error.status === 429 ? "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar." : mensaje, usuario: escrito };
  }
  redirect("/");
}

export async function salir() {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  (await cookies()).delete(COOKIE_TALLER);
  redirect("/ingresar");
}

export async function cambiarTaller(id: string) {
  const { talleres } = await obtenerContexto();
  if (!talleres.some((t) => t.id === id)) return;
  (await cookies()).set(COOKIE_TALLER, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
