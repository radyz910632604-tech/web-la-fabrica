import { describe, expect, it } from "vitest";
import { filtrarIngresos, grupoDe, resumirIngresos, type Ingreso } from "@/lib/caja/ingresos-calculo";

const i = (x: Partial<Ingreso>): Ingreso => ({
  id: "1", momento: "", dia: "2026-11-27", hora: "08:15", ordenId: "o", orden: 1, cliente: "Juan Pérez", documento: "45678912", placa: "ABC123",
  concepto: "", medio: "efectivo", tipo: "saldo", monto: 0, subtotal: 0, igv: 0, comprobante: "Constancia", usuario: "", operacion: null, ...x,
});

describe("ingresos del día", () => {
  it("Yape y Plin van juntos; el resto por su nombre", () => {
    expect(grupoDe("yape")).toBe("yape_plin");
    expect(grupoDe("plin")).toBe("yape_plin");
    expect(grupoDe("transferencia")).toBe("transferencia");
    expect(grupoDe("tarjeta")).toBe("tarjeta");
    expect(grupoDe("efectivo")).toBe("efectivo");
  });
  it("cada abono cuenta como su propia operación y la devolución se descuenta aparte", () => {
    const r = resumirIngresos([
      i({ medio: "yape", monto: 200 }),
      i({ medio: "efectivo", monto: 200 }),
      i({ medio: "transferencia", monto: 100 }),
      i({ medio: "yape", monto: -47.2, tipo: "devolucion" }),
    ]);
    expect(r).toMatchObject({ entradas: 500, devoluciones: 47.2, total: 452.8, operaciones: 3 });
    expect(r.porGrupo).toEqual({ efectivo: 200, yape_plin: 152.8, transferencia: 100, tarjeta: 0 });
  });
  it("busca y filtra por forma de pago", () => {
    const lista = [i({ id: "a", orden: 7, medio: "yape" }), i({ id: "b", orden: 8, cliente: "Ana Torres", documento: null, placa: "HIJ654", medio: "efectivo" })];
    expect(filtrarIngresos(lista, "OT-000008", null).map((x) => x.id)).toEqual(["b"]);
    expect(filtrarIngresos(lista, "hij-654", null).map((x) => x.id)).toEqual(["b"]);
    expect(filtrarIngresos(lista, "perez", null).map((x) => x.id)).toEqual(["a"]);
    expect(filtrarIngresos(lista, "", "yape_plin").map((x) => x.id)).toEqual(["a"]);
  });
});

import { porCliente, porDia, porSemana, semanaDelMes } from "@/lib/caja/ingresos-calculo";

describe("Excel acumulativo", () => {
  const lista = [
    i({ id: "1", dia: "2026-11-02", medio: "efectivo", monto: 250, orden: 2, cliente: "Carlos Ruiz", documento: "45876123", placa: "BDE456", concepto: "Cambio de aceite" }),
    i({ id: "2", dia: "2026-11-02", medio: "yape", monto: 380, orden: 1, concepto: "Mantenimiento preventivo" }),
    i({ id: "3", dia: "2026-11-03", medio: "transferencia", monto: 450, orden: 3, cliente: "María López", documento: "47891236", placa: "CDE789", concepto: "Frenos" }),
    i({ id: "4", dia: "2026-11-03", medio: "yape", monto: 100, orden: 1, concepto: "Mantenimiento preventivo" }),
  ];
  it("por día: cada día una fila, los días se suman debajo", () => {
    expect(porDia(lista)).toEqual([
      { dia: "2026-11-02", efectivo: 250, yape_plin: 380, transferencia: 0, tarjeta: 0, total: 630 },
      { dia: "2026-11-03", efectivo: 0, yape_plin: 100, transferencia: 450, tarjeta: 0, total: 550 },
    ]);
  });
  it("semanas de lunes a domingo (nov 2026 empieza domingo)", () => {
    expect(semanaDelMes("2026-11-01")).toBe(1);
    expect(semanaDelMes("2026-11-02")).toBe(2);
    expect(semanaDelMes("2026-11-08")).toBe(2);
    expect(semanaDelMes("2026-11-09")).toBe(3);
    expect(porSemana(lista)).toEqual([{ semana: 2, desde: "2026-11-02", hasta: "2026-11-03", total: 1180 }]);
  });
  it("por cliente: dos abonos de la misma orden suman en una fila", () => {
    const c = porCliente(lista);
    expect(c[0]).toMatchObject({ cliente: "Juan Pérez", ordenes: [1], total: 480, pagos: 2, fechas: ["2026-11-02", "2026-11-03"] });
    expect(c).toHaveLength(3);
  });
});
