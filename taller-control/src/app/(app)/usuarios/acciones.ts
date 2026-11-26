"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { celularAEmail, normalizarCelular } from "@/lib/celulares";
import { esGestor, esRol, rolesAsignables, NOMBRE_ROL, type Rol } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteAdmin } from "@/lib/supabase/admin";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const CLAVE_MINIMA = 8;

async function exigirGestor() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) throw new Error("Solo gerencia o administración pueden hacer esto.");
  return ctx;
}

const esquemaPersona = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre y apellido.").max(80, "Máximo 80 letras."),
  celular: z.string().transform((v, c) => {
    const n = normalizarCelular(v);
    if (!n) c.addIssue({ code: "custom", message: "Celular de 9 dígitos, por ejemplo 987 654 321." });
    return n ?? "";
  }),
  documento: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => /^[0-9A-Z]{6,15}$/.test(v), "DNI de 8 números (o carné de 6 a 15 letras o números)."),
  cargo: z.string().trim().max(60, "Máximo 60 letras.").optional(),
  fechaIngreso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha de ingreso."),
  rol: z.string().refine(esRol, "Elige un rol."),
  clave: z.string().min(CLAVE_MINIMA, `Mínimo ${CLAVE_MINIMA} caracteres.`).max(72, "Máximo 72 caracteres."),
  tipoPago: z.enum(["fijo", "destajo"], { error: "Elige cómo se le paga." }),
  monto: z.coerce.number({ error: "Escribe el monto." }).min(0, "No puede ser negativo.").max(100000, "Revisa el monto."),
  frecuencia: z.enum(["semanal", "quincenal", "mensual"], { error: "Elige cada cuánto se le paga." }),
  comision: z.coerce.number().min(0).max(100, "Un porcentaje va de 0 a 100.").optional(),
});

/**
 * Alta del trabajador en un solo paso: acceso (celular y contraseña), datos, rol y esquema de pago.
 * Si ya tenía acceso en otro taller, solo se le suma el rol (su contraseña no cambia).
 */
export async function agregarPersona(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestor();
  const datos = esquemaPersona.safeParse(Object.fromEntries(form));
  if (!datos.success) {
    const errores: Record<string, string> = {};
    for (const problema of datos.error.issues) errores[String(problema.path[0])] ??= problema.message;
    return { errores };
  }
  const { nombre, celular, clave, documento } = datos.data;
  const rol = datos.data.rol as Rol;
  if (!rolesAsignables(ctx.roles).includes(rol)) {
    return { errores: { rol: "Tu rol no puede asignar ese rol." } };
  }

  const admin = clienteAdmin();
  const supabase = await clienteServidor();

  const [{ data: existente }, { data: conDni }] = await Promise.all([
    admin.from("perfiles").select("id, nombre").eq("celular", celular).maybeSingle(),
    admin.from("perfiles").select("id, nombre").ilike("documento", documento).maybeSingle(),
  ]);
  // El DNI no se repite: si ya es de otra persona, se avisa antes de crear nada.
  if (conDni && conDni.id !== existente?.id) return { errores: { documento: `Ese DNI ya está registrado a nombre de ${conDni.nombre}.` } };
  let perfilId = existente?.id as string | undefined;
  let creado = false;

  if (!perfilId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: celularAEmail(celular),
      password: clave,
      email_confirm: true,
      app_metadata: { nombre, celular },
    });
    if (error || !data.user) return { error: "No se pudo crear el acceso. Intenta otra vez en un momento." };
    perfilId = data.user.id;
    creado = true;
  }

  // Todo lo demás va junto, con la sesión de quien lo hace: rol, datos y esquema de pago.
  const { error } = await supabase.rpc("alta_persona", {
    p_empresa: ctx.taller.id,
    p_perfil: perfilId,
    p_rol: rol,
    p_documento: documento,
    p_cargo: datos.data.cargo ?? "",
    p_fecha_ingreso: datos.data.fechaIngreso,
    p_tipo: datos.data.tipoPago,
    p_monto: Math.round(datos.data.monto * 100) / 100,
    p_frecuencia: datos.data.frecuencia,
    p_comision: rol === "asesor" ? (datos.data.comision ?? 0) : 0,
  });
  if (error) {
    if (creado) await admin.auth.admin.deleteUser(perfilId);
    if (error.code === "23505") return error.message.includes("DNI") ? { errores: { documento: error.message } } : { error: `Esa persona ya tiene el rol ${NOMBRE_ROL[rol]} en este taller.` };
    if (error.code === "42501" || error.code === "23514") return { error: error.message };
    return { error: "La base de datos no permitió el alta." };
  }

  revalidatePath("/usuarios");
  return {
    ok: creado
      ? `${nombre} ya puede entrar con su celular y la contraseña que le diste.`
      : `${existente?.nombre} ya tenía acceso en otro taller: se le agregó el rol. Su contraseña no cambió.`,
  };
}

