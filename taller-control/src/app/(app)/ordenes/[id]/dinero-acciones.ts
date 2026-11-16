"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desdeTotal } from "@/lib/dinero";
import { tieneAlguno } from "@/lib/roles";
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

/** Nueva cotización (versión automática). Los precios se escriben con IGV, como los ve el cliente. */
export async function crearCotizacion(ordenId: string, adicional: boolean, datos: unknown): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) return { error: "Tu rol no crea cotizaciones." };
  const r = lineas.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa las líneas." };
  const { tasaIgv } = await configDinero(ctx.taller.id);
  const items = r.data.map((l) => {
    const m = desdeTotal(l.cantidad * l.precio, tasaIgv);
    return { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio: l.precio, sin_igv: m.sinIgv, igv: m.igv, total: m.total };
  });
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("crear_cotizacion", { p_orden: ordenId, p_adicional: adicional, p_items: items });
  if (error) return { error: "No se pudo crear la cotización." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Cotización creada." };
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
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Listo." };
}
