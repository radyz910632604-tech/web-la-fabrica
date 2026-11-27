import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { enBloques, faltantesPorRest, planear, VERSIONES, versionDe } from "@/lib/base/versiones";

const archivos = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();

describe("versiones de la base", () => {
  it("cada archivo de supabase/migrations tiene su versión con sonda, en el mismo orden", () => {
    expect(archivos.map(versionDe)).toEqual(VERSIONES.map((v) => v.version));
  });
});

describe("plan del actualizador", () => {
  const todas = (valor: boolean, hasta = 99) => new Map(VERSIONES.map((v, i) => [v.version, i < hasta ? valor : !valor]));
  it("base vacía: aplica todo, en orden", () => {
    const p = planear(archivos, new Set(), todas(false));
    expect(p.detectadas).toEqual([]);
    expect(p.porAplicar).toEqual(archivos);
  });
  it("base armada a mano hasta la parte 2: reconoce 10 y aplica el resto", () => {
    const p = planear(archivos, new Set(), todas(true, 10));
    expect(p.detectadas).toHaveLength(10);
    expect(p.porAplicar).toEqual(archivos.slice(10));
  });
  it("lo ya anotado no se toca", () => {
    const p = planear(archivos, new Set(VERSIONES.map((v) => v.version)), new Map());
    expect(p).toEqual({ detectadas: [], porAplicar: [] });
  });
  it("si falta una anterior, las siguientes no se dan por hechas", () => {
    const sondas = todas(true);
    sondas.set(VERSIONES[2].version, false);
    const p = planear(archivos, new Set(), sondas);
    expect(p.detectadas).toEqual(archivos.slice(0, 2));
    expect(p.porAplicar).toEqual(archivos.slice(2));
  });
});

describe("para pegar a mano", () => {
  it("corta el bloque después de agregar un valor a un tipo", () => {
    const pendientes = archivos.map((archivo) => ({ archivo, sql: readFileSync(`supabase/migrations/${archivo}`, "utf8") }));
    const bloques = enBloques(pendientes);
    // Se corta después de la 0005 (rol recepción) y de la 0014 (estados nuevos).
    expect(bloques).toHaveLength(3);
    expect(bloques[0].archivos).toEqual(archivos.slice(0, 5));
    expect(bloques[1].archivos).toEqual(archivos.slice(5, 14));
    expect(bloques[2].archivos).toEqual(archivos.slice(14));
  });
  it("desde la versión 13, lo que falta va en dos pasos (los estados nuevos primero)", () => {
    const pendientes = archivos.slice(13).map((archivo) => ({ archivo, sql: readFileSync(`supabase/migrations/${archivo}`, "utf8") }));
    expect(enBloques(pendientes).map((b) => b.archivos.length)).toEqual([1, 13]);
  });
  it("revisando solo con la API: sabe qué versiones faltan", () => {
    const existe = new Map(VERSIONES.filter((v) => v.rest).map((v, i) => [v.version, i < 8]));
    // Las 8 primeras con sonda llegan hasta la versión 10; faltan 11, 12 y 13.
    expect(faltantesPorRest(existe)).toEqual(VERSIONES.slice(10).map((v) => v.version));
    expect(faltantesPorRest(new Map())).toEqual(VERSIONES.map((v) => v.version));
    expect(faltantesPorRest(new Map(VERSIONES.map((v) => [v.version, true])))).toEqual([]);
  });
});
