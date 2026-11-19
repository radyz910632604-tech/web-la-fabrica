"use server";

import { timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { instalacionAbierta } from "@/lib/base/instalacion";
import { celularAEmail, normalizarCelular } from "@/lib/celulares";
import { clienteAdmin } from "@/lib/supabase/admin";

export type Resultado = { error?: string; errores?: Record<string, string> };

/**
 * Instalación: crea el primer taller y su primera persona de gerencia.
 * Solo funciona si (1) el dueño puso CLAVE_INSTALACION en EasyPanel,
 * (2) quien instala la escribe bien y (3) todavía no existe ninguna persona.
 * Después del primer uso queda cerrada para siempre.
 */
const esquema = z.object({
  clave_instalacion: z.string().min(1, "Escribe la clave de instalación."),
  taller: z.string().trim().min(2, "Escribe el nombre del taller.").max(80, "Máximo 80 letras."),
  nombre: z.string().trim().min(2, "Escribe tu nombre y apellido.").max(80, "Máximo 80 letras."),
  celular: z.string(),
  clave: z.string().min(8, "Mínimo 8 caracteres.").max(72, "Máximo 72 caracteres."),
  clave2: z.string(),
});

// Freno simple contra quien quiera adivinar la clave: 5 intentos fallidos cada 15 minutos.
const intentos = { fallidos: 0, hasta: 0 };

export async function instalar(_previo: Resultado, form: FormData): Promise<Resultado> {
  if (Date.now() < intentos.hasta) return { error: "Demasiados intentos. Espera 15 minutos y prueba otra vez." };
  if ((await instalacionAbierta()) !== "abierta") return { error: "La instalación no está disponible." };
  const datos = esquema.safeParse(Object.fromEntries(form));
  if (!datos.success) {
    const errores: Record<string, string> = {};
    for (const p of datos.error.issues) errores[String(p.path[0])] ??= p.message;
    return { errores };
  }
  const d = datos.data;
  const a = Buffer.from(d.clave_instalacion);
  const b = Buffer.from(process.env.CLAVE_INSTALACION ?? "");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    if (++intentos.fallidos >= 5) Object.assign(intentos, { fallidos: 0, hasta: Date.now() + 15 * 60_000 });
    return { errores: { clave_instalacion: "No coincide con la CLAVE_INSTALACION que pusiste en EasyPanel." } };
  }
  const celular = normalizarCelular(d.celular);
  if (!celular) return { errores: { celular: "Celular de 9 dígitos, por ejemplo 987 654 321." } };
  if (d.clave !== d.clave2) return { errores: { clave2: "Las dos contraseñas no son iguales." } };

  const admin = clienteAdmin();
  const { data: usuario, error } = await admin.auth.admin.createUser({
    email: celularAEmail(celular),
    password: d.clave,
    email_confirm: true,
    app_metadata: { nombre: d.nombre, celular },
  });
  if (error || !usuario.user) return { error: "No se pudo crear tu acceso. Revisa los datos e intenta otra vez." };
  // Por si dos personas instalan a la vez: solo la primera queda como gerencia.
  const { count } = await admin.from("perfiles").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 1) {
    await admin.auth.admin.deleteUser(usuario.user.id);
    return { error: "El sistema ya fue instalado por otra persona." };
  }
  const { data: empresa, error: e2 } = await admin.from("empresas").insert({ nombre: d.taller }).select("id").single();
  if (e2 || !empresa) return { error: "Se creó tu acceso, pero no el taller. Avisa a soporte." };
  const { error: e3 } = await admin.from("miembros").insert({ empresa_id: empresa.id, perfil_id: usuario.user.id, rol: "gerencia" });
  if (e3) return { error: "Se creó el taller, pero no quedaste como gerencia. Avisa a soporte." };
  redirect("/ingresar?motivo=instalado");
}
