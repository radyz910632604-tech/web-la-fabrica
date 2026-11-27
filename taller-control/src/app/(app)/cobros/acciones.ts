"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cuentasDeOrdenes } from "@/lib/taller/dinero-consultas";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const esquema = z.object({
  orden: z.string().uuid("Elige la orden."),
  monto: z.coerce.number({ error: "Escribe el monto." }).positive("El monto debe ser mayor que cero.").max(9_999_999, "Monto muy alto."),
  tipo: z.enum(["adelanto", "abono", "saldo", "devolucion"]),
  medio: z.enum(["efectivo", "yape", "plin", "tarjeta", "transferencia"], { error: "Elige cómo pagó." }),
  operacion: z.string().trim().max(40, "Máximo 40 caracteres."),
});

export async function registrarPago(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no registra pagos." };
  const r = esquema.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const supabase = await clienteServidor();
  if (r.data.tipo === "devolucion") {
    // Solo se devuelve lo que el cliente tiene a favor (pagó de más o hubo nota de crédito).
    const { data: o } = await supabase.from("ordenes_trabajo").select("id, numero, estado").eq("id", r.data.orden).maybeSingle();
    const [c] = o ? await cuentasDeOrdenes(ctx.taller.id, [{ id: o.id, numero: o.numero, placa: "", cliente: null, estado: o.estado }]) : [];
    const aFavor = c ? Math.max(-c.saldo, 0) : 0;
    if (r.data.monto > aFavor + 0.009) {
      return { errores: { monto: aFavor > 0 ? `El cliente tiene S/ ${aFavor.toFixed(2)} a favor: no se puede devolver más.` : "Este cliente no tiene saldo a favor para devolver." } };
    }
  }
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
  return { ok: r.data.tipo === "devolucion" ? `Devolución de S/ ${r.data.monto.toFixed(2)} registrada.` : `Pago de S/ ${r.data.monto.toFixed(2)} registrado.` };
}

export async function anularPago(id: string, motivo: string): Promise<Resultado> {
  await obtenerContexto();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("pagos").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error?.message.includes("caja ya cerrada")) return { error: "Este pago es de una caja ya cerrada: registra una devolución en la caja de hoy." };
  if (error || count !== 1) return { error: "No se pudo anular el pago." };
  revalidatePath("/", "layout");
  return { ok: "Pago anulado." };
}

/** Confirmar un pago que llegó por WhatsApp, después de ver que el dinero llegó. */
export async function confirmarPago(id: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no confirma pagos." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("pagos").update({ estado: "confirmado" }, { count: "exact" }).eq("id", id).eq("estado", "por_confirmar");
  if (error) return { error: error.code === "23514" && !/violates/.test(error.message) ? error.message : "No se pudo confirmar." };
  if (count !== 1) return { error: "Ese pago ya no está por confirmar." };
  revalidatePath("/", "layout");
  return { ok: "Pago confirmado." };
}

const esquemaCobro = z.object({
  orden: z.string().uuid(),
  cobro: z.string().uuid(),
  lineas: z
    .array(
      z.object({
        medio: z.enum(["efectivo", "yape", "plin", "tarjeta", "transferencia"], { error: "Elige cómo pagó." }),
        monto: z.coerce.number({ error: "Escribe el monto." }).positive("Cada monto debe ser mayor que cero.").max(9_999_999, "Monto muy alto."),
        operacion: z.string().trim().max(40, "Máximo 40 caracteres."),
      }),
    )
    .min(1, "Agrega al menos un monto.")
    .max(6, "Máximo 6 medios en un cobro."),
});

export type ResultadoCobro = Resultado & { saldo?: number; repetido?: boolean };

/**
 * Cobro de una orden en uno o varios medios (pago mixto). La base lo hace todo o nada,
 * calcula el saldo y no deja duplicarlo (el código `cobro` lo crea la pantalla una vez).
 */
export async function registrarCobro(datos: unknown): Promise<ResultadoCobro> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no registra pagos." };
  const r = esquemaCobro.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los montos." };
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("registrar_cobro", {
    p_orden: r.data.orden,
    p_cobro: r.data.cobro,
    p_lineas: r.data.lineas.map((l) => ({ medio: l.medio, monto: Math.round(l.monto * 100) / 100, operacion: l.operacion || null })),
  });
  if (error) return { error: ["23514", "22023", "42501"].includes(error.code ?? "") ? error.message : "No se pudo registrar el cobro. Intenta otra vez." };
  const res = data as { repetido: boolean; saldo: number; cobrado?: number };
  revalidatePath("/", "layout");
  if (res.repetido) return { ok: "Este cobro ya estaba registrado: no se repitió.", saldo: Number(res.saldo), repetido: true };
  const saldo = Number(res.saldo);
  return { ok: saldo > 0.009 ? `Cobro registrado. Queda un saldo de S/ ${saldo.toFixed(2)}.` : "Cobro registrado. La orden quedó pagada.", saldo };
}
