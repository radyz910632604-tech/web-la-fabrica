import { describe, expect, it } from "vitest";
import { interpretarSinIa } from "@/lib/ia/sin-ia";
import { PERMITIDO, resumen } from "@/lib/whatsapp/respuestas";

describe("WhatsApp: llegaron repuestos (almacén)", () => {
  it("entiende proveedor, comprobante y lo que llegó", () => {
    const m = interpretarSinIa("llegaron de Lubricantes Demo factura F001-123: 4 aceite 10W40 a 85, 2 filtro de aceite a 30");
    expect(m.intencion).toBe("recepcion");
    expect(m.proveedor).toBe("Lubricantes Demo");
    expect(m.comprobante).toBe("F001-123");
    expect(m.items_compra).toEqual([
      { descripcion: "aceite 10W40", cantidad: 4, precio_unitario: 85 },
      { descripcion: "filtro de aceite", cantidad: 2, precio_unitario: 30 },
    ]);
  });
  it("sin precios ni comprobante también sirve (los pide o quedan por completar)", () => {
    const m = interpretarSinIa("recibí de Repuestos El Sol: 6 bujías");
    expect(m.intencion).toBe("recepcion");
    expect(m.comprobante).toBeNull();
    expect(m.items_compra).toEqual([{ descripcion: "bujías", cantidad: 6, precio_unitario: null }]);
  });
  it("lo pueden registrar almacén, administración y gerencia; no el técnico", () => {
    expect(PERMITIDO.recepcion).toEqual(["gerencia", "administrador", "almacen"]);
  });
  it("el resumen antes de confirmar dice a dónde va cada repuesto", () => {
    const r = resumen("recepcion", {
      proveedor: "Lubricantes Demo", comprobante: "F001-123", fotos: [{ ruta: "x" }],
      items: [{ descripcion: "aceite 10W40", cantidad: 4, precio: 85, repuesto: "ACE-001 Aceite 10W-40" }, { descripcion: "filtro", cantidad: 2, precio: null, repuesto: null }],
    });
    expect(r).toContain("*Llegaron repuestos*");
    expect(r).toContain("4 × aceite 10W40 a S/ 85.00 → inventario: ACE-001 Aceite 10W-40");
    expect(r).toContain("2 × filtro (sin precio) → no está en el inventario");
    expect(r).toContain("Foto de evidencia: 1");
  });
});

describe("WhatsApp: pedir documentos en PDF", () => {
  it("recibo, cotización, orden y caja", () => {
    expect(interpretarSinIa("recibo ABC123")).toMatchObject({ intencion: "documento", documento: "recibo", placa: "ABC123" });
    expect(interpretarSinIa("mándame la cotización de ABC-123")).toMatchObject({ intencion: "documento", documento: "cotizacion", placa: "ABC123" });
    expect(interpretarSinIa("orden de reparación B7K789")).toMatchObject({ intencion: "documento", documento: "orden", placa: "B7K789" });
    expect(interpretarSinIa("cierre de caja")).toMatchObject({ intencion: "documento", documento: "caja" });
  });
  it("«cotiza ABC123 pastillas 180» sigue siendo armar una cotización", () => {
    expect(interpretarSinIa("cotiza ABC123 pastillas 180").intencion).toBe("cotizacion");
  });
  it("solo gerencia, administración y asesores", () => {
    expect(PERMITIDO.documento).toEqual(["gerencia", "administrador", "asesor"]);
  });
});
