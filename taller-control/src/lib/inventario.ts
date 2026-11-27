/**
 * Inventario: cálculos puros (sin base de datos), con pruebas en tests/.
 * El stock y el costo promedio los lleva la base con el kardex; aquí solo
 * se decide qué mostrar y se validan los datos que escribe la persona.
 */

export const UNIDADES: Record<string, { nombre: string; corto: string }> = {
  unidad: { nombre: "Unidad", corto: "u." },
  juego: { nombre: "Juego", corto: "jgo." },
  litro: { nombre: "Litro", corto: "L" },
  galon: { nombre: "Galón", corto: "gal." },
  metro: { nombre: "Metro", corto: "m" },
  kilo: { nombre: "Kilo", corto: "kg" },
  kit: { nombre: "Kit", corto: "kit" },
};

export type RepuestoStock = { stock: number; stockMinimo: number; costoPromedio: number; activo?: boolean };

/** Stock bajo: llegó al mínimo (solo si el repuesto tiene un mínimo puesto). */
export function stockBajo(r: Pick<RepuestoStock, "stock" | "stockMinimo">): boolean {
  return r.stockMinimo > 0 && r.stock <= r.stockMinimo;
}

/** Cuánto falta comprar para volver al doble del mínimo (sugerencia de pedido). */
export function sugerenciaPedido(r: Pick<RepuestoStock, "stock" | "stockMinimo">): number {
  if (!stockBajo(r)) return 0;
  return Math.max(0, Math.ceil(r.stockMinimo * 2 - r.stock));
}

/** Valor del stock al costo promedio sin IGV. */
export function valorStock(lista: RepuestoStock[]): number {
  const total = lista.filter((r) => r.activo !== false).reduce((a, r) => a + r.stock * r.costoPromedio, 0);
  return Math.round(total * 100) / 100;
}

/** Código como lo guarda la base: mayúsculas, sin espacios ni tildes. */
export function normalizarCodigo(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9./-]/g, "")
    .slice(0, 30);
}

export function codigoValido(codigo: string): boolean {
  return /^[A-Z0-9][A-Z0-9./-]{0,29}$/.test(codigo);
}

/** Cantidad para mostrar: sin decimales si es entera. */
export function cantidadTexto(n: number, unidad = "unidad"): string {
  const valor = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");
  return `${valor} ${UNIDADES[unidad]?.corto ?? "u."}`;
}
