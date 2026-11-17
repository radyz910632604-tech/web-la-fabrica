import { describe, expect, it } from "vitest";
import { celularAEmail, formatearCelular, normalizarCelular } from "@/lib/celulares";
import { formatearPlaca, validarPlaca } from "@/lib/placas";

describe("celulares", () => {
  it.each([
    ["987654321", "+51987654321"],
    ["987 654 321", "+51987654321"],
    ["51987654321", "+51987654321"],
    ["+51 987-654-321", "+51987654321"],
    ["0051987654321", "+51987654321"],
  ])("acepta %s como lo escribe la gente", (entrada, esperado) => {
    expect(normalizarCelular(entrada)).toBe(esperado);
  });

  it.each(["12345", "887654321", "+51887654321", "51 1 4567890", "abc", ""])("rechaza %s", (entrada) => {
    expect(normalizarCelular(entrada)).toBeNull();
  });

  it("acepta celulares de otros países en formato internacional", () => {
    expect(normalizarCelular("+34 612 345 678")).toBe("+34612345678");
  });

  it("convierte el celular en el correo interno de login, que nunca recibe mensajes", () => {
    expect(celularAEmail("+51987654321")).toBe("51987654321@celular.taller-control.invalid");
  });

  it("muestra los celulares peruanos en grupos de tres", () => {
    expect(formatearCelular("+51987654321")).toBe("987 654 321");
    expect(formatearCelular("+34612345678")).toBe("+34612345678");
  });
});

describe("placas", () => {
  it.each(["ABC-123", "abc123", "A1B-234", " f7q 315 "])("valida %s con el formato actual", (entrada) => {
    expect(validarPlaca(entrada).estado).toBe("valida");
  });

  it("pide confirmar otros formatos en vez de rechazarlos", () => {
    expect(validarPlaca("1234-AB")).toEqual({ estado: "revisar", placa: "1234AB" });
    expect(validarPlaca("123456").estado).toBe("revisar");
  });

  it("rechaza lo que no puede ser una placa", () => {
    expect(validarPlaca("AB").estado).toBe("invalida");
    expect(validarPlaca("ABCDEFGHIJ").estado).toBe("invalida");
  });

  it("guarda sin guion y muestra con guion", () => {
    expect(formatearPlaca("abc123")).toBe("ABC-123");
    expect(formatearPlaca("1234AB")).toBe("1234AB");
  });
});

import { numeroOrden, siguientesEstados } from "@/lib/taller/estados";

describe("órdenes", () => {
  it("numera las órdenes como OT-000123", () => {
    expect(numeroOrden(1)).toBe("OT-000001");
    expect(numeroOrden(123456)).toBe("OT-123456");
  });
  it("el técnico nunca ve el botón de entregar al cliente", () => {
    expect(siguientesEstados("listo", true).map((p) => p.estado)).toEqual(["en_proceso"]);
    expect(siguientesEstados("listo", false).map((p) => p.estado)).toContain("entregado");
    expect(siguientesEstados("entregado", true)).toEqual([]);
  });
  it("cada estado ofrece el siguiente paso lógico", () => {
    expect(siguientesEstados("en_taller", false).map((p) => p.estado)).toEqual(["en_diagnostico", "en_proceso"]);
    expect(siguientesEstados("en_diagnostico", false)[0].estado).toBe("espera_aprobacion");
    expect(siguientesEstados("espera_aprobacion", false)[0].estado).toBe("aprobado");
    // El técnico no registra la aprobación del cliente ni la entrega
    expect(siguientesEstados("en_diagnostico", true).map((p) => p.estado)).toEqual(["en_proceso"]);
    expect(siguientesEstados("espera_aprobacion", true).map((p) => p.estado)).toEqual(["en_diagnostico"]);
    expect(siguientesEstados("esperando_repuesto", false)[0].estado).toBe("en_proceso");
  });
});
