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

export const INTENCIONES = ["nuevo_ingreso", "avance", "correccion", "repuestos", "compra", "recepcion", "comprobante_venta", "pago", "cita", "cotizacion", "historial", "documento", "ayuda", "desconocido"] as const;
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
  /** Datos del carro dichos en el ingreso (o en una corrección). */
  marca: z.string().nullable(),
  modelo: z.string().nullable(),
  anio: z.number().nullable(),
  color: z.string().nullable(),
  /** Lo que encontró el taller («diagnóstico: sincronizador de tercera gastado»). */
  diagnostico: z.string().nullable(),
  nuevo_estado: z.enum(["en_diagnostico", "espera_aprobacion", "aprobado", "en_proceso", "esperando_repuesto", "listo"]).nullable(),
  monto: z.number().nullable(),
  medio_pago: z.enum(["efectivo", "yape", "plin", "tarjeta", "transferencia"]).nullable(),
  tipo_pago: z.enum(["adelanto", "abono", "saldo"]).nullable(),
  fecha_hora: z.string().nullable(),
  /** Ingreso: cuándo se le prometió el carro al cliente (AAAA-MM-DDTHH:MM de Lima, o la frase tal cual sin IA). */
  entrega_prometida: z.string().nullable(),
  red_origen: z.enum(["facebook", "instagram", "tiktok", "whatsapp", "google", "otro"]).nullable(),
  campana: z.string().nullable(),
  items_cotizacion: z.array(z.object({ descripcion: z.string(), tipo: z.enum(["servicio", "repuesto"]), cantidad: z.number(), precio_con_igv: z.number() })),
  /** Recepción de repuestos: proveedor, comprobante («F001-123») y lo que llegó (precio por unidad, con IGV). */
  proveedor: z.string().nullable(),
  comprobante: z.string().nullable(),
  items_compra: z.array(z.object({ descripcion: z.string(), cantidad: z.number(), precio_unitario: z.number().nullable() })),
  /** Documento pedido por WhatsApp: recibo, cotización (proforma), orden o cierre de caja. */
  documento: z.enum(["recibo", "cotizacion", "orden", "caja"]).nullable(),
  dudas: z.string().nullable(),
  /** Qué tan seguro está de lo que entendió. */
  confianza: z.enum(["alta", "media", "baja"]).nullable(),
});
export type MensajeInterpretado = z.infer<typeof esquemaMensaje>;

/** Foto de repuestos o de un vale de salida de almacén: qué se cargó a qué carro. */
export const esquemaVale = z.object({
  placa: z.string().nullable(),
  items: z.array(z.object({ descripcion: z.string(), codigo: z.string().nullable(), cantidad: z.number() })),
  legible: z.enum(["bien", "con_dudas", "no_se_lee"]),
});
export type ValeLeido = z.infer<typeof esquemaVale>;

export const TIPOS_FOTO = ["ingreso", "dano", "tablero", "trabajo", "salida", "repuestos", "documento", "otro"] as const;
export type TipoFoto = (typeof TIPOS_FOTO)[number];

export const esquemaPlaca = z.object({
  placa: z.string().nullable(),
  legible: z.enum(["bien", "con_dudas", "no_se_lee"]),
  /** Qué muestra la foto: el carro al llegar, un daño, el tablero, el trabajo, el carro listo, repuestos o un papel. */
  tipo_foto: z.enum(TIPOS_FOTO).nullable(),
  /** Si es el tablero y se lee el odómetro: kilómetros. */
  kilometraje: z.number().nullable(),
});
export type PlacaLeida = z.infer<typeof esquemaPlaca>;

/** Mensaje vacío: punto de partida del lector sin IA y de las pruebas. */
export function mensajeVacio(intencion: Intencion = "desconocido"): MensajeInterpretado {
  return {
    intencion, placa: null, cliente_nombre: null, cliente_celular: null, cliente_documento: null, servicios: [], kilometraje: null,
    observaciones: null, texto_avance: null, marca: null, modelo: null, anio: null, color: null, diagnostico: null, nuevo_estado: null, monto: null, medio_pago: null, tipo_pago: null, fecha_hora: null,
    entrega_prometida: null, red_origen: null, campana: null, items_cotizacion: [], proveedor: null, comprobante: null, items_compra: [], documento: null, dudas: null, confianza: null,
  };
}