/** Deja a la persona con exactamente estos roles en el taller actual. */
export async function cambiarRoles(perfilId: string, roles: string[]): Promise<Resultado> {
  const ctx = await exigirGestor();
  const pedidos = [...new Set(roles)].filter(esRol);
  if (pedidos.length === 0) return { error: "Elige al menos un rol. Para quitarle el acceso, desactívala." };

  const supabase = await clienteServidor();
  const { data: actuales, error: errorLeer } = await supabase
    .from("miembros")
    .select("id, rol")
    .eq("empresa_id", ctx.taller.id)
    .eq("perfil_id", perfilId);
  if (errorLeer) return { error: "No se pudieron leer los roles actuales." };

  const asignables = rolesAsignables(ctx.roles);
  const agregar = pedidos.filter((r) => !actuales?.some((a) => a.rol === r));
  const quitar = (actuales ?? []).filter((a) => !pedidos.includes(a.rol as Rol));
  if ([...agregar, ...quitar.map((q) => q.rol as Rol)].some((r) => !asignables.includes(r))) {
    return { error: "Tu rol no puede dar ni quitar el rol de gerencia." };
  }

  if (agregar.length > 0) {
    const { error } = await supabase
      .from("miembros")
      .insert(agregar.map((rol) => ({ empresa_id: ctx.taller.id, perfil_id: perfilId, rol })));
    if (error) return { error: "La base de datos no permitió agregar esos roles." };
  }
  if (quitar.length > 0) {
    const { error, count } = await supabase
      .from("miembros")
      .delete({ count: "exact" })
      .in("id", quitar.map((q) => q.id));
    if (error) {
      return {
        error: error.message.includes("gerencia")
          ? "El taller debe tener al menos una persona con rol gerencia."
          : "La base de datos no permitió quitar esos roles.",
      };
    }
    if (count !== quitar.length) return { error: "Algunos roles no se pudieron quitar." };
  }

  revalidatePath("/usuarios");
  return { ok: "Roles actualizados." };
}

/** Asigna una contraseña nueva (la persona la olvidó o es su primer ingreso). */
export async function asignarClave(perfilId: string, clave: string): Promise<Resultado> {
  await exigirGestor();
  if (clave.length < CLAVE_MINIMA) return { error: `Mínimo ${CLAVE_MINIMA} caracteres.` };
  if (clave.length > 72) return { error: "Máximo 72 caracteres." };

  // Primero se pregunta a la base, con la sesión de quien lo pide, si puede gestionar a esta persona.
  const supabase = await clienteServidor();
  const { data: puede } = await supabase.rpc("puedo_gestionar_perfil", { p_perfil: perfilId });
  if (puede !== true) return { error: "No puedes cambiar la contraseña de esta persona." };

  const { error } = await clienteAdmin().auth.admin.updateUserById(perfilId, { password: clave });
  if (error) return { error: "No se pudo cambiar la contraseña. Intenta otra vez." };
  return { ok: "Contraseña cambiada. Dásela en persona." };
}

const esquemaDatos = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre y apellido.").max(80, "Máximo 80 letras."),
  documento: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, "").toUpperCase())
    .refine((v) => v === "" || /^[0-9A-Z]{6,15}$/.test(v), "DNI o carné: de 6 a 15 letras o números."),
  cargo: z.string().trim().max(60, "Máximo 60 letras.").refine((v) => v === "" || v.length >= 2, "Muy corto."),
  fechaIngreso: z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Fecha no válida."),
});

