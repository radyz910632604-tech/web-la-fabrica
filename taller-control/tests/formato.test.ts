import { describe, expect, it } from "vitest";
import {
  diaEnLima,
  formatearMomento,
  formatearSoles,
  formatearVariacion,
  iniciales,
  nombreMes,
  saludo,
  variacion,
} from "@/lib/formato";

describe("soles", () => {
  // Entre "S/" y el número va un espacio que no se corta (\u00a0): el monto nunca se parte en dos líneas.
  it("usa S/, separador de miles y dos decimales", () => {
    expect(formatearSoles(1250)).toBe("S/\u00a01,250.00");
    expect(formatearSoles(41870, { sinDecimales: true })).toBe("S/\u00a041,870");
    expect(formatearSoles(0)).toBe("S/\u00a00.00");
  });
});

describe("variación", () => {
  it("se calcula contra el valor anterior", () => {
    expect(variacion(110, 100)).toBeCloseTo(0.1);
    expect(variacion(90, 100)).toBeCloseTo(-0.1);
  });
  it("sin valor anterior no hay variación (no se inventa un +100 %)", () => {
    expect(variacion(5, 0)).toBeNull();
  });
  it("lleva signo y un decimal; el cero va sin signo", () => {
    expect(formatearVariacion(0.0702)).toBe("+7.0 %");
    expect(formatearVariacion(-0.047)).toBe("−4.7 %");
    expect(formatearVariacion(0)).toBe("0.0 %");
  });
});

describe("hora de Lima (UTC−5)", () => {
  it("el saludo depende de la hora en Lima, no del servidor", () => {
    expect(saludo(new Date("2026-11-16T13:00:00Z"))).toBe("Buenos días"); // 08:00 en Lima
    expect(saludo(new Date("2026-11-16T20:00:00Z"))).toBe("Buenas tardes"); // 15:00
    expect(saludo(new Date("2026-11-16T03:30:00Z"))).toBe("Buenas noches"); // 22:30 del día 15
  });

  it("el día cambia a medianoche de Lima", () => {
    expect(diaEnLima(new Date("2026-11-16T04:59:00Z"))).toBe("2026-11-15");
    expect(diaEnLima(new Date("2026-11-16T05:00:00Z"))).toBe("2026-11-16");
  });

  it("dice Hoy, Ayer o la fecha corta", () => {
    const ahora = new Date("2026-11-16T15:00:00Z"); // 10:00 del 16 en Lima
    expect(formatearMomento(new Date("2026-11-16T14:40:00Z"), ahora)).toBe("Hoy 09:40");
    expect(formatearMomento(new Date("2026-11-15T22:15:00Z"), ahora)).toBe("Ayer 17:15");
    expect(formatearMomento(new Date("2026-11-12T15:05:00Z"), ahora)).toBe("12 nov 10:05");
  });

  it("el mes va en minúscula, como se escribe en español", () => {
    expect(nombreMes(new Date("2026-11-16T15:00:00Z"))).toBe("noviembre");
  });
});

describe("iniciales", () => {
  it("toma el primer nombre y el último apellido", () => {
    expect(iniciales("Rosa Huamán")).toBe("RH");
    expect(iniciales("Luis Alberto Quispe Mamani")).toBe("LM");
    expect(iniciales("Milagros")).toBe("M");
  });
});
