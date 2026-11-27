import { desdeSinIgv, desdeTotal, redondear } from "@/lib/dinero";

/**
 * Cálculos de una cotización (puros: los usa la pantalla para mostrar el total al instante
 * y el servidor para guardar). La base recalcula el total final con el mismo criterio.
 */

export type LineaEscrita = { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; precio: number };
export type OpcionesIgv = { conIgv: boolean; preciosConIgv: boolean };
export type Descuento = { tipo: "monto" | "porcentaje"; valor: number; motivo: string } | null;

/** Cada línea con su precio por unidad con IGV, sin IGV, IGV y total. */
export function lineasConIgv(lineas: LineaEscrita[], opciones: OpcionesIgv, tasaIgv: number) {
  const tasa = opciones.conIgv ? tasaIgv : 0;
  return lineas.map((l) => {
    const bruto = l.cantidad * l.precio;
    const m = !opciones.conIgv ? desdeTotal(bruto, 0) : opciones.preciosConIgv ? desdeTotal(bruto, tasa) : desdeSinIgv(bruto, tasa);
    return { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio: redondear(m.total / l.cantidad), sin_igv: m.sinIgv, igv: m.igv, total: m.total };
  });
}

/** Total de las líneas, descuento y total final (el IGV sale del total ya con descuento). */
export function totalesCotizacion(totalLineas: number, descuento: Descuento, tasa: number) {
  let desc = 0;
  if (descuento && descuento.valor > 0) {
    desc = descuento.tipo === "monto" ? Math.min(redondear(descuento.valor), totalLineas) : redondear((totalLineas * Math.min(descuento.valor, 100)) / 100);
  }
  const total = redondear(totalLineas - desc);
  const m = desdeTotal(total, tasa);
  return { lineas: redondear(totalLineas), descuento: desc, total, sinIgv: m.sinIgv, igv: m.igv };
}
