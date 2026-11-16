import { z } from "zod";

/**
 * Lo que la IA puede devolver. Son formatos cerrados: aunque un documento o
 * un mensaje traiga "instrucciones", la IA solo puede llenar estos campos, y
 * la app vuelve a validar todo antes de guardar (y lo deja por confirmar).
 * Todos los campos son obligatorios (null cuando no se sabe): así lo pide el
 * modo de salida estructurada.
 */

export const esquemaComprobante = z.object({
  es_comprobante: z.boolean(),
  tipo: z.enum(["factura", "boleta", "nota_venta", "ticket", "nota_credito", "otro"]),
  emisor_ruc: z.string().nullable(),
  emisor_nombre: z.string().nullable(),
  cliente_documento: z.string().nullable(),
  cliente_nombre: z.string().nullable(),
  serie: z.string().nullable(),
  numero: z.string().nullable(),
  fecha: z.string().nullable(),
  moneda: z.enum(["PEN", "USD"]),
  subtotal_sin_igv: z.number().nullable(),
  igv: z.number().nullable(),
  total: z.number().nullable(),
  precios_incluyen_igv: z.boolean(),
  lineas: z.array(z.object({ descripcion: z.string(), cantidad: z.number(), precio_unitario: z.number(), importe: z.number() })),
  placa: z.string().nullable(),
  legible: z.enum(["bien", "con_dudas", "no_se_lee"]),
  dudas: z.string().nullable(),
});
export type ComprobanteLeido = z.infer<typeof esquemaComprobante>;

export const INTENCIONES = ["nuevo_ingreso", "avance", "compra", "comprobante_venta", "pago", "cita", "cotizacion", "historial", "ayuda", "desconocido"] as const;
export type Intencion = (typeof INTENCIONES)[number];

export const esquemaMensaje = z.object({
  intencion: z.enum(INTENCIONES),
  placa: z.string().nullable(),
  cliente_nombre: z.string().nullable(),
  cliente_celular: z.string().nullable(),
  cliente_documento: z.string().nullable(),
  servicios: z.array(z.string()),
  kilometraje: z.number().nullable(),
  observaciones: z.string().nullable(),
  texto_avance: z.string().nullable(),
  nuevo_estado: z.enum(["en_proceso", "esperando_repuesto", "listo"]).nullable(),
  monto: z.number().nullable(),
  medio_pago: z.enum(["efectivo", "yape", "plin", "tarjeta", "transferencia"]).nullable(),
  tipo_pago: z.enum(["adelanto", "abono", "saldo"]).nullable(),
  fecha_hora: z.string().nullable(),
  /** Ingreso: cuándo se le prometió el carro al cliente (AAAA-MM-DDTHH:MM de Lima, o la frase tal cual sin IA). */
  entrega_prometida: z.string().nullable(),
  red_origen: z.enum(["facebook", "instagram", "tiktok", "whatsapp", "google", "otro"]).nullable(),
  campana: z.string().nullable(),
  items_cotizacion: z.array(z.object({ descripcion: z.string(), tipo: z.enum(["servicio", "repuesto"]), cantidad: z.number(), precio_con_igv: z.number() })),
  dudas: z.string().nullable(),
});
export type MensajeInterpretado = z.infer<typeof esquemaMensaje>;

export const esquemaPlaca = z.object({
  placa: z.string().nullable(),
  legible: z.enum(["bien", "con_dudas", "no_se_lee"]),
});
export type PlacaLeida = z.infer<typeof esquemaPlaca>;

/** Mensaje vacío: punto de partida del lector sin IA y de las pruebas. */
export function mensajeVacio(intencion: Intencion = "desconocido"): MensajeInterpretado {
  return {
    intencion, placa: null, cliente_nombre: null, cliente_celular: null, cliente_documento: null, servicios: [], kilometraje: null,
    observaciones: null, texto_avance: null, nuevo_estado: null, monto: null, medio_pago: null, tipo_pago: null, fecha_hora: null,
    entrega_prometida: null, red_origen: null, campana: null, items_cotizacion: [], dudas: null,
  };
}
