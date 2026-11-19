/** Categorías de gastos del taller (las mismas que acepta la base). */
export const CATEGORIAS_GASTO = {
  alquiler: "Alquiler",
  luz: "Luz",
  agua: "Agua",
  internet_telefono: "Internet y teléfono",
  sueldos: "Sueldos y pagos al personal",
  movilidad: "Movilidad y combustible",
  publicidad: "Publicidad",
  herramientas: "Herramientas y equipos",
  limpieza: "Limpieza",
  impuestos: "Impuestos y trámites",
  mantenimiento_local: "Mantenimiento del local",
  contador: "Contador",
  otros: "Otros",
} as const;
export type CategoriaGasto = keyof typeof CATEGORIAS_GASTO;
