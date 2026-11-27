"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizarCelular } from "@/lib/celulares";
import { normalizarPlaca } from "@/lib/placas";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { lineasConIgv } from "@/lib/taller/cotizacion";
import { configDinero } from "@/lib/taller/dinero-consultas";

export type ResultadoCotizacion = { ok?: string; error?: string; id?: string };

const esquema = z.object({
  id: z.string().uuid().nullable(),
  ordenId: z.string().uuid().nullable(),
  cliente: z.object({
    nombre: z.string().trim().max(120).default(""),
    celular: z.string().trim().max(20).default(""),
    documento: z.string().trim().max(15).default(""),
    placa: z.string().trim().max(10).default(""),
    vehiculo: z.string().trim().max(80).default(""),
  }),
  lineas: z
    .array(
      z.object({
        tipo: z.enum(["servicio", "repuesto"]),
        descripcion: z.string().trim().min(2, "Describe cada línea.").max(200),
        cantidad: z.coerce.number().positive("Cantidad mayor que cero."),
        precio: z.coerce.number().min(0, "Precio no válido."),
      }),
    )
    .min(1, "Agrega al menos un producto o servicio."),
  conIgv: z.boolean(),
  preciosConIgv: z.boolean(),
  adicional: z.boolean().default(false),
  descuento: z
    .object({ tipo: z.enum(["monto", "porcentaje"]), valor: z.coerce.number().min(0), motivo: z.string().trim().max(200) })
    .nullable(),
});

/** Guarda una cotización nueva o editada (de una orden o suelta), con su IGV y su descuento. */
export async function guardarCotizacion(datos: unknown): Promise<ResultadoCotizacion> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no maneja cotizaciones." };
  const r = esquema.safeParse(datos);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "Revisa los datos." };
  const d = r.data;
  if (!d.ordenId && !d.id && d.cliente.nombre.length < 2) return { error: "Escribe el nombre del cliente." };
  if (d.descuento && d.descuento.valor > 0 && d.descuento.motivo.length < 3) return { error: "Escribe el motivo del descuento." };
  if (d.descuento?.tipo === "porcentaje" && d.descuento.valor > 100) return { error: "El descuento en % va de 0 a 100." };
  const celular = d.cliente.celular ? normalizarCelular(d.cliente.celular) : null;
  if (d.cliente.celular && !celular) return { error: "Celular de 9 dígitos, por ejemplo 987 654 321." };

  const { tasaIgv } = await configDinero(ctx.taller.id);
  const items = lineasConIgv(d.lineas, { conIgv: d.conIgv, preciosConIgv: d.preciosConIgv }, tasaIgv);
  const supabase = await clienteServidor();
  const { data: id, error } = await supabase.rpc("guardar_cotizacion", {
    p_empresa: ctx.taller.id,
    p_id: d.id,
    p_orden: d.id ? null : d.ordenId,
    p_cliente: {
      nombre: d.cliente.nombre,
      celular: celular ?? "",
      documento: d.cliente.documento,
      placa: d.cliente.placa ? normalizarPlaca(d.cliente.placa) : "",
      vehiculo: d.cliente.vehiculo,
    },
    p_items: items,
    p_con_igv: d.conIgv,
    p_descuento: d.descuento && d.descuento.valor > 0 ? d.descuento : null,
    p_adicional: d.adicional,
  });
  if (error) return { error: error.code === "23514" || error.code === "P0001" ? error.message : "No se pudo guardar la cotización." };
  revalidatePath("/cotizaciones");
  if (d.ordenId) revalidatePath(`/ordenes/${d.ordenId}`);
  return { ok: d.id ? "Cotización actualizada." : "Cotización creada.", id: id as string };
}

/** Pasar una cotización suelta a una orden (cuando el carro llega). */
export async function pasarAOrden(cotizacionId: string, ordenId: string): Promise<ResultadoCotizacion> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return { error: "Tu rol no maneja cotizaciones." };
  const supabase = await clienteServidor();
  const { error } = await supabase.rpc("asignar_cotizacion_a_orden", { p_cot: cotizacionId, p_orden: ordenId });
  if (error) return { error: error.code === "23514" ? error.message : "No se pudo pasar a la orden." };
  revalidatePath("/cotizaciones");
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Listo: la cotización ya está en la orden.", id: cotizacionId };
}
