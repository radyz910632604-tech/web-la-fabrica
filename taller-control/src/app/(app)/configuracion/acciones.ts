"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { diaEnLima } from "@/lib/formato";
import { esGestor } from "@/lib/roles";
import { COOKIE_TALLER, obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

async function exigirGestor() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) throw new Error("Solo gerencia o administración pueden cambiar la configuración.");
  return ctx;
}

function erroresDe(error: z.ZodError): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const problema of error.issues) errores[String(problema.path[0])] ??= problema.message;
  return errores;
}

const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo ${max} caracteres.`)
    .transform((v) => v || null);

const esquemaTaller = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del taller.").max(80, "Máximo 80 caracteres."),
  razon_social: opcional(160),
  ruc: z
    .string()
    .trim()
    .refine((v) => v === "" || /^(10|15|17|20)\d{9}$/.test(v), "El RUC tiene 11 dígitos y empieza en 10, 15, 17 o 20.")
    .transform((v) => v || null),
  direccion: opcional(200),
  telefono: opcional(30),
});

export async function guardarTaller(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestor();
  const datos = esquemaTaller.safeParse(Object.fromEntries(form));
  if (!datos.success) return { errores: erroresDe(datos.error) };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("empresas").update(datos.data, { count: "exact" }).eq("id", ctx.taller.id);
  if (error || count !== 1) return { error: "No se pudo guardar. Revisa tu conexión e intenta otra vez." };
  revalidatePath("/", "layout");
  return { ok: "Guardado." };
}

const entero = (min: number, max: number, nombre: string) =>
  z.coerce.number({ error: `Escribe ${nombre}.` }).int("Sin decimales.").min(min, `Mínimo ${min}.`).max(max, `Máximo ${max}.`);

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora como 19:00.");

const esquemaReglas = z.object({
  tolerancia_cita_minutos: entero(0, 240, "los minutos"),
  dias_garantia_defecto: entero(0, 1095, "los días"),
  dias_cliente_inactivo: entero(30, 1095, "los días"),
  horas_orden_sin_cambio: entero(1, 720, "las horas"),
  margen_minimo_pct: z.coerce.number().min(0, "Mínimo 0.").max(100, "Máximo 100."),
  igv_pct: z.coerce.number().min(0, "Mínimo 0.").max(50, "Máximo 50."),
  hora_resumen_mediodia: hora,
  hora_cierre: hora,
});

export async function guardarReglas(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestor();
  const datos = esquemaReglas.safeParse(Object.fromEntries(form));
  if (!datos.success) return { errores: erroresDe(datos.error) };
  const { igv_pct, ...resto } = datos.data;
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("configuracion_empresa")
    .update({ ...resto, tasa_igv: Math.round(igv_pct * 100) / 10000 }, { count: "exact" })
    .eq("empresa_id", ctx.taller.id);
  if (error || count !== 1) return { error: "No se pudo guardar. Revisa tu conexión e intenta otra vez." };
  revalidatePath("/configuracion");
  return { ok: "Guardado." };
}

export async function guardarMeta(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestor();
  const datos = z
    .object({ meta: z.coerce.number({ error: "Escribe un monto." }).min(0, "No puede ser negativa.").max(99_999_999, "Monto muy alto.") })
    .safeParse(Object.fromEntries(form));
  if (!datos.success) return { errores: erroresDe(datos.error) };
  const [anio, mes] = diaEnLima(new Date()).split("-").map(Number);
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("metas_ventas")
    .upsert({ empresa_id: ctx.taller.id, anio, mes, meta_sin_igv: datos.data.meta }, { onConflict: "empresa_id,anio,mes" });
  if (error) return { error: "No se pudo guardar la meta." };
  revalidatePath("/", "layout");
  return { ok: "Meta guardada." };
}

export async function guardarPermisosAdmin(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestor();
  if (!ctx.roles.includes("gerencia")) return { error: "Solo gerencia decide lo que ve administración." };
  const supabase = await clienteServidor();
  const { error } = await supabase
    .from("configuracion_empresa")
    .update({ admin_ve_utilidad: form.get("admin_ve_utilidad") === "on", admin_ve_sueldos: form.get("admin_ve_sueldos") === "on" })
    .eq("empresa_id", ctx.taller.id);
  if (error) return { error: "No se pudo guardar." };
  revalidatePath("/", "layout");
  return { ok: "Guardado." };
}

export async function crearTaller(_previo: Resultado, form: FormData): Promise<Resultado> {
  await exigirGestor();
  const datos = z
    .object({ nombre: z.string().trim().min(2, "Escribe el nombre del taller.").max(80, "Máximo 80 caracteres.") })
    .safeParse(Object.fromEntries(form));
  if (!datos.success) return { errores: erroresDe(datos.error) };
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("crear_empresa", { p_nombre: datos.data.nombre });
  if (error || !data) return { error: "No se pudo crear el taller." };
  (await cookies()).set(COOKIE_TALLER, String(data), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  return { ok: `Listo. Ahora estás en ${datos.data.nombre}; agrega a su personal en Personal y roles.` };
}

const CATEGORIAS = ["transmision", "gnv_glp", "aire_acondicionado", "frenos", "aceite", "otro"] as const;

export async function agregarServicioCatalogo(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestor();
  const datos = z
    .object({
      nombre: z.string().trim().min(2, "Escribe el nombre del servicio.").max(120, "Máximo 120 caracteres."),
      categoria: z.enum(CATEGORIAS),
      dias_garantia: z.preprocess((v) => (v === "" ? null : v), z.coerce.number().int().min(0, "Mínimo 0.").max(1095, "Máximo 1095.").nullable()),
    })
    .safeParse(Object.fromEntries(form));
  if (!datos.success) return { errores: erroresDe(datos.error) };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("catalogo_servicios").insert({ empresa_id: ctx.taller.id, ...datos.data });
  if (error) return error.code === "23505" ? { errores: { nombre: "Ese servicio ya existe." } } : { error: "No se pudo agregar." };
  revalidatePath("/configuracion");
  return { ok: `«${datos.data.nombre}» agregado.` };
}

export async function cambiarServicioCatalogo(id: string, activo: boolean): Promise<Resultado> {
  await exigirGestor();
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("catalogo_servicios").update({ activo }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo cambiar." };
  revalidatePath("/configuracion");
  return { ok: activo ? "Servicio activado." : "Servicio ocultado." };
}
