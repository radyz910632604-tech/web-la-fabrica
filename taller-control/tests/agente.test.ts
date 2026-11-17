import { describe, expect, it } from "vitest";
import { interpretarSinIa } from "@/lib/ia/sin-ia";
import { ayuda, SIN_ACCESO } from "@/lib/whatsapp/respuestas";

describe("agente de WhatsApp: lo que entiende sin IA", () => {
  it("corrección de lo recién guardado", () => {
    expect(interpretarSinIa("No, el kilometraje es 58 mil")).toMatchObject({ intencion: "correccion", kilometraje: 58000 });
    expect(interpretarSinIa("no, el celular es 987 654 321")).toMatchObject({ intencion: "correccion", cliente_celular: "987654321" });
    expect(interpretarSinIa("corrige: el color es blanco")).toMatchObject({ intencion: "correccion", color: "blanco" });
  });
  it("diagnóstico y aprobación en un solo mensaje", () => {
    const m = interpretarSinIa("ABC-123 diagnóstico: sincronizador de tercera gastado. El cliente aprobó");
    expect(m).toMatchObject({ intencion: "avance", placa: "ABC123", nuevo_estado: "aprobado" });
    expect(m.diagnostico).toBe("sincronizador de tercera gastado");
  });
  it("estados nuevos por voz", () => {
    expect(interpretarSinIa("ABC123 presupuesto enviado").nuevo_estado).toBe("espera_aprobacion");
    expect(interpretarSinIa("ABC123 en reparación").nuevo_estado).toBe("en_proceso");
    expect(interpretarSinIa("ABC123 listo").nuevo_estado).toBe("listo");
  });
  it("kilometraje dicho como «85 mil km» en el ingreso", () => {
    expect(interpretarSinIa("ingreso ABC123 Ana Ruiz 987111222 por frenos, 85 mil km").kilometraje).toBe(85000);
  });
  it("número no registrado y ayuda", () => {
    expect(SIN_ACCESO.texto).toBe("Este número es de uso interno del taller.");
    expect(ayuda(["tecnico"], "Luis Quispe").texto).toContain("No, el kilometraje es 58 mil");
    expect(ayuda(["tecnico"], "Luis Quispe").texto).not.toContain("Ingreso:");
  });
});

describe("alertas del agente", async () => {
  const t = await import("@/lib/avisos/textos");
  it("el comprobante cuadra si la diferencia es de S/ 1 o menos", () => {
    expect(t.cuadreComprobante(300, 300.5)).toEqual({ cuadra: true, diferencia: -0.5 });
    expect(t.cuadreComprobante(280, 300)).toEqual({ cuadra: false, diferencia: -20 });
    expect(t.cuadreComprobante(280, null).cuadra).toBe(true);
  });
  it("textos cortos y con lo necesario para actuar", () => {
    expect(t.comprobanteNoCuadra({ placa: "ABC-123", ot: "OT-000012", comprobante: "Boleta B001-77", totalComprobante: 280, totalOrden: 300 }).texto).toContain("faltan S/ 20.00");
    expect(t.esperaAprobacion({ placa: "ABC-123", cliente: "Ana", celular: "987 111 222", horas: 26 }).texto).toContain("hace 26 h");
    const caja = t.resumenParaCaja({ placa: "ABC-123", ot: "OT-000012", cliente: "Ana", servicios: ["Cambio de caja"], repuestos: ["2× Aceite ATF"], total: 1500 });
    expect(caja.texto).toContain("Total aprobado: S/ 1,500.00");
    expect(caja.texto).toContain("2× Aceite ATF");
    expect(t.resumenParaCaja({ placa: "ABC-123", ot: "OT-1", cliente: "Ana", servicios: [], repuestos: [], total: null }).texto).toContain("no tiene cotización aprobada");
  });
});
