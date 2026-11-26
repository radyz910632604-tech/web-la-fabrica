"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CATEGORIAS_GASTO } from "./categorias";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const esquema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha."),
  categoria: z.enum(Object.keys(CATEGORIAS_GASTO) as [keyof typeof CATEGORIAS_GASTO, ...(keyof typeof CATEGORIAS_GASTO)[]], { error: "Elige la categoría." }),
  descripcion: z.string().trim().min(2, "Escribe qué se pagó.").max(200, "Máximo 200 caracteres."),
  monto: z.coerce.number({ error: "Escribe el monto." }).positive("El monto debe ser mayor que cero.").max(10_000_000, "Revisa el monto."),
  medio: z.enum(["", "efectivo", "yape", "plin", "tarjeta", "transferencia"]).transform((v) => v || null),
  tipo_comprobante: z.enum(["factura", "boleta", "recibo", "otro", "sin_comprobante"]).default("sin_comprobante"),
  comprobante: z.string().trim().max(40, "Máximo 40 caracteres.").transform((v) => v || null),
});

/** Registra un gasto del taller (gerencia y administración). */
export async function registrarGasto(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) return { error: "Solo gerencia o administración registran gastos." };
  const datos = esquema.safeParse(Object.fromEntries(form));
  if (!datos.success) {
    const errores: Record<string, string> = {};
    for (const p of datos.error.issues) errores[String(p.path[0])] ??= p.message;
    return { errores };
  }
  const supabase = await clienteServidor();
  const { error } = await supabase.from("gastos").insert({ empresa_id: ctx.taller.id, ...datos.data, monto: Math.round(datos.data.monto * 100) / 100 });
  if (error) return { error: "No se pudo guardar el gasto." };
  revalidatePath("/gastos");
  revalidatePath("/reportes");
  const pendiente = ["factura", "boleta", "recibo"].includes(datos.data.tipo_comprobante) && !datos.data.comprobante;
  return { ok: pendiente ? "Gasto registrado. El comprobante quedó pendiente: complétalo cuando lo tengas." : "Gasto registrado." };
}

export async function anularGasto(id: string, motivo: string): Promise<Resultado> {
  await obtenerContexto();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("gastos").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo anular." };
  revalidatePath("/gastos");
  revalidatePath("/reportes");
  return { ok: "Gasto anulado." };
}

/** Completar el número de un comprobante pendiente (lo único que se puede cambiar de un gasto confirmado). */
export async function completarComprobante(id: string, numero: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) return { error: "Solo gerencia o administración." };
  const limpio = numero.trim().slice(0, 40);
  if (limpio.length < 2) return { error: "Escribe el número del comprobante." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("gastos").update({ comprobante: limpio }, { count: "exact" }).eq("id", id).eq("comprobante_pendiente", true);
  if (error || count !== 1) return { error: "No se pudo guardar el número." };
  revalidatePath("/gastos");
  return { ok: "Comprobante completado." };
}
