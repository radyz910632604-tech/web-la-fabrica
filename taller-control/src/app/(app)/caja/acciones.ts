"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CATEGORIAS_GASTO } from "../gastos/categorias";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const soles = z.coerce.number({ error: "Escribe un monto." }).min(0, "No puede ser negativo.").max(9_999_999, "Monto muy alto.");

async function exigirCaja() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) throw new Error("Tu rol no maneja la caja.");
  return ctx;
}

export async function abrirCaja(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirCaja();
  const r = soles.safeParse(form.get("monto"));
  if (!r.success) return { errores: { monto: r.error.issues[0]?.message ?? "Monto no válido." } };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("cajas").insert({ empresa_id: ctx.taller.id, monto_inicial: Math.round(r.data * 100) / 100 });
  if (error) return { error: error.code === "23505" ? "Ya hay una caja abierta en este taller." : "No se pudo abrir la caja." };
  revalidatePath("/", "layout");
  return { ok: "Caja abierta." };
}

const esquemaMovimiento = z.object({
  caja: z.string().uuid(),
  tipo: z.enum(["ingreso", "egreso"]),
  concepto: z.string().trim().min(2, "Escribe para qué fue.").max(200),
  monto: z.coerce.number({ error: "Escribe el monto." }).positive("El monto debe ser mayor que cero.").max(9_999_999),
  medio: z.enum(["efectivo", "yape", "plin", "tarjeta", "transferencia"]),
  categoria_gasto: z.string().optional(),
});

/** Ingreso o gasto de caja que no es pago de una orden (sencillo, movilidad, retiro). */
export async function registrarMovimiento(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirCaja();
  const r = esquemaMovimiento.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  // Una salida de caja dice si es gasto del taller (con su categoría) o un retiro.
  const categoria = r.data.tipo === "egreso" ? r.data.categoria_gasto ?? "" : "";
  if (r.data.tipo === "egreso" && !categoria) return { errores: { categoria_gasto: "Elige si es un gasto o un retiro." } };
  if (categoria && categoria !== "retiro" && !(categoria in CATEGORIAS_GASTO)) return { errores: { categoria_gasto: "Categoría no válida." } };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("movimientos_caja").insert({
    empresa_id: ctx.taller.id,
    caja_id: r.data.caja,
    tipo: r.data.tipo,
    concepto: r.data.concepto,
    monto: Math.round(r.data.monto * 100) / 100,
    medio: r.data.medio,
    categoria_gasto: categoria && categoria !== "retiro" ? categoria : null,
  });
  if (error) return { error: error.message.includes("cerrada") ? "La caja ya está cerrada." : "No se pudo registrar." };
  revalidatePath("/caja");
  revalidatePath("/gastos");
  return { ok: r.data.tipo === "ingreso" ? "Ingreso registrado." : categoria === "retiro" ? "Retiro registrado." : "Gasto registrado: también quedó en Gastos del taller." };
}

export async function anularMovimiento(id: string, motivo: string): Promise<Resultado> {
  await exigirCaja();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("movimientos_caja").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo anular." };
  revalidatePath("/caja");
  return { ok: "Movimiento anulado." };
}

/** Cierra la caja: la base calcula el efectivo esperado y guarda la diferencia. */
export async function cerrarCaja(_previo: Resultado, form: FormData): Promise<Resultado> {
  await exigirCaja();
  const caja = z.string().uuid().safeParse(form.get("caja"));
  const contado = soles.safeParse(form.get("contado"));
  if (!caja.success) return { error: "No se encontró la caja." };
  if (!contado.success) return { errores: { contado: "Escribe cuánto efectivo contaste." } };
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("cerrar_caja", {
    p_caja: caja.data,
    p_contado: Math.round(contado.data * 100) / 100,
    p_observaciones: String(form.get("observaciones") ?? "").slice(0, 1000),
  });
  if (error) return { error: error.message.includes("cerrada") ? "Esta caja ya está cerrada." : "No se pudo cerrar la caja." };
  revalidatePath("/", "layout");
  const d = Number((data as { diferencia: number }).diferencia);
  return { ok: d === 0 ? "Caja cerrada. Cuadró exacto." : d > 0 ? `Caja cerrada. Sobran S/ ${d.toFixed(2)}.` : `Caja cerrada. Faltan S/ ${Math.abs(d).toFixed(2)}.` };
}
