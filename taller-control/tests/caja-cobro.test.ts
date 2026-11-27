import { describe, expect, it } from "vitest";
import { coincide, filtrarOrdenes, grupoPago, type OrdenCaja } from "@/lib/taller/caja-cobro";

const o = (x: Partial<OrdenCaja>): OrdenCaja => ({ id: "1", numero: 1, placa: "ABC123", vehiculo: "", cliente: "Juan Pérez", documento: "45678912", estado: "en_taller", ingresadoEn: "", aCobrar: 0, pagado: 0, saldo: 0, ...x });

describe("caja: estado de pago y búsqueda", () => {
  it("pendiente, abonada y pagada", () => {
    expect(grupoPago({ aCobrar: 0, pagado: 0 })).toBe("pendientes");
    expect(grupoPago({ aCobrar: 500, pagado: 0 })).toBe("pendientes");
    expect(grupoPago({ aCobrar: 500, pagado: 200 })).toBe("abonadas");
    expect(grupoPago({ aCobrar: 500, pagado: 500 })).toBe("pagadas");
  });
  it("busca por número con o sin OT y ceros", () => {
    expect(coincide(o({ numero: 12 }), "OT-000012")).toBe(true);
    expect(coincide(o({ numero: 12 }), "12")).toBe(true);
    expect(coincide(o({ numero: 12 }), "ord-12")).toBe(true);
  });
  it("busca por placa con guion, cliente sin tilde y DNI", () => {
    expect(coincide(o({}), "abc-123")).toBe(true);
    expect(coincide(o({}), "perez")).toBe(true);
    expect(coincide(o({}), "4567891")).toBe(true);
    expect(coincide(o({}), "maria")).toBe(false);
  });
  it("cuenta por estado lo que coincide con la búsqueda", () => {
    const lista = [o({ id: "a", aCobrar: 100 }), o({ id: "b", aCobrar: 100, pagado: 50 }), o({ id: "c", aCobrar: 100, pagado: 100, cliente: "Ana" })];
    const r = filtrarOrdenes(lista, "", "abonadas");
    expect(r.conteo).toEqual({ todas: 3, pendientes: 1, abonadas: 1, pagadas: 1 });
    expect(r.lista.map((x) => x.id)).toEqual(["b"]);
    expect(filtrarOrdenes(lista, "ana", "todas").conteo.todas).toBe(1);
  });
});
