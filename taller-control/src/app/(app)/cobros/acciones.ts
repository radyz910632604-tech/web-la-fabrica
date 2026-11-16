"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const esquema = z.object({
  orden: z.string().uuid("Elige la orden."),
  monto: z.coerce.number({ error: "Escribe el monto." }).positive("El monto debe ser mayor que cero.").max(9_999_999, "Monto muy alto."),
  tipo: z.enum(["adelanto", "saldo"]),
  medio: z.enum(["efectivo", "yape", "plin", "tarjeta", "transferencia"], { error: "Elige cómo pagó." }),
  operacion: z.string().trim().max(40, "Máximo 40 caracteres."),
});

export async function registrarPago(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) return { error: "Tu rol no registra pagos." };
  const r = esquema.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const supabase = await clienteServidor();
  const { error } = await supabase.from("pagos").insert({
    empresa_id: ctx.taller.id,
    orden_id: r.data.orden,
    monto: Math.round(r.data.monto * 100) / 100,
    tipo: r.data.tipo,
    medio: r.data.medio,
    numero_operacion: r.data.operacion || null,
  });
  if (error) return { error: "No se pudo registrar el pago." };
  revalidatePath("/", "layout");
  return { ok: `Pago de S/ ${r.data.monto.toFixed(2)} registrado.` };
}

export async function anularPago(id: string, motivo: string): Promise<Resultado> {
  await obtenerContexto();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("pagos").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo anular el pago." };
  revalidatePath("/", "layout");
  return { ok: "Pago anulado." };
}
