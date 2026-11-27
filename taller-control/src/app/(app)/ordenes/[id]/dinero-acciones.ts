"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desdeSinIgv, desdeTotal, redondear } from "@/lib/dinero";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { configDinero } from "@/lib/taller/dinero-consultas";

export type Resultado = { ok?: string; error?: string };

const lineas = z
  .array(
    z.object({
      tipo: z.enum(["servicio", "repuesto"]),
      descripcion: z.string().trim().min(2, "Describe cada línea.").max(200),
      cantidad: z.coerce.number().positive("Cantidad mayor que cero."),
      precio: z.coerce.number().min(0, "Precio no válido."),
    }),
  )
  .min(1, "Agrega al menos una línea.");

type OpcionesIgv = { conIgv: boolean; preciosConIgv: boolean };

/** Líneas listas para la base: precio por unidad con IGV, sin IGV, IGV y total. */
async function prepararLineas(empresaId: string, datos: unknown, opciones: OpcionesIgv) {
  const r = lineas.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa las líneas." };
  const { tasaIgv } = await configDinero(empresaId);
  const tasa = opciones.conIgv ? tasaIgv : 0;
  const items = r.data.map((l) => {
    const bruto = l.cantidad * l.precio;
    const m = !opciones.conIgv ? desdeTotal(bruto, 0) : opciones.preciosConIgv ? desdeTotal(bruto, tasa) : desdeSinIgv(bruto, tasa);
    return { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio: redondear(m.total / l.cantidad), sin_igv: m.sinIgv, igv: m.igv, total: m.total };
  });
  return { items };
}

/**
 * Nueva cotización (versión automática).
 * - conIgv: si la operación lleva IGV (18 %). Sin IGV, el total es el precio.
 * - preciosConIgv: si los precios escritos ya incluyen el IGV.
 */
export async function crearCotizacion(ordenId: string, adicional: boolean, datos: unknown, opciones: OpcionesIgv = { conIgv: true, preciosConIgv: true }): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no crea cotizaciones." };
  const p = await prepararLineas(ctx.taller.id, datos, opciones);
  if (p.error) return { error: p.error };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("crear_cotizacion", { p_orden: ordenId, p_adicional: adicional, p_items: p.items, p_con_igv: opciones.conIgv });
  if (error) return { error: "No se pudo crear la cotización." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Cotización creada." };
}

/**
 * Editar una cotización: se guarda como versión nueva y la anterior queda anulada (a la vista).
 * Si ya estaba aprobada, la nueva sigue aprobada. No se edita si ya hay recibo, boleta o factura.
 */
export async function editarCotizacion(id: string, ordenId: string, datos: unknown, opciones: OpcionesIgv): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no edita cotizaciones." };
  const p = await prepararLineas(ctx.taller.id, datos, opciones);
  if (p.error) return { error: p.error };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("editar_cotizacion", { p_cotizacion: id, p_items: p.items, p_con_igv: opciones.conIgv });
  if (error) {
    if (error.code === "23514" || error.code === "P0001") return { error: error.message };
    return { error: error.code === "42501" ? "Tu rol no edita cotizaciones." : "No se pudo guardar el cambio." };
  }
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Cotización actualizada." };
}

const respuesta = z.object({
  estado: z.enum(["enviada", "aprobada", "rechazada", "anulada"]),
  medio: z.enum(["whatsapp", "presencial", "llamada"]).optional(),
  texto: z.string().trim().max(500).optional(),
});

/** Marcar la cotización como enviada, aprobada (y por qué medio), rechazada o anulada. */
export async function responderCotizacion(id: string, ordenId: string, datos: unknown): Promise<Resultado> {
  await obtenerContexto();
  const r = respuesta.safeParse(datos);
  if (!r.success) return { error: "Elige una respuesta." };
  const { estado, medio, texto } = r.data;
  if (estado === "aprobada" && !medio) return { error: "Indica cómo aprobó el cliente." };
  const ahora = new Date().toISOString();
  const cambios: Record<string, unknown> = { estado };
  if (estado === "enviada") cambios.enviada_en = ahora;
  if (estado === "aprobada" || estado === "rechazada") {
    cambios.respuesta_en = ahora;
    cambios.aprobada_por_medio = medio ?? null;
    cambios.respuesta_texto = texto || null;
  }
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("cotizaciones").update(cambios, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo guardar la respuesta." };
  if (ordenId) revalidatePath(`/ordenes/${ordenId}`);
  revalidatePath("/cotizaciones", "layout");
  return { ok: "Listo." };
}

/** Enviar la cotización al cliente por WhatsApp, con botones para aprobarla. */
export async function enviarCotizacionWhatsapp(id: string, ordenId: string): Promise<Resultado> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("enviar_cotizacion_whatsapp", { p_cotizacion: id });
  if (error) return { error: error.code === "42501" ? "Tu rol no envía cotizaciones." : error.code === "23514" ? "Esta cotización ya fue respondida." : "No se pudo enviar." };
  revalidatePath(`/ordenes/${ordenId}`);
  if (data === "sin_consentimiento") return { error: "El cliente no aceptó recibir mensajes. Envíala tú y toca «Marcar enviada»." };
  if (data === "apagado") return { error: "El envío de cotizaciones por WhatsApp está apagado en Configuración → Avisos." };
  return { ok: "Listo: se enviará por WhatsApp en unos minutos. Cuando el cliente responda, se marca sola." };
}
