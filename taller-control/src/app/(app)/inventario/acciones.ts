"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { desdeTotal } from "@/lib/dinero";
import { codigoValido, normalizarCodigo, UNIDADES } from "@/lib/inventario";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { configDinero } from "@/lib/taller/dinero-consultas";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string>; id?: string };

/** Los avisos de la base (stock insuficiente) vienen en español; los técnicos, no. */
function mensajeBase(e: { code?: string; message: string }, otro: string): string {
  return e.code === "23514" && !/violates|constraint/i.test(e.message) ? e.message : otro;
}

const MUEVEN = ["gerencia", "administrador", "almacen"] as const;

async function contextoQueMueve() {
  const ctx = await obtenerContexto();
  return tieneAlguno(ctx.roles, MUEVEN) ? ctx : null;
}

const esquemaRepuesto = z.object({
  codigo: z.string().transform(normalizarCodigo).refine(codigoValido, "Código con letras y números, por ejemplo FIL-ACE-01."),
  nombre: z.string().trim().min(2, "Escribe el nombre del repuesto.").max(160),
  marca: z.string().trim().max(60),
  unidad: z.enum(Object.keys(UNIDADES) as [string, ...string[]]),
  minimo: z.coerce.number().min(0, "El mínimo no puede ser negativo."),
  precio: z.union([z.literal(""), z.coerce.number().min(0, "Precio no válido.")]),
});

function errores(e: z.ZodError): Resultado {
  const r: Record<string, string> = {};
  for (const i of e.issues) r[i.path.join(".")] ??= i.message;
  return { errores: r, error: "Revisa los campos marcados." };
}

function leer(form: FormData) {
  return {
    codigo: String(form.get("codigo") ?? ""),
    nombre: String(form.get("nombre") ?? ""),
    marca: String(form.get("marca") ?? ""),
    unidad: String(form.get("unidad") ?? "unidad"),
    minimo: String(form.get("minimo") ?? "0") || "0",
    precio: String(form.get("precio") ?? ""),
  };
}

/** El precio se escribe con IGV (como se cobra) y se guarda sin IGV. */
async function precioSinIgv(empresaId: string, precio: number | "") {
  if (precio === "") return null;
  const { tasaIgv } = await configDinero(empresaId);
  return desdeTotal(precio, tasaIgv).sinIgv;
}

export async function crearRepuesto(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await contextoQueMueve();
  if (!ctx) return { error: "Tu rol no maneja el inventario." };
  const r = esquemaRepuesto.safeParse(leer(form));
  if (!r.success) return errores(r.error);
  const d = r.data;
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from("repuestos")
    .insert({
      empresa_id: ctx.taller.id, codigo: d.codigo, nombre: d.nombre, marca: d.marca || null, unidad: d.unidad,
      stock_minimo: d.minimo, precio_venta_sin_igv: await precioSinIgv(ctx.taller.id, d.precio),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { errores: { codigo: "Ya hay un repuesto con ese código." } };
    return { error: "No se pudo crear el repuesto." };
  }
  revalidatePath("/inventario");
  return { ok: "Repuesto creado.", id: data.id };
}

export async function editarRepuesto(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await contextoQueMueve();
  if (!ctx) return { error: "Tu rol no maneja el inventario." };
  const id = String(form.get("id") ?? "");
  const r = esquemaRepuesto.safeParse(leer(form));
  if (!r.success) return errores(r.error);
  const d = r.data;
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("repuestos")
    .update(
      { codigo: d.codigo, nombre: d.nombre, marca: d.marca || null, unidad: d.unidad, stock_minimo: d.minimo, precio_venta_sin_igv: await precioSinIgv(ctx.taller.id, d.precio), activo: form.get("activo") !== "no" },
      { count: "exact" },
    )
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id);
  if (error) {
    if (error.code === "23505") return { errores: { codigo: "Ya hay un repuesto con ese código." } };
    return { error: "No se pudo guardar." };
  }
  if (count !== 1) return { error: "No se encontró el repuesto." };
  revalidatePath("/inventario", "layout");
  return { ok: "Cambios guardados." };
}

const esquemaMovimiento = z.object({
  repuesto: z.string().uuid(),
  tipo: z.enum(["salida", "ajuste", "entrada"]),
  cantidad: z.coerce.number().positive("Escribe una cantidad mayor que cero.").max(100000),
  sentido: z.enum(["suma", "resta"]),
  orden: z.string(),
  costo: z.union([z.literal(""), z.coerce.number().min(0)]),
  nota: z.string().trim().max(300),
});

/**
 * Salida a una orden, ajuste (conteo, merma, uso interno) o entrada sin compra
 * (devolución del cliente, saldo inicial). La base valida el stock.
 */
export async function registrarMovimiento(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await contextoQueMueve();
  if (!ctx) return { error: "Tu rol no maneja el inventario." };
  const r = esquemaMovimiento.safeParse({
    repuesto: form.get("repuesto"),
    tipo: form.get("tipo"),
    cantidad: form.get("cantidad"),
    sentido: form.get("sentido") ?? "resta",
    orden: String(form.get("orden") ?? ""),
    costo: String(form.get("costo") ?? ""),
    nota: String(form.get("nota") ?? ""),
  });
  if (!r.success) return errores(r.error);
  const d = r.data;
  if (d.tipo === "salida" && !d.orden) return { errores: { orden: "Elige la orden." } };
  if (d.tipo !== "salida" && d.nota.length < 5) return { errores: { nota: "Escribe el motivo (mínimo 5 letras)." } };
  const signo = d.tipo === "salida" || (d.tipo === "ajuste" && d.sentido === "resta") ? -1 : 1;
  const supabase = await clienteServidor();
  const { error } = await supabase.from("movimientos_inventario").insert({
    empresa_id: ctx.taller.id,
    repuesto_id: d.repuesto,
    // Una entrada sin compra se guarda como ajuste a favor (con su motivo).
    tipo: d.tipo === "entrada" ? "ajuste" : d.tipo,
    cantidad: signo * d.cantidad,
    costo_unitario_sin_igv: signo > 0 && d.costo !== "" ? d.costo : 0,
    orden_id: d.tipo === "salida" ? d.orden : null,
    nota: d.nota || null,
  });
  if (error) return { error: mensajeBase(error, "No se pudo registrar el movimiento.") };
  revalidatePath("/", "layout");
  return { ok: d.tipo === "salida" ? "Repuesto entregado a la orden." : "Movimiento registrado." };
}

export async function anularMovimiento(id: string, motivo: string): Promise<Resultado> {
  const ctx = await contextoQueMueve();
  if (!ctx) return { error: "Tu rol no maneja el inventario." };
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("movimientos_inventario")
    .update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" })
    .eq("id", id)
    .is("compra_item_id", null);
  if (error) return { error: mensajeBase(error, "No se pudo anular.") };
  if (count !== 1) return { error: "Las entradas por compra se anulan anulando la compra." };
  revalidatePath("/", "layout");
  return { ok: "Movimiento anulado." };
}
