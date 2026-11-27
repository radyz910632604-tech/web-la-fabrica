"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CATEGORIAS_GASTO } from "../gastos/categorias";
import { CAJA, esGestor, tieneAlguno, type Rol } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string> };

const soles = z.coerce.number({ error: "Escribe un monto." }).min(0, "No puede ser negativo.").max(9_999_999, "Monto muy alto.");

/** Quién maneja cada caja: Recepción (los de caja) y Almacén (almacén); gerencia y administración, ambas. */
const MANEJA: Record<"recepcion" | "almacen", readonly Rol[]> = { recepcion: CAJA, almacen: ["gerencia", "administrador", "almacen"] };

async function exigirCaja() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, [...CAJA, "almacen"])) throw new Error("Tu rol no maneja la caja.");
  return ctx;
}

export async function abrirCaja(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirCaja();
  const area = form.get("area") === "almacen" ? "almacen" : "recepcion";
  if (!tieneAlguno(ctx.roles, MANEJA[area])) return { error: "Tu rol no maneja esta caja." };
  const r = soles.safeParse(form.get("monto"));
  if (!r.success) return { errores: { monto: r.error.issues[0]?.message ?? "Monto no válido." } };
  const supabase = await clienteServidor();
  const { error } = await supabase.from("cajas").insert({ empresa_id: ctx.taller.id, tipo_caja: area, monto_inicial: Math.round(r.data * 100) / 100 });
  if (error) return { error: error.code === "23505" ? `Ya hay una caja de ${area === "almacen" ? "Almacén" : "Recepción"} abierta.` : "No se pudo abrir la caja." };
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
  tipo_comprobante: z.enum(["factura", "boleta", "recibo", "otro", "sin_comprobante"]).optional(),
  numero_comprobante: z.string().trim().max(40, "Máximo 40 caracteres.").optional(),
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
  if (r.data.tipo === "egreso" && !categoria) return { errores: { categoria_gasto: "Toca en qué fue (o «Retiro» si no es gasto)." } };
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
    // El comprobante del gasto pasa a Gastos; sin número queda «pendiente» para completarlo después.
    tipo_comprobante: categoria && categoria !== "retiro" ? (r.data.tipo_comprobante ?? "sin_comprobante") : null,
    numero_comprobante: categoria && categoria !== "retiro" ? r.data.numero_comprobante || null : null,
  });
  if (error) return { error: error.message.includes("cerrada") ? "La caja ya está cerrada." : "No se pudo registrar." };
  revalidatePath("/caja");
  revalidatePath("/gastos");
  const pendiente = categoria && categoria !== "retiro" && ["factura", "boleta", "recibo"].includes(r.data.tipo_comprobante ?? "") && !r.data.numero_comprobante;
  return {
    ok:
      r.data.tipo === "ingreso"
        ? "Ingreso registrado."
        : categoria === "retiro"
          ? "Retiro registrado."
          : pendiente
            ? "Gasto registrado con el comprobante pendiente: complétalo en Gastos del taller."
            : "Gasto registrado: también quedó en Gastos del taller.",
  };
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

/** Arqueo de una caja que se cerró sola a las 00:00: el dueño o administración cuentan el efectivo. */
export async function registrarArqueo(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) return { error: "El arqueo lo registran gerencia o administración." };
  const caja = z.string().uuid().safeParse(form.get("caja"));
  const contado = soles.safeParse(form.get("contado"));
  if (!caja.success) return { error: "No se encontró la caja." };
  if (!contado.success) return { errores: { contado: "Escribe cuánto efectivo se contó." } };
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("registrar_arqueo", {
    p_caja: caja.data,
    p_contado: Math.round(contado.data * 100) / 100,
    p_observaciones: String(form.get("observaciones") ?? "").slice(0, 300),
  });
  if (error) return { error: error.code === "23514" || error.code === "42501" ? error.message : "No se pudo registrar el arqueo." };
  revalidatePath("/caja", "layout");
  const d = Number((data as { diferencia: number }).diferencia);
  return { ok: d === 0 ? "Arqueo registrado: cuadró exacto." : d > 0 ? `Arqueo registrado: sobran S/ ${d.toFixed(2)}.` : `Arqueo registrado: faltan S/ ${Math.abs(d).toFixed(2)}.` };
}

const esquemaFondo = z.object({
  tipo: z.enum(["asignacion", "devolucion"]),
  origen: z.enum(["recepcion", "externo"]),
  monto: z.coerce.number({ error: "Escribe el monto." }).positive("El monto debe ser mayor que cero.").max(9_999_999),
  entrega: z.string().uuid("Elige quién entrega."),
  recibe: z.string().uuid("Elige quién recibe."),
  nota: z.string().trim().max(120).optional(),
});

/**
 * Dinero para Almacén (o su vuelto): es un traspaso de efectivo entre cajas, no un gasto.
 * El gasto se registra cuando Almacén compra, con su comprobante.
 */
export async function moverFondo(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await exigirCaja();
  const r = esquemaFondo.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("mover_fondo_almacen", {
    p_empresa: ctx.taller.id,
    p_tipo: r.data.tipo,
    p_monto: Math.round(r.data.monto * 100) / 100,
    p_origen: r.data.origen,
    p_entregado_por: r.data.entrega,
    p_recibido_por: r.data.recibe,
    p_nota: r.data.nota ?? "",
  });
  if (error) return { error: error.code === "23514" || error.code === "42501" ? error.message : "No se pudo registrar." };
  revalidatePath("/caja", "layout");
  return {
    ok:
      r.data.tipo === "asignacion"
        ? `Fondo de S/ ${r.data.monto.toFixed(2)} entregado a Almacén. No es gasto: lo será lo que compre.`
        : `Vuelto de S/ ${r.data.monto.toFixed(2)} devuelto por Almacén.`,
  };
}
