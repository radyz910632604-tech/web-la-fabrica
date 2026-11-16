/**
 * Nombres y colores del taller, iguales a los valores de la base de datos.
 * Colores de estado (especificación): verde completado, amarillo en proceso, rojo pendiente.
 */

export const ESTADOS_ORDEN = ["en_taller", "en_proceso", "esperando_repuesto", "listo", "entregado"] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

export const NOMBRE_ESTADO: Record<EstadoOrden, string> = {
  en_taller: "En taller",
  en_proceso: "En proceso",
  esperando_repuesto: "Espera repuesto",
  listo: "Listo",
  entregado: "Entregado",
};

export const COLOR_ESTADO: Record<EstadoOrden, "gris" | "amarillo" | "rojo" | "verde"> = {
  en_taller: "gris",
  en_proceso: "amarillo",
  esperando_repuesto: "rojo",
  listo: "verde",
  entregado: "verde",
};

export const ESTADOS_CITA = ["agendada", "confirmada", "llego", "no_llego", "reagendada", "cancelada"] as const;
export type EstadoCita = (typeof ESTADOS_CITA)[number];

export const NOMBRE_ESTADO_CITA: Record<EstadoCita, string> = {
  agendada: "Por confirmar",
  confirmada: "Confirmada",
  llego: "Llegó",
  no_llego: "No llegó",
  reagendada: "Reagendada",
  cancelada: "Cancelada",
};

export const COLOR_ESTADO_CITA: Record<EstadoCita, "gris" | "amarillo" | "rojo" | "verde"> = {
  agendada: "amarillo",
  confirmada: "gris",
  llego: "verde",
  no_llego: "rojo",
  reagendada: "gris",
  cancelada: "gris",
};

export const REDES = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  whatsapp: "WhatsApp",
  google: "Google",
  referido: "Referido",
  otro: "Otro",
} as const;
export type Red = keyof typeof REDES;

export const ORIGENES_CLIENTE = { redes: "Redes sociales", referido: "Referido", recurrente: "Recurrente", otro: "Otro" } as const;
export const DOCUMENTOS = { ninguno: "Sin documento", dni: "DNI", ruc: "RUC", ce: "Carné de extranjería" } as const;
export const COMBUSTIBLES = {
  gasolina: "Gasolina",
  diesel: "Diésel",
  gnv: "GNV",
  glp: "GLP",
  dual: "Dual (gasolina y gas)",
  electrico: "Eléctrico",
  hibrido: "Híbrido",
} as const;
export const CARROCERIAS = { sedan: "Sedán", hatchback: "Hatchback", suv: "SUV", camioneta: "Camioneta", pickup: "Pickup", van: "Van", coupe: "Coupé", station_wagon: "Station wagon", otro: "Otro" } as const;
export const TRANSMISIONES = { mecanica: "Mecánica", automatica: "Automática", cvt: "CVT", otra: "Otra" } as const;

/** 123 → "OT-000123" */
export function numeroOrden(numero: number): string {
  return `OT-${String(numero).padStart(6, "0")}`;
}

/**
 * Los siguientes pasos de una orden, como botones de un toque.
 * El técnico nunca marca la entrega al cliente (la base de datos también lo impide).
 */
export function siguientesEstados(actual: EstadoOrden, esTecnico: boolean): { estado: EstadoOrden; texto: string }[] {
  const pasos: Record<EstadoOrden, { estado: EstadoOrden; texto: string }[]> = {
    en_taller: [{ estado: "en_proceso", texto: "Empezar trabajo" }],
    en_proceso: [
      { estado: "listo", texto: "Marcar listo" },
      { estado: "esperando_repuesto", texto: "Espera repuesto" },
    ],
    esperando_repuesto: [{ estado: "en_proceso", texto: "Llegó el repuesto" }],
    listo: [
      { estado: "entregado", texto: "Entregar al cliente" },
      { estado: "en_proceso", texto: "Volver a trabajar" },
    ],
    entregado: esTecnico ? [] : [{ estado: "en_proceso", texto: "Reabrir orden" }],
  };
  return pasos[actual].filter((p) => !(esTecnico && p.estado === "entregado"));
}

/** "OT-000012 · ABC-123 · Juan Pérez" para listas de órdenes. */
export function etiquetaOrden(o: { numero: number; placa: string; cliente?: string | null }): string {
  const placa = /^[A-Z0-9]{3}\d{3}$/.test(o.placa) ? `${o.placa.slice(0, 3)}-${o.placa.slice(3)}` : o.placa;
  return `${numeroOrden(o.numero)} · ${placa}${o.cliente ? ` · ${o.cliente}` : ""}`;
}
