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
