"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desdeTotal } from "@/lib/dinero";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { configDinero } from "@/lib/taller/dinero-consultas";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const esquema = z.object({
  tipo: z.enum(["boleta", "factura"]),
  serie: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, "Serie como B001 o F001."),
  numero: z.string().trim().regex(/^\d{1,8}$/, "Solo números, hasta 8."),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha."),
  total: z.coerce.number({ error: "Escribe el total." }).positive("El total debe ser mayor que cero."),
  sin_igv: z.string(),
  igv: z.string(),
  orden: z.string(),
  documento: z.string().trim().max(15),
  detalle: z.string().trim().max(2000),
  origen: z.enum(["manual", "xml_sunat", "ia"]),
  archivo: z.string().max(300).optional(),
  sin_igv_operacion: z.string().optional(),
});

export async function registrarComprobante(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no registra comprobantes." };
  const r = esquema.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const d = r.data;
  const config = await configDinero(ctx.taller.id);
  // Operación sin IGV (exonerada o inafecta): todo el total es valor de venta.
  const tasaIgv = d.sin_igv_operacion === "1" ? 0 : config.tasaIgv;
  // Del XML se guardan los montos tal cual; a mano, se desglosa el total.
  const montos =
    d.origen !== "manual" && d.sin_igv && d.igv && Math.abs(Number(d.sin_igv) + Number(d.igv) - d.total) <= 0.05
      ? { sinIgv: Number(d.sin_igv), igv: Number(d.igv), total: d.total }
      : desdeTotal(d.total, tasaIgv);
  const supabase = await clienteServidor();
  const { error } = await supabase.from("comprobantes_venta").insert({
    empresa_id: ctx.taller.id,
    orden_id: d.orden || null,
    tipo: d.tipo,
    serie: d.serie,
    numero: String(Number(d.numero)),
    fecha_emision: d.fecha,
    documento_cliente: d.documento || null,
    tasa_igv: tasaIgv,
    subtotal_sin_igv: montos.sinIgv,
    igv: montos.igv,
    total: montos.total,
    detalle: d.detalle || null,
    origen_datos: d.origen,
    archivo_path: d.origen === "ia" && d.archivo?.startsWith(`${ctx.taller.id}/ventas/`) ? d.archivo : null,
  });
  if (error) {
    if (error.code === "23505") return { errores: { numero: `La ${d.tipo} ${d.serie}-${Number(d.numero)} ya está registrada.` } };
    return { error: "No se pudo registrar el comprobante." };
  }
  revalidatePath("/", "layout");
  return { ok: `${d.tipo === "boleta" ? "Boleta" : "Factura"} ${d.serie}-${Number(d.numero)} registrada${d.origen === "ia" ? ": queda por confirmar" : ""}.` };
}

export async function asignarOrdenComprobante(id: string, ordenId: string): Promise<Resultado> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("comprobantes_venta").update({ orden_id: ordenId || null }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo asignar." };
  revalidatePath("/", "layout");
  return { ok: "Comprobante asignado." };
}

export async function anularComprobante(id: string, motivo: string): Promise<Resultado> {
  await obtenerContexto();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("comprobantes_venta").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo anular." };
  revalidatePath("/", "layout");
  return { ok: "Comprobante anulado." };
}

const esquemaNota = z.object({
  comprobante: z.string().uuid(),
  serie: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,4}$/, "Serie como BC01 o FC01."),
  numero: z.string().trim().regex(/^\d{1,8}$/, "Solo números, hasta 8."),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha."),
  motivo_codigo: z.enum(["01", "02", "03", "04", "05", "06", "07", "09", "10", "13"]),
  motivo: z.string().trim().max(300),
  total: z.coerce.number({ error: "Escribe el monto." }).positive("El monto debe ser mayor que cero."),
  sin_igv: z.string(),
  igv: z.string(),
  origen: z.enum(["manual", "xml_sunat"]),
});

/** Nota de crédito: rebaja una boleta o factura (descuento, devolución, anulación). */
export async function registrarNotaCredito(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no registra notas de crédito." };
  const r = esquemaNota.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const d = r.data;
  const supabase = await clienteServidor();
  const { data: comp } = await supabase.from("comprobantes_venta").select("tasa_igv").eq("id", d.comprobante).maybeSingle();
  if (!comp) return { error: "No se encontró el comprobante." };
  const tasa = Number(comp.tasa_igv);
  const montos =
    d.origen === "xml_sunat" && d.sin_igv && d.igv ? { sinIgv: Number(d.sin_igv), igv: Number(d.igv), total: d.total } : desdeTotal(d.total, tasa);
  const { error } = await supabase.from("notas_credito").insert({
    empresa_id: ctx.taller.id,
    comprobante_id: d.comprobante,
    serie: d.serie,
    numero: String(Number(d.numero)),
    fecha_emision: d.fecha,
    motivo_codigo: d.motivo_codigo,
    motivo: d.motivo || null,
    tasa_igv: tasa,
    subtotal_sin_igv: montos.sinIgv,
    igv: montos.igv,
    total: montos.total,
    origen_datos: d.origen,
  });
  if (error) {
    if (error.code === "23505") return { errores: { numero: `La nota ${d.serie}-${Number(d.numero)} ya está registrada.` } };
    if (error.message.includes("no puede ser mayor")) return { errores: { total: error.message } };
    return { error: "No se pudo registrar la nota de crédito." };
  }
  revalidatePath("/", "layout");
  return { ok: `Nota de crédito ${d.serie}-${Number(d.numero)} registrada.` };
}

export async function anularNotaCredito(id: string, motivo: string): Promise<Resultado> {
  await obtenerContexto();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("notas_credito").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo anular." };
  revalidatePath("/", "layout");
  return { ok: "Nota de crédito anulada." };
}

/** Confirmar los montos de un comprobante leído por IA, después de revisarlo. */
export async function confirmarComprobante(id: string): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no confirma comprobantes." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("comprobantes_venta").update({ estado: "confirmado" }, { count: "exact" }).eq("id", id).eq("estado", "por_confirmar");
  if (error || count !== 1) return { error: "No se pudo confirmar." };
  revalidatePath("/", "layout");
  return { ok: "Comprobante confirmado." };
}
