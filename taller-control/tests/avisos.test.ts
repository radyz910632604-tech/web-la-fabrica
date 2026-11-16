import { describe, expect, it } from "vitest";
import { aUnaLinea, citaNoLlego, citasDelDia, resumenDelDia } from "@/lib/avisos/textos";
import { ayuda, historial, resumen } from "@/lib/whatsapp/respuestas";

const taller = { taller: "Taller Norte", enTaller: 2, enProceso: 5, esperandoRepuesto: 1, listos: 3, entregadosHoy: 4, atrasados: 1, horasSinCambio: 48 };

describe("textos de avisos", () => {
  it("el resumen general cuenta lo del taller sin montos", () => {
    const r = resumenDelDia("mediodia", "Rosa Huamán", taller, { tipo: "general" });
    expect(r.titulo).toBe("Resumen del mediodía · Taller Norte");
    expect(r.texto).toContain("En taller 8");
    expect(r.texto).toContain("1 orden lleva más de 48 h sin avance");
    expect(r.texto).not.toMatch(/S\//);
  });
  it("el técnico solo ve sus trabajos", () => {
    const r = resumenDelDia("cierre", "Luis Quispe", taller, { tipo: "tecnico", pendientes: 1, enProceso: 2, esperandoRepuesto: 0, listosHoy: 3 });
    expect(r.texto).toBe("Luis, tus trabajos: 1 por empezar, 2 en proceso, 0 esperando repuesto, 3 listos hoy.");
  });
  it("citas del día marca las confirmadas", () => {
    const r = citasDelDia("Taller Norte", [{ hora: "09:00", nombre: "Ana", servicio: "Aceite", confirmada: true }, { hora: "10:30", nombre: "Beto", servicio: "Frenos", confirmada: false }]);
    expect(r.texto).toBe("2 citas, 1 sin confirmar: 09:00 Ana (Aceite) ✓ · 10:30 Beto (Frenos)");
    expect(citasDelDia("T", []).texto).toBe("Hoy no hay citas agendadas.");
  });
  it("aviso de cita sin llegada y variables en una línea", () => {
    expect(citaNoLlego("Ana", "10:00", "Aceite").texto).toContain("no llegó a su cita de las 10:00");
    expect(aUnaLinea("uno\n\ndos     tres")).toBe("uno · dos   tres");
  });
});

describe("respuestas de WhatsApp", () => {
  it("la ayuda del técnico no ofrece pagos ni compras", () => {
    const t = ayuda(["tecnico"], "Luis Quispe").texto;
    expect(t).toContain("Avance");
    expect(t).not.toContain("Pago:");
    expect(t).not.toContain("Compra:");
  });
  it("resume un pago para confirmarlo", () => {
    const t = resumen("pago", { placa: "ABC123", ordenNumero: 12, monto: 150, medio: "yape", tipo: "abono", saldo: 300 });
    expect(t).toContain("*Pago* ABC-123 (OT-000012)");
    expect(t).toContain("S/ 150.00 · yape · abono");
    expect(t).toContain("por confirmar");
  });
  it("historial vacío y con visitas", () => {
    expect(historial("ABC123", [])).toContain("No encontré visitas de ABC-123");
    expect(historial("ABC123", [{ numero: 3, fecha: "2026-11-02", estado: "entregado", servicios: ["Aceite"] }])).toContain("02/11/2026 · OT-000003 · Aceite");
  });
});
