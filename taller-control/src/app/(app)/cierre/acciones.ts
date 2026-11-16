"use server";

import { revalidatePath } from "next/cache";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cierreDelDia } from "@/lib/taller/cierre-consultas";

export type Resultado = { ok?: string; error?: string };

/** Guarda una foto del cierre del día (no se puede cerrar dos veces el mismo día). */
export async function cerrarDia(dia: string, observaciones: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) return { error: "Tu rol no cierra el día." };
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
