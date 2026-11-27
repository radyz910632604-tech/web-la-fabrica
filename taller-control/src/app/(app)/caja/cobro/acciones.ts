"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string };

const CODIGOS = ["23514", "22023", "42501", "check_violation"];
const mensaje = (e: { code?: string; message: string } | null, otro: string) => (e && CODIGOS.includes(e.code ?? "") ? e.message : otro);

const esquemaLineas = z.object({
  orden: z.string().uuid(),
  cotizacion: z.string().uuid().nullable(),
  conIgv: z.boolean(),
  lineas: z
    .array(
      z.object({
        tipo: z.enum(["servicio", "repuesto"]),
        descripcion: z.string().trim().min(2, "Escribe la descripción.").max(200),
        cantidad: z.coerce.number({ error: "Revisa la cantidad." }).positive("La cantidad debe ser mayor que cero.").max(9999),
        base: z.coerce.number({ error: "Revisa el precio." }).min(0, "El precio no puede ser negativo.").max(9_999_999).optional(),
        // Precio CON IGV por unidad (la orden lo usa así); se guarda exacto.
        precio: z.coerce.number({ error: "Revisa el precio." }).min(0, "El precio no puede ser negativo.").max(9_999_999).optional(),
      }).refine((l) => l.base != null || l.precio != null, "Escribe el precio."),
    )
    .max(60),
});

/**
 * Guarda las líneas de una cotización de la orden desde la caja (o crea la primera).
 * El precio llega SIN IGV por unidad; la base calcula IGV y totales, guarda una versión
 * nueva con quién la hizo y aplica las reglas (pagada, entregada, IGV, total menor a lo pagado).
 */
export async function guardarLineas(datos: unknown): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no cambia importes." };
  const r = esquemaLineas.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa las líneas." };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("editar_lineas_orden", {
    p_orden: r.data.orden,
    p_cotizacion: r.data.cotizacion,
    p_items: r.data.lineas.map((l) => (l.precio != null ? { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio: Math.round(l.precio * 100) / 100 } : { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, base: l.base })),
    p_con_igv: r.data.conIgv,
    p_aprobar: true,
  });
  if (error) return { error: mensaje(error, "No se pudo guardar. Intenta otra vez.") };
  revalidatePath("/caja/cobro");
  revalidatePath(`/ordenes/${r.data.orden}`);
  return { ok: "Guardado." };
}

/** IGV de toda la orden (quitarlo lo autoriza gerencia o administración; la base lo exige). */
export async function cambiarIgv(ordenId: string, conIgv: boolean): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no cambia importes." };
  if (!z.string().uuid().safeParse(ordenId).success) return { error: "Orden no válida." };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("cambiar_igv_orden", { p_orden: ordenId, p_con_igv: conIgv });
  if (error) return { error: mensaje(error, "No se pudo cambiar el IGV.") };
  revalidatePath("/caja/cobro");
  return { ok: conIgv ? "IGV aplicado." : "Sin IGV." };
}

/** Aprobar en persona una cotización que estaba por aprobar. */
export async function aprobarEnCaja(cotizacionId: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no aprueba cotizaciones." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("cotizaciones")
    .update({ estado: "aprobada", aprobada_por_medio: "presencial", respuesta_en: new Date().toISOString() }, { count: "exact" })
    .eq("id", cotizacionId)
    .in("estado", ["borrador", "enviada"]);
  if (error || count !== 1) return { error: "No se pudo aprobar." };
  revalidatePath("/caja/cobro");
  return { ok: "Aprobada." };
}

/** Devolución vinculada al pago original, por el mismo medio (no borra el pago). */
export async function devolver(pagoId: string, monto: string, motivo: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no registra devoluciones." };
  const m = Number(monto.replace(",", "."));
  if (!Number.isFinite(m) || m <= 0) return { error: "Escribe el monto." };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("registrar_devolucion", { p_pago: pagoId, p_monto: Math.round(m * 100) / 100, p_motivo: motivo.trim() });
  if (error) return { error: mensaje(error, "No se pudo registrar la devolución.") };
  revalidatePath("/caja/cobro");
  return { ok: `Devolución de S/ ${m.toFixed(2)} registrada.` };
}
