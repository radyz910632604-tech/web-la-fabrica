"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { diaEnLima } from "@/lib/formato";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { Resultado } from "./acciones";

/** Lo de sueldos y comisiones solo lo cambia gerencia (la base también lo exige). */
async function exigirGerencia() {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("gerencia")) throw new Error("Solo gerencia cambia sueldos y comisiones.");
  return ctx;
}

const monto = (texto: FormDataEntryValue) => {
  const v = String(texto).trim().replace(",", ".");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};

export async function guardarReglaManoObra(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGerencia();
  const regla = String(form.get("regla"));
  if (regla !== "prorrateo_mensual" && regla !== "fijo_por_servicio") return { error: "Elige una regla." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("configuracion_empresa").update({ regla_mano_obra: regla }, { count: "exact" }).eq("empresa_id", ctx.taller.id);
  if (error || count !== 1) return { error: "No se pudo guardar." };
  revalidatePath("/", "layout");
  return { ok: "Guardado." };
}

/** Costo mensual por persona. Un cambio crea un nuevo valor vigente desde hoy (se guarda la historia). */
export async function guardarCostos(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGerencia();
  const hoy = diaEnLima(new Date());
  const filas: { empresa_id: string; perfil_id: string; costo_mensual: number; vigente_desde: string }[] = [];
  for (const [clave, valor] of form.entries()) {
    if (!clave.startsWith("costo_")) continue;
    const anterior = form.get(`antes_${clave.slice(6)}`);
    const v = monto(valor);
    if (v === null || String(anterior) === String(v)) continue;
    if (Number.isNaN(v)) return { error: "Revisa los montos: solo números." };
    filas.push({ empresa_id: ctx.taller.id, perfil_id: clave.slice(6), costo_mensual: v, vigente_desde: hoy });
  }
  if (filas.length === 0) return { ok: "No hubo cambios." };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("costos_personal").upsert(filas, { onConflict: "empresa_id,perfil_id,vigente_desde" });
  if (error) return { error: "No se pudo guardar." };
  revalidatePath("/", "layout");
  return { ok: `Guardado (${filas.length} ${filas.length === 1 ? "cambio" : "cambios"}).` };
}

/** Mano de obra fija por servicio (se usa con la regla "fijo por servicio"). */
export async function guardarManoObraServicios(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGerencia();
  const poner: { empresa_id: string; servicio_id: string; monto: number }[] = [];
  const quitar: string[] = [];
  for (const [clave, valor] of form.entries()) {
    if (!clave.startsWith("mo_")) continue;
    const v = monto(valor);
    if (Number.isNaN(v)) return { error: "Revisa los montos: solo números." };
    if (v === null) quitar.push(clave.slice(3));
    else poner.push({ empresa_id: ctx.taller.id, servicio_id: clave.slice(3), monto: v });
  }
  const supabase = await clienteServidor();
  if (poner.length) {
    const { error } = await supabase.from("mano_obra_servicio").upsert(poner, { onConflict: "empresa_id,servicio_id" });
    if (error) return { error: "No se pudo guardar." };
  }
  if (quitar.length) await supabase.from("mano_obra_servicio").delete().eq("empresa_id", ctx.taller.id).in("servicio_id", quitar);
  revalidatePath("/", "layout");
  return { ok: "Guardado." };
}

const esquemaComision = z.object({
  nombre: z.string().trim().min(2, "Ponle un nombre.").max(80),
  evento: z.enum(["cita_llego_y_pago", "trabajo_entregado"]),
  tipo_monto: z.enum(["fijo", "porcentaje"]),
  valor: z.coerce.number({ error: "Escribe el valor." }).min(0, "No puede ser negativo.").max(100000),
});

/** Reglas de comisión: gerencia y administración (la base también lo exige). */
async function exigirGestorComisiones() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) throw new Error("Solo gerencia o administración manejan comisiones.");
  return ctx;
}

export async function crearReglaComision(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirGestorComisiones();
  const r = esquemaComision.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  if (r.data.tipo_monto === "porcentaje" && r.data.valor > 100) return { errores: { valor: "Un porcentaje va de 0 a 100." } };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("reglas_comision").insert({ ...r.data, empresa_id: ctx.taller.id });
  if (error) return { error: "No se pudo crear la regla." };
  revalidatePath("/", "layout");
  return { ok: "Regla creada." };
}

export async function cambiarReglaComision(id: string, activa: boolean): Promise<Resultado> {
  await exigirGestorComisiones();
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("reglas_comision").update({ activa }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo cambiar." };
  revalidatePath("/", "layout");
  return { ok: activa ? "Regla activada." : "Regla pausada." };
}
