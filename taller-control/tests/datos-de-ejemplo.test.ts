import { describe, expect, it } from "vitest";
import { datosPanelEjemplo } from "@/lib/panel/ejemplo";

// Los datos de ejemplo tienen que cuadrar: una cifra que aparece dos veces es la misma.
describe("datos de ejemplo del panel", () => {
  const datos = datosPanelEjemplo(new Date("2026-11-16T15:00:00Z"));

  it("el conteo por estado suma los carros en taller", () => {
    const suma = Object.values(datos.conteoPorEstado).reduce((a, b) => a + b, 0);
    expect(suma).toBe(datos.enTaller.length);
    expect(datos.enTaller.every((o) => o.estado !== "entregado")).toBe(true);
  });

  it("utilidad = ventas − compras − mano de obra, en cada mes", () => {
    for (const m of datos.meses) {
      expect(m.costos).toBe(m.compras + m.manoObra);
      expect(m.utilidad).toBe(m.ventas - m.costos);
    }
  });

  it("el mes en curso del gráfico es el mismo de los indicadores", () => {
    const ultimo = datos.meses.at(-1)!;
    expect(ultimo.enCurso).toBe(true);
    expect(ultimo.ventas).toBe(datos.mes.ventas);
    expect(ultimo.utilidad).toBe(datos.mes.utilidad);
  });

  it("las etiquetas de los meses terminan en el mes actual de Lima", () => {
    expect(datos.meses.at(-1)!.etiqueta).toBe("Nov");
    expect(datos.meses).toHaveLength(8);
  });
});
