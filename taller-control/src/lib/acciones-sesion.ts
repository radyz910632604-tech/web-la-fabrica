"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clienteServidor } from "./supabase/servidor";
import { celularAEmail, normalizarCelular } from "./celulares";
import { COOKIE_TALLER, obtenerContexto } from "./sesion";

export type EstadoIngreso = { error?: string; celular?: string };

export async function ingresar(_previo: EstadoIngreso, form: FormData): Promise<EstadoIngreso> {
  const escrito = String(form.get("celular") ?? "");
  const clave = String(form.get("clave") ?? "");
  const celular = normalizarCelular(escrito);

  if (!celular) {
    return { error: "Escribe tu celular de 9 dígitos, por ejemplo 987 654 321.", celular: escrito };
  }
  if (!clave) {
    return { error: "Escribe tu contraseña.", celular: escrito };
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email: celularAEmail(celular), password: clave });
  if (error) {
    const muchos = error.status === 429;
    return {
      error: muchos
        ? "Demasiados intentos seguidos. Espera unos minutos y vuelve a intentar."
        : "Ese celular y esa contraseña no coinciden. Revísalos e intenta otra vez.",
      celular: escrito,
    };
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
