"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { montosLinea, redondear, sumarMontos } from "@/lib/dinero";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { configDinero } from "@/lib/taller/dinero-consultas";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string>; id?: string };

const linea = z.object({
  descripcion: z.string().trim().min(2, "Describe el repuesto.").max(200),
  cantidad: z.coerce.number().positive("Cantidad mayor que cero."),
  precio: z.coerce.number().min(0, "Precio no válido."),
  orden: z.string(),
  repuesto: z.string().default(""),
});

const esquema = z.object({
  proveedorId: z.string(),
  ruc: z.string().trim().regex(/^((10|15|17|20)\d{9})?$/, "El RUC tiene 11 números y empieza con 10, 15, 17 o 20."),
  razonSocial: z.string().trim().max(160),
  tipo: z.enum(["factura", "boleta", "nota_venta", "ticket", "sin_comprobante"]),
  serie: z.string().trim().toUpperCase().regex(/^([A-Z0-9]{1,4})?$/, "Serie como F001."),
  numero: z.string().trim().regex(/^(\d{1,8})?$/, "Solo números, hasta 8."),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Elige la fecha."),
  moneda: z.enum(["PEN", "USD"]),
  tipoCambio: z.coerce.number().positive("Escribe el tipo de cambio."),
  incluyeIgv: z.boolean(),
  origen: z.enum(["manual", "xml_sunat", "ia"]),
  lineas: z.array(linea).min(1, "Agrega al menos un repuesto."),
});

export async function registrarCompra(_previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"])) return { error: "Tu rol no registra compras." };
  let crudo: unknown;
  try {
    crudo = JSON.parse(String(form.get("datos") ?? ""));
  } catch {
    return { error: "No se pudieron leer los datos." };
  }
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[i.path.join(".")] ??= i.message;
    return { errores, error: "Revisa los campos marcados." };
  }
  const d = r.data;
  if (!d.proveedorId && d.razonSocial.length < 2) return { errores: { razonSocial: "Escribe el nombre del proveedor." } };
  if (d.tipo !== "sin_comprobante" && (!d.serie || !d.numero)) return { errores: { numero: "Escribe la serie y el número del comprobante." } };

  const { tasaIgv } = await configDinero(ctx.taller.id);
  // Solo la factura da crédito de IGV; en boleta, ticket o sin comprobante el costo es el total.
  const tasa = d.tipo === "factura" ? tasaIgv : 0;
  const items = d.lineas.map((l) => {
    const m = montosLinea({ cantidad: l.cantidad, precioUnitario: l.precio, incluyeIgv: d.incluyeIgv }, tasa);
    return {
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      precio_sin_igv: redondear(m.sinIgv / l.cantidad),
      sin_igv: m.sinIgv,
      igv: m.igv,
      total: m.total,
      orden: l.orden || null,
      repuesto: l.orden ? null : l.repuesto || null,
    };
  });
  const total = sumarMontos(items.map((i) => ({ sinIgv: i.sin_igv, igv: i.igv, total: i.total })));
  const supabase = await clienteServidor();
  const { data, error } = await supabase.rpc("registrar_compra", {
    p_empresa: ctx.taller.id,
    p_proveedor: { id: d.proveedorId || null, ruc: d.ruc || null, razon_social: d.razonSocial },
    p_compra: {
      tipo: d.tipo,
      serie: d.serie || null,
      numero: d.numero ? String(Number(d.numero)) : null,
      fecha: d.fecha,
      moneda: d.moneda,
      tipo_cambio: d.moneda === "USD" ? d.tipoCambio : 1,
      tasa_igv: tasa,
      sin_igv: total.sinIgv,
      igv: total.igv,
      total: total.total,
      origen: d.origen,
    },
    p_items: items,
  });
  if (error) {
    if (error.code === "23505") return { errores: { numero: "Esa compra ya está registrada (mismo proveedor, serie y número)." } };
    return { error: "No se pudo registrar la compra." };
  }
  revalidatePath("/", "layout");
  return { ok: d.origen === "ia" ? "Compra registrada: queda por confirmar." : "Compra registrada.", id: data as string };
}

export async function anularCompra(id: string, motivo: string): Promise<Resultado> {
  await obtenerContexto();
  if (motivo.trim().length < 5) return { error: "Escribe el motivo (mínimo 5 letras)." };
  const supabase = await clienteServidor();
  const { error, count } = await supabase.from("compras").update({ estado: "anulado", motivo_anulacion: motivo.trim() }, { count: "exact" }).eq("id", id);
  if (error || count !== 1) return { error: "No se pudo anular." };
  revalidatePath("/", "layout");
  return { ok: "Compra anulada." };
}

/** Entregar un repuesto del stock a una orden (o devolverlo al stock). */
export async function asignarItem(id: string, ordenId: string): Promise<Resultado> {
  await obtenerContexto();
  const supabase = await clienteServidor();
  const { error, count } = await supabase
    .from("compra_items")
    .update(ordenId ? { destino: "orden", orden_id: ordenId } : { destino: "stock", orden_id: null }, { count: "exact" })
    .eq("id", id);
  if (error || count !== 1) return { error: "No se pudo asignar." };
  revalidatePath("/", "layout");
  return { ok: ordenId ? "Repuesto entregado a la orden." : "Repuesto devuelto al stock." };
}
