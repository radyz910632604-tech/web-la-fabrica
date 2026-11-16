"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizarCelular } from "@/lib/celulares";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { REDES } from "@/lib/taller/estados";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const fechaHoraLima = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-05:00`);

const esquema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del cliente.").max(120),
  celular: z.string(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha."),
  hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Elige la hora."),
  servicio: z.string().trim().min(2, "Escribe el servicio.").max(120),
  red: z.enum(Object.keys(REDES) as [keyof typeof REDES, ...(keyof typeof REDES)[]], { error: "Elige la red." }),
  campana: z.string().trim().max(80),
  vendedor: z.string(),
  notas: z.string().trim().max(500),
});

export async function agendarCita(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  const esVendedor = ctx.roles.includes("vendedor_redes") && !tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]);
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes"])) return { error: "Tu rol no agenda citas." };
  const r = esquema.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const d = r.data;
  const celular = normalizarCelular(d.celular);
  if (!celular) return { errores: { celular: "Celular de 9 dígitos, por ejemplo 987 654 321." } };
  const cuando = fechaHoraLima(d.fecha, d.hora);
  if (Number.isNaN(cuando.getTime())) return { errores: { fecha: "Fecha u hora no válida." } };
  if (cuando.getTime() < Date.now() - 60 * 60 * 1000) return { errores: { fecha: "Esa fecha y hora ya pasaron." } };

  const supabase = await clienteServidor();
  const { data: cliente } = await supabase.from("clientes").select("id").eq("empresa_id", ctx.taller.id).eq("celular", celular).maybeSingle();
  const vendedorId = esVendedor ? ctx.perfil.id : d.vendedor || (ctx.roles.includes("vendedor_redes") ? ctx.perfil.id : null);

  const { error } = await supabase.from("citas").insert({
    empresa_id: ctx.taller.id,
    cliente_id: cliente?.id ?? null,
    nombre_cliente: d.nombre,
    celular,
    fecha_hora: cuando.toISOString(),
    servicio: d.servicio,
    red: d.red,
    campana: d.campana || null,
    vendedor_id: vendedorId,
    notas: d.notas || null,
  });
  if (error) return { error: "No se pudo agendar la cita." };
  revalidatePath("/citas");
  revalidatePath("/", "layout");
  return { ok: `Cita agendada para el ${d.fecha.split("-").reverse().join("/")} a las ${d.hora}.` };
}

export async function confirmarCita(id: string): Promise<Resultado> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("confirmar_cita", { p_cita: id });
  if (error) return { error: "No se pudo confirmar la cita." };
  revalidatePath("/citas");
  revalidatePath("/", "layout");
  return { ok: "Cita confirmada." };
}

export async function cancelarCita(id: string): Promise<Resultado> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("citas")
    .update({ estado: "cancelada" }, { count: "exact" })
    .eq("id", id)
    .in("estado", ["agendada", "confirmada", "no_llego"]);
  if (error || count !== 1) return { error: "No puedes cancelar esta cita." };
  revalidatePath("/citas");
  revalidatePath("/", "layout");
  return { ok: "Cita cancelada." };
}

export async function reagendarCita(id: string, fecha: string, hora: string): Promise<Resultado> {
  await obtenerContexto();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { error: "Elige la nueva fecha y hora." };
  const cuando = fechaHoraLima(fecha, hora);
  if (cuando.getTime() < Date.now()) return { error: "La nueva fecha ya pasó." };
  const supabase = await clienteServidor();
  const { data: c } = await supabase.from("citas").select("*").eq("id", id).maybeSingle();
  if (!c || !["agendada", "confirmada", "no_llego"].includes(c.estado)) return { error: "Esta cita ya no se puede reagendar." };
  const { error, count } = await supabase.from("citas").update({ estado: "reagendada" }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No puedes reagendar esta cita." };
  const { error: errorNueva } = await supabase.from("citas").insert({
    empresa_id: c.empresa_id,
    cliente_id: c.cliente_id,
    nombre_cliente: c.nombre_cliente,
    celular: c.celular,
    fecha_hora: cuando.toISOString(),
    servicio: c.servicio,
    red: c.red,
    campana: c.campana,
    vendedor_id: c.vendedor_id,
    notas: c.notas,
    reprogramada_desde_id: c.id,
  });
  if (errorNueva) return { error: "Se marcó como reagendada, pero no se creó la nueva cita. Agéndala de nuevo." };
  revalidatePath("/citas");
  revalidatePath("/", "layout");
  return { ok: `Reagendada para el ${fecha.split("-").reverse().join("/")} a las ${hora}.` };
}
