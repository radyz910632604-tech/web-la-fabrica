"use server";

import { revalidatePath } from "next/cache";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cierreDelDia } from "@/lib/taller/cierre-consultas";

export type Resultado = { ok?: string; error?: string };

/** Guarda una foto del cierre del día (no se puede cerrar dos veces el mismo día). */
export async function cerrarDia(dia: string, observaciones: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no cierra el día." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { error: "Fecha no válida." };
  const datos = await cierreDelDia(ctx.taller.id, dia, ctx.roles.includes("gerencia"));
  const supabase = await clienteServidor();
  const { error } = await supabase.from("cierres_diarios").insert({
    empresa_id: ctx.taller.id,
    fecha: dia,
    datos,
    observaciones: observaciones.trim().slice(0, 1000) || null,
  });
  if (error) return { error: error.code === "23505" ? "Este día ya se cerró." : "No se pudo cerrar el día." };
  revalidatePath("/cierre");
  return { ok: "Día cerrado." };
}

/**
 * «Cerrar caja» del cierre diario: cierra la caja de Recepción con el efectivo contado (si sigue
 * abierta) y guarda la foto del día. Lo guardado no cambia después (queda como histórico).
 */
export async function cerrarCajaDelDia(dia: string, cajaId: string | null, contado: string, observaciones: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no cierra la caja." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return { error: "Fecha no válida." };
  const supabase = await clienteServidor();
  let mensaje = "";
  if (cajaId) {
    const monto = Number(contado.replace(",", "."));
    if (contado.trim() === "" || !Number.isFinite(monto) || monto < 0) return { error: "Escribe cuánto efectivo contaste." };
    const { data, error } = await supabase.rpc("cerrar_caja", { p_caja: cajaId, p_contado: Math.round(monto * 100) / 100, p_observaciones: observaciones.trim().slice(0, 1000) || null });
    if (error) return { error: error.message.includes("cerrada") ? "Esta caja ya está cerrada." : "No se pudo cerrar la caja." };
    const d = Number((data as { diferencia: number }).diferencia);
    mensaje = d === 0 ? "Caja cerrada: cuadró exacto." : d > 0 ? `Caja cerrada: sobran S/ ${d.toFixed(2)}.` : `Caja cerrada: faltan S/ ${Math.abs(d).toFixed(2)}.`;
  }
  const datos = await cierreDelDia(ctx.taller.id, dia, ctx.roles.includes("gerencia"));
  const { error } = await supabase.from("cierres_diarios").insert({ empresa_id: ctx.taller.id, fecha: dia, datos, observaciones: observaciones.trim().slice(0, 1000) || null });
  if (error && error.code !== "23505") return { error: `${mensaje} No se pudo guardar el cierre del día.`.trim() };
  revalidatePath("/", "layout");
  return { ok: `${mensaje} ${error ? "El día ya estaba cerrado." : "Cierre del día guardado."}`.trim() };
}
