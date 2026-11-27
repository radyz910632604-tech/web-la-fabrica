import { describe, expect, it } from "vitest";
import { instantesPeriodo, rangoPeriodo } from "@/lib/taller/periodo";

const hoy = "2026-11-27"; // viernes
describe("periodos de caja", () => {
  it("hoy por defecto", () => expect(rangoPeriodo(undefined, hoy)).toEqual({ periodo: "hoy", desde: hoy, hasta: hoy }));
  it("ayer", () => expect(rangoPeriodo("ayer", hoy)).toMatchObject({ desde: "2026-11-26", hasta: "2026-11-26" }));
  it("la semana empieza el lunes", () => expect(rangoPeriodo("semana", hoy)).toMatchObject({ desde: "2026-11-23", hasta: hoy }));
  it("domingo: desde el lunes anterior", () => expect(rangoPeriodo("semana", "2026-11-29")).toMatchObject({ desde: "2026-11-23" }));
  it("mes", () => expect(rangoPeriodo("mes", hoy)).toMatchObject({ desde: "2026-11-01", hasta: hoy }));
  it("rango invertido o futuro se corrige", () => expect(rangoPeriodo("rango", hoy, "2026-12-05", "2026-12-10")).toMatchObject({ desde: hoy, hasta: hoy }));
  it("rango sin desde válido vuelve a hoy", () => expect(rangoPeriodo("rango", hoy, "x")).toMatchObject({ periodo: "hoy" }));
  it("instantes en hora de Lima", () => expect(instantesPeriodo("2026-11-01", "2026-11-30")).toEqual({ inicio: "2026-11-01T00:00:00-05:00", fin: "2026-12-01T00:00:00-05:00" }));
});
