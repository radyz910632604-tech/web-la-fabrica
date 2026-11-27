"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { comisiones as calcular, redondear, type ReglaComision } from "@/lib/dinero";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { ordenesParaComision } from "@/lib/taller/comisiones";

export type Resultado = { ok?: string; error?: string };

/** Todo aquí es solo para gerencia y administración (la base también lo exige). */
async function gestor() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) throw new Error("Solo gerencia o administración manejan comisiones.");
  return ctx;
}

const mesValido = z.string().regex(/^\d{4}-\d{2}$/);
const fin = (ruta = "/comisiones") => revalidatePath(ruta);
const mensaje = (e: { code?: string; message: string }, otro: string) => (e.code === "23514" || e.code === "42501" ? e.message : e.code === "23505" ? "Esa orden ya tiene su comisión." : otro);

/**
 * Calcula las comisiones del mes según las reglas activas de «orden entregada y cobrada»:
 * una por orden y asesor. Las que ya existen no se repiten (lo asegura la base).
 */
export async function calcularDelMes(mes: string): Promise<Resultado> {
  const ctx = await gestor();
  if (!mesValido.safeParse(mes).success) return { error: "Mes no válido." };
  const supabase = await clienteServidor();
  const { data: reglas } = await supabase
    .from("reglas_comision")
    .select("id, nombre, evento, tipo_monto, valor")
    .eq("empresa_id", ctx.taller.id)
    .eq("activa", true)
    .eq("evento", "trabajo_entregado");
  if (!reglas?.length) return { error: "No hay reglas activas de comisión para el asesor. Créalas en Configuración → Comisiones." };
  const ordenes = await ordenesParaComision(ctx.taller.id, mes);
  if (!ordenes.length) return { ok: "No hay órdenes entregadas y cobradas con asesor en este mes." };

  let nuevas = 0;
  for (const o of ordenes) {
    for (const r of reglas) {
      const regla: ReglaComision = { id: r.id, nombre: r.nombre, evento: "trabajo_entregado", tipoMonto: r.tipo_monto, valor: Number(r.valor) };
      const monto = calcular([regla], [{ evento: "trabajo_entregado", personaId: o.asesorId, ventaSinIgv: o.ventaSinIgv }]).get(o.asesorId)?.total ?? 0;
      if (monto <= 0) continue;
      const { error } = await supabase.from("comisiones").insert({
        empresa_id: ctx.taller.id,
        perfil_id: o.asesorId,
        orden_id: o.ordenId,
        regla_id: r.id,
        periodo: `${mes}-01`,
        concepto: r.nombre.slice(0, 160),
        base: o.ventaSinIgv,
        monto: redondear(monto),
      });
      if (!error) nuevas++;
      else if (error.code !== "23505" && error.code !== "23514") return { error: "No se pudieron guardar todas las comisiones." };
    }
  }
  fin();
  return { ok: nuevas ? `${nuevas} ${nuevas === 1 ? "comisión nueva" : "comisiones nuevas"}, pendientes de aprobar.` : "Ya estaban todas calculadas." };
}

const nueva = z.object({
  asesorId: z.string().uuid("Elige al asesor."),
  concepto: z.string().trim().min(3, "Escribe el concepto.").max(160),
  monto: z.coerce.number().positive("Monto mayor que cero.").max(100000),
  mes: mesValido,
});

/** Comisión o bono puesto a mano (por ejemplo, un bono por meta). */
export async function crearComision(datos: unknown): Promise<Resultado> {
  const ctx = await gestor();
  const r = nueva.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos." };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("comisiones").insert({
    empresa_id: ctx.taller.id,
    perfil_id: r.data.asesorId,
    periodo: `${r.data.mes}-01`,
    concepto: r.data.concepto,
    monto: redondear(r.data.monto),
  });
  if (error) return { error: mensaje(error, "No se pudo guardar la comisión.") };
  fin();
  return { ok: "Comisión agregada, pendiente de aprobar." };
}

/** Cambiar monto o concepto (solo mientras está pendiente). */
export async function modificarComision(id: string, datos: unknown): Promise<Resultado> {
  await gestor();
  const r = z.object({ concepto: z.string().trim().min(3).max(160), monto: z.coerce.number().positive("Monto mayor que cero.").max(100000) }).safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("comisiones").update({ concepto: r.data.concepto, monto: redondear(r.data.monto) }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: error ? mensaje(error, "No se pudo modificar.") : "No se encontró la comisión." };
  fin();
  return { ok: "Comisión modificada." };
}

/** Aprobar, volver a pendiente o pagar (al pagar se crea su único gasto). */
export async function cambiarEstadoComision(id: string, estado: "aprobada" | "pendiente" | "pagada", medio?: string): Promise<Resultado> {
  await gestor();
  const supabase = await clienteServidor();
  const cambios: Record<string, unknown> = { estado };
  if (estado === "pagada") {
    if (!["efectivo", "yape", "plin", "tarjeta", "transferencia"].includes(medio ?? "")) return { error: "Elige cómo se pagó." };
    cambios.medio = medio;
  }
  const { error, count } = await supabase.from("comisiones").update(cambios, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: error ? mensaje(error, "No se pudo guardar.") : "No se encontró la comisión." };
  fin();
  fin("/gastos");
  return { ok: estado === "pagada" ? "Pagada. Ya figura en Gastos (una sola vez)." : estado === "aprobada" ? "Aprobada." : "Volvió a pendiente." };
}

/** Eliminar: una pendiente se borra; una aprobada o pagada se anula con motivo (y su gasto también). */
export async function eliminarComision(id: string, estado: string, motivo: string): Promise<Resultado> {
  await gestor();
  const supabase = await clienteServidor();
  if (estado === "pendiente") {
    const { error, count } = await supabase.from("comisiones").delete({ count: "exact" }).eq("id", id);
    if (error || count !== 1) return { error: "No se pudo eliminar." };
    fin();
    return { ok: "Comisión eliminada." };
  }
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const { error, count } = await supabase.from("comisiones").update({ estado: "anulada", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: error ? mensaje(error, "No se pudo anular.") : "No se encontró la comisión." };
  fin();
  fin("/gastos");
  return { ok: estado === "pagada" ? "Anulada; su gasto también quedó anulado." : "Comisión anulada." };
}

/** Aprobar de una vez todas las pendientes del mes (después de revisarlas). */
export async function aprobarTodas(mes: string): Promise<Resultado> {
  const ctx = await gestor();
  if (!mesValido.safeParse(mes).success) return { error: "Mes no válido." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("comisiones")
    .update({ estado: "aprobada" }, { count: "exact" })
    .eq("empresa_id", ctx.taller.id)
    .eq("periodo", `${mes}-01`)
    .eq("estado", "pendiente");
  if (error) return { error: mensaje(error, "No se pudieron aprobar.") };
  fin();
  return { ok: count ? `${count} ${count === 1 ? "comisión aprobada" : "comisiones aprobadas"}.` : "No había pendientes." };
}