/** Datos de la persona: nombre, documento, cargo y fecha de ingreso. El celular no se cambia aquí. */
export async function editarDatos(perfilId: string, datos: unknown): Promise<Resultado> {
  await exigirGestor();
  const r = esquemaDatos.safeParse(datos);
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const problema of r.error.issues) errores[String(problema.path[0])] ??= problema.message;
    return { errores };
  }
  const { nombre, documento, cargo, fechaIngreso } = r.data;
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("perfiles")
    .update({ nombre, documento: documento || null, cargo: cargo || null, fecha_ingreso: fechaIngreso || null }, { count: "exact" })
    .eq("id", perfilId);
  if (error || count !== 1) return { error: "No tienes permiso para cambiar los datos de esta persona." };
  revalidatePath("/usuarios");
  return { ok: "Datos guardados." };
}

/** Bloquea o desbloquea el ingreso según si le queda algún taller activo. */
async function ajustarIngreso(perfilId: string) {
  const admin = clienteAdmin();
  const [{ data: activas }, { data: perfil }] = await Promise.all([
    admin.from("miembros").select("id").eq("perfil_id", perfilId).eq("activo", true).limit(1),
    admin.from("perfiles").select("activo").eq("id", perfilId).maybeSingle(),
  ]);
  const puedeEntrar = (activas?.length ?? 0) > 0 && perfil?.activo !== false;
  // Bloquear el ingreso también invalida sus sesiones abiertas (no puede renovarlas).
  await admin.auth.admin.updateUserById(perfilId, { ban_duration: puedeEntrar ? "none" : "876000h" });
}

/**
 * Dar de baja en este taller: pierde el acceso al instante y no se borra nada
 * (sus órdenes, movimientos y gastos siguen a su nombre).
 */
export async function darDeBaja(perfilId: string, motivo: string, fecha: string): Promise<Resultado> {
  const ctx = await exigirGestor();
  if (perfilId === ctx.perfil.id) return { error: "No puedes darte de baja a ti mismo." };
  if (motivo.trim().length < 3) return { error: "Escribe el motivo de la baja." };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("dar_de_baja", {
    p_empresa: ctx.taller.id,
    p_perfil: perfilId,
    p_motivo: motivo.trim(),
    p_fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : undefined,
  });
  if (error) return { error: error.code === "23514" || error.code === "42501" || error.code === "P0002" ? error.message : "No se pudo dar de baja." };
  await ajustarIngreso(perfilId);
  revalidatePath("/usuarios");
  return { ok: "Listo: ya no puede entrar. Su historial se conserva." };
}

/** Devolver el acceso a alguien dado de baja. */
export async function reactivar(perfilId: string): Promise<Resultado> {
  const ctx = await exigirGestor();
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("reactivar", { p_empresa: ctx.taller.id, p_perfil: perfilId });
  if (error) return { error: error.code === "42501" ? error.message : "No se pudo reactivar." };
  await ajustarIngreso(perfilId);
  revalidatePath("/usuarios");
  return { ok: "Acceso devuelto. Entra con su misma contraseña." };
}

const esquemaCambioPago = z.object({
  tipo: z.enum(["fijo", "destajo"]),
  monto: z.coerce.number({ error: "Escribe el monto." }).min(0).max(100000),
  frecuencia: z.enum(["semanal", "quincenal", "mensual"]),
  comision: z.coerce.number().min(0).max(100).optional(),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige desde cuándo."),
  motivo: z.string().trim().min(3, "Escribe el motivo.").max(200),
});

/** Cambiar el pago: crea una versión nueva desde hoy o una fecha futura; lo ya pagado no se toca. */
export async function cambiarPago(perfilId: string, datos: unknown): Promise<Resultado> {
  const ctx = await exigirGestor();
  const r = esquemaCambioPago.safeParse(datos);
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("cambiar_esquema_pago", {
    p_empresa: ctx.taller.id,
    p_perfil: perfilId,
    p_tipo: r.data.tipo,
    p_monto: Math.round(r.data.monto * 100) / 100,
    p_frecuencia: r.data.frecuencia,
    p_comision: r.data.comision ?? 0,
    p_desde: r.data.desde,
    p_motivo: r.data.motivo,
  });
  if (error) return { error: error.code === "23514" || error.code === "42501" ? error.message : "No se pudo guardar el cambio." };
  revalidatePath("/usuarios");
  return { ok: "Pago actualizado. Lo anterior queda en su historial." };
}
