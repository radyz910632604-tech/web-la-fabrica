import { describe, expect, it } from "vitest";
import { cantidadTexto, codigoValido, normalizarCodigo, stockBajo, sugerenciaPedido, valorStock } from "@/lib/inventario";
import { calcularAlertas } from "@/lib/alertas";
import { accionesPara, seccionesPara } from "@/lib/navegacion";

describe("inventario", () => {
  it("stock bajo solo cuando hay mínimo y se llegó a él", () => {
    expect(stockBajo({ stock: 3, stockMinimo: 3 })).toBe(true);
    expect(stockBajo({ stock: 4, stockMinimo: 3 })).toBe(false);
    expect(stockBajo({ stock: 0, stockMinimo: 0 })).toBe(false);
  });
  it("sugiere pedir hasta el doble del mínimo", () => {
    expect(sugerenciaPedido({ stock: 1, stockMinimo: 4 })).toBe(7);
    expect(sugerenciaPedido({ stock: 9, stockMinimo: 4 })).toBe(0);
  });
  it("valoriza el stock al costo promedio y deja fuera los inactivos", () => {
    expect(valorStock([{ stock: 10, stockMinimo: 0, costoPromedio: 15.255 }, { stock: 2, stockMinimo: 0, costoPromedio: 100, activo: false }])).toBe(152.55);
  });
  it("normaliza códigos como los guarda la base", () => {
    expect(normalizarCodigo(" fil acé 01 ")).toBe("FIL-ACE-01");
    expect(codigoValido("FIL-ACE-01")).toBe(true);
    expect(codigoValido("-MAL")).toBe(false);
  });
  it("muestra la cantidad con su unidad", () => {
    expect(cantidadTexto(4, "litro")).toBe("4 L");
    expect(cantidadTexto(2.5, "unidad")).toBe("2.5 u.");
  });
  it("avisa el stock bajo y lo leído por IA sin confirmar", () => {
    const a = calcularAlertas({
      ahora: new Date("2026-11-16T15:00:00Z"), ordenes: [], itemsCompra: [], comprobantesSinOrden: [], horasSinCambio: 48, margenMinimoPct: 20, verDinero: true, verMargen: false,
      stockBajo: [{ codigo: "FIL-01", nombre: "Filtro", stock: 0, minimo: 2 }],
      porConfirmar: [{ texto: "La compra F001-9", href: "/compras?ver=por-confirmar" }],
    });
    expect(a.map((x) => x.tipo)).toEqual(["stock_bajo", "por_confirmar"]);
    expect(a[0].severidad).toBe("urgente");
    expect(a[1].href).toBe("/compras?ver=por-confirmar");
  });
  it("almacén y asesor ven el inventario; técnico y recepción no", () => {
    expect(seccionesPara(["almacen"]).some((d) => d.href === "/inventario")).toBe(true);
    expect(seccionesPara(["asesor"]).some((d) => d.href === "/inventario")).toBe(true);
    for (const rol of ["tecnico", "recepcion", "vendedor_redes", "confirmador"] as const) {
      expect([...seccionesPara([rol]), ...accionesPara([rol])].some((d) => d.href === "/inventario")).toBe(false);
    }
  });
});
