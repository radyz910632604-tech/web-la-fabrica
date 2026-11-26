"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ESTADOS_ORDEN } from "@/lib/taller/estados";
import { obtenerContexto } from "@/lib/sesion";
import { tieneAlguno } from "@/lib/roles";
import { validarEntrega } from "@/lib/taller/entrega";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string };

export async function cambiarEstado(ordenId: string, estado: string, nota: string): Promise<Resultado> {
  await obtenerContexto();
  const e = z.enum(ESTADOS_ORDEN).safeParse(estado);
  if (!e.success) return { error: "Estado no válido." };
  const supabase = await clienteServidor();
  // Para empezar a trabajar un carro hay que saber quién lo trabaja.
  if (e.data === "en_proceso" || e.data === "en_diagnostico") {
    const { data: o } = await supabase.from("ordenes_trabajo").select("tecnico_id").eq("id", ordenId).maybeSingle();
    if (o && !o.tecnico_id) return { error: "Primero elige quién lo trabaja." };
  }
  const { error } = await supabase.rpc("cambiar_estado_orden", { p_orden: ordenId, p_estado: e.data, p_nota: nota.trim() || null });
  if (error) return { error: error.message.includes("asesor") ? "La entrega al cliente la registra el asesor o recepción." : error.message.includes("Recepción") ? error.message : "No puedes cambiar el estado de esta orden." };
  revalidatePath(`/ordenes/${ordenId}`);
  revalidatePath("/", "layout");
  return { ok: "Estado actualizado." };
}

export async function agregarAvance(ordenId: string, texto: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  const limpio = texto.trim();
  if (limpio.length < 2) return { error: "Escribe qué se hizo." };
  if (limpio.length > 2000) return { error: "Máximo 2000 letras." };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("orden_avances").insert({ empresa_id: ctx.taller.id, orden_id: ordenId, texto: limpio, autor_id: ctx.perfil.id });
  if (error) return { error: "No puedes reportar avances en esta orden." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Avance guardado." };
}

export async function guardarDiagnostico(ordenId: string, texto: string): Promise<Resultado> {
  await obtenerContexto();
  const limpio = texto.trim();
  if (limpio.length < 3) return { error: "Escribe qué encontraron." };
  if (limpio.length > 2000) return { error: "Máximo 2000 letras." };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("registrar_diagnostico", { p_orden: ordenId, p_texto: limpio });
  if (error) return { error: "No puedes escribir el diagnóstico de esta orden." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Diagnóstico guardado." };
}

export async function asignarTecnico(ordenId: string, tecnicoId: string): Promise<Resultado> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("ordenes_trabajo")
    .update({ tecnico_id: tecnicoId || null }, { count: "exact" })
    .eq("id", ordenId);
  if (error || count !== 1) return { error: "No puedes asignar técnico en esta orden." };
  revalidatePath(`/ordenes/${ordenId}`);
  revalidatePath("/", "layout");
  return { ok: tecnicoId ? "Listo. El cambio queda en los avances de la orden." : "Técnico quitado." };
}

export async function agregarServicio(ordenId: string, descripcion: string, adicional: boolean): Promise<Resultado> {
  const ctx = await obtenerContexto();
  const limpio = descripcion.trim();
  if (limpio.length < 2) return { error: "Escribe el servicio." };
  const supabase = await clienteServidor();
  const { data: delCatalogo } = await supabase
    .from("catalogo_servicios")
    .select("id")
    .eq("empresa_id", ctx.taller.id)
    .ilike("nombre", limpio)
    .maybeSingle();
  const { error } = await supabase
    .from("orden_servicios")
    .insert({ empresa_id: ctx.taller.id, orden_id: ordenId, descripcion: limpio, servicio_id: delCatalogo?.id ?? null, es_adicional: adicional });
  if (error) return { error: "No puedes agregar servicios a esta orden." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Servicio agregado." };
}

/** Pone o cambia la hora prometida al cliente. La base anota el cambio en la orden. */
export async function cambiarEntrega(ordenId: string, valor: { dia: string; hora: string; porDefinir: boolean }): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) return { error: "La hora de entrega la cambia el asesor." };
  const v = z.object({ dia: z.string(), hora: z.string(), porDefinir: z.boolean() }).safeParse(valor);
  if (!v.success) return { error: "Revisa el día y la hora." };
  const entrega = validarEntrega(v.data, new Date());
  if ("error" in entrega) return { error: entrega.error };
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("ordenes_trabajo")
    .update({ entrega_prometida: entrega.instante?.toISOString() ?? null }, { count: "exact" })
    .eq("id", ordenId)
    .eq("empresa_id", ctx.taller.id)
    .eq("anulada", false);
  if (error || !count) return { error: "No se pudo cambiar la hora de entrega." };
  revalidatePath(`/ordenes/${ordenId}`);
  revalidatePath("/", "layout");
  return { ok: entrega.instante ? "Hora de entrega guardada." : "La hora de entrega quedó por definir." };
}
