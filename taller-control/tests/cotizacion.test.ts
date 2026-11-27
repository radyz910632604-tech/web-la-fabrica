import { describe, expect, it } from "vitest";
import { lineasConIgv, totalesCotizacion } from "@/lib/taller/cotizacion";

describe("cotización: líneas, IGV y descuento", () => {
  it("S/ 380 con descuento de S/ 80 queda en S/ 300 e IGV incluido", () => {
    const t = totalesCotizacion(380, { tipo: "monto", valor: 80, motivo: "Cliente frecuente" }, 0.18);
    expect(t).toEqual({ lineas: 380, descuento: 80, total: 300, sinIgv: 254.24, igv: 45.76 });
  });
  it("descuento en porcentaje y sin IGV", () => {
    expect(totalesCotizacion(500, { tipo: "porcentaje", valor: 10, motivo: "Promoción" }, 0)).toMatchObject({ descuento: 50, total: 450, igv: 0 });
  });
  it("el descuento no pasa del total", () => {
    expect(totalesCotizacion(100, { tipo: "monto", valor: 150, motivo: "Error" }, 0.18).total).toBe(0);
  });
  it("precios escritos sin IGV suman el 18 %", () => {
    const [l] = lineasConIgv([{ tipo: "repuesto", descripcion: "Filtro", cantidad: 2, precio: 50 }], { conIgv: true, preciosConIgv: false }, 0.18);
    expect(l).toMatchObject({ sin_igv: 100, igv: 18, total: 118, precio: 59 });
  });
});
