import { describe, expect, it } from "vitest";
import { esUsuarioValido, normalizarUsuario, sugerirUsuario } from "@/lib/usuarios";

describe("usuario para entrar", () => {
  it("sugiere nombre.apellido sin tildes ni eñes", () => {
    expect(sugerirUsuario("Cecilia Minope Ruiz")).toBe("cecilia.minope");
    expect(sugerirUsuario("José Ñahui")).toBe("jose.nahui");
    expect(sugerirUsuario("Al")).toBe("al0");
  });
  it("acepta solo el formato permitido", () => {
    expect(esUsuarioValido("cecilia.minope")).toBe(true);
    expect(esUsuarioValido("luis_q2")).toBe(true);
    expect(esUsuarioValido("ab")).toBe(false);
    expect(esUsuarioValido("josé")).toBe(false);
    expect(esUsuarioValido("con espacio")).toBe(false);
    expect(esUsuarioValido("Mayus")).toBe(false);
  });
  it("normaliza lo que se escribe", () => {
    expect(normalizarUsuario("  Rosa.Huaman ")).toBe("rosa.huaman");
  });
});
