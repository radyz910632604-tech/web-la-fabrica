import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { respaldosABorrar, rutaRespaldo, TABLAS_EXCLUIDAS, TABLAS_PUBLICAS, tocaRespaldo } from "@/lib/respaldo/tablas";
import { puntosDelSistema, resumenSistema, type DatosSistema } from "@/lib/sistema/estado";

const ahora = new Date("2026-11-17T15:00:00-05:00");
const hace = (horas: number) => new Date(ahora.getTime() - horas * 3_600_000).toISOString();

const todoBien: DatosSistema = {
  ahora,
  base: { automatica: true, faltan: 0 },
  respaldo: { ultimo: { creadoEn: hace(11), modo: "completo" }, ultimoFallo: null, ultimaDescarga: hace(48) },
  taller: { ruc: true, direccion: true, telefono: true, correo: true, logo: true },
  avisos: { llaves: true, celulares: 4, ultimoCiclo: hace(0.05) },
  whatsapp: { clave: true, ultimoN8n: hace(0.2) },
  ia: { lectura: true, audio: true },
  direccion: { https: true, host: "taller.ejemplo.pe" },
  personal: { activos: 6 },
};
const punto = (d: DatosSistema, clave: string) => puntosDelSistema(d).find((p) => p.clave === clave)!;

describe("estado del sistema", () => {
  it("con todo conectado, todo sale listo", () => {
    const puntos = puntosDelSistema(todoBien);
    expect(puntos.map((p) => p.estado)).toEqual(Array(8).fill("listo"));
    expect(resumenSistema(puntos)).toEqual({ listos: 8, total: 8, urgentes: 0 });
  });

  it("base: manual es mejorable, atrasada o con error es falta", () => {
    expect(punto({ ...todoBien, base: { automatica: false, faltan: 0 } }, "base").estado).toBe("atencion");
    expect(punto({ ...todoBien, base: { automatica: false, faltan: 2 } }, "base")).toMatchObject({ estado: "falta", detalle: "Faltan 2 actualizaciones." });
    expect(punto({ ...todoBien, base: { automatica: true, faltan: 0, error: "password authentication failed" } }, "base").estado).toBe("falta");
  });

  it("copias: sin copia, vieja o fallida es falta; sin bajar en una semana es mejorable", () => {
    const con = (respaldo: DatosSistema["respaldo"]) => punto({ ...todoBien, respaldo }, "respaldo");
    expect(con({ ultimo: null, ultimoFallo: null, ultimaDescarga: null }).estado).toBe("falta");
    expect(con({ ultimo: { creadoEn: hace(60), modo: "completo" }, ultimoFallo: null, ultimaDescarga: hace(24) }).estado).toBe("falta");
    expect(con({ ultimo: { creadoEn: hace(30), modo: "completo" }, ultimoFallo: { creadoEn: hace(2), error: "sin espacio" }, ultimaDescarga: hace(24) })).toMatchObject({ estado: "falta" });
    // Un fallo viejo, ya superado por una copia buena, no molesta.
    expect(con({ ultimo: { creadoEn: hace(3), modo: "completo" }, ultimoFallo: { creadoEn: hace(30), error: "x" }, ultimaDescarga: hace(24) }).estado).toBe("listo");
    expect(con({ ultimo: { creadoEn: hace(3), modo: "completo" }, ultimoFallo: null, ultimaDescarga: null }).detalle).toContain("nunca bajaste una");
    expect(con({ ultimo: { creadoEn: hace(3), modo: "completo" }, ultimoFallo: null, ultimaDescarga: hace(9 * 24) }).estado).toBe("atencion");
    expect(con({ ultimo: { creadoEn: hace(3), modo: "datos" }, ultimoFallo: null, ultimaDescarga: hace(24) })).toMatchObject({ estado: "atencion", detalle: expect.stringContaining("sin las contraseñas") });
  });

  it("datos del taller: dice exactamente qué falta", () => {
    expect(punto({ ...todoBien, taller: { ...todoBien.taller, correo: false, logo: false } }, "taller")).toMatchObject({ estado: "falta", detalle: expect.stringContaining("Falta: correo, logo.") });
  });

  it("avisos: sin llaves es falta; sin celulares o con el reloj parado, mejorable", () => {
    expect(punto({ ...todoBien, avisos: { llaves: false, celulares: 0, ultimoCiclo: null } }, "avisos").estado).toBe("falta");
    expect(punto({ ...todoBien, avisos: { llaves: true, celulares: 0, ultimoCiclo: hace(0.05) } }, "avisos").estado).toBe("atencion");
    expect(punto({ ...todoBien, avisos: { llaves: true, celulares: 3, ultimoCiclo: hace(5) } }, "avisos")).toMatchObject({ estado: "atencion", detalle: "El reloj de avisos no corre desde hace 5 h." });
    expect(punto(todoBien, "avisos").detalle).toContain("4 celulares activados");
  });

  it("WhatsApp y la IA son opcionales: no cuentan como pendientes", () => {
    const d: DatosSistema = { ...todoBien, whatsapp: { clave: false, ultimoN8n: null }, ia: { lectura: false, audio: false } };
    const puntos = puntosDelSistema(d);
    expect(punto(d, "whatsapp").estado).toBe("opcional");
    expect(punto(d, "ia").estado).toBe("opcional");
    expect(resumenSistema(puntos)).toEqual({ listos: 6, total: 6, urgentes: 0 });
    expect(punto({ ...todoBien, whatsapp: { clave: true, ultimoN8n: hace(3) } }, "whatsapp").estado).toBe("atencion");
  });

  it("dirección: sin candado es falta, la de prueba es mejorable, la local no cuenta", () => {
    expect(punto({ ...todoBien, direccion: { https: false, host: "179.0.0.1" } }, "direccion").estado).toBe("falta");
    expect(punto({ ...todoBien, direccion: { https: true, host: "corporacion-taller.abc.easypanel.host" } }, "direccion").estado).toBe("atencion");
    expect(punto({ ...todoBien, direccion: { https: false, host: "localhost:3000" } }, "direccion").estado).toBe("opcional");
  });

  it("personal: avisa si solo hay una persona", () => {
    expect(punto({ ...todoBien, personal: { activos: 1 } }, "personal").estado).toBe("atencion");
  });
});

describe("copias de seguridad", () => {
  it("el archivo se llama con la fecha y hora de Lima", () => {
    expect(rutaRespaldo(new Date("2026-11-17T08:10:00Z"))).toBe("2026/2026-11-17-0310.json.gz");
    // 3 a. m. UTC todavía es el día anterior en Lima
    expect(rutaRespaldo(new Date("2027-01-01T03:00:00Z"))).toBe("2026/2026-12-31-2200.json.gz");
  });

  it("toca de madrugada si la última tiene más de 20 horas", () => {
    const madrugada = new Date("2026-11-17T03:10:00-05:00");
    expect(tocaRespaldo(madrugada, null)).toBe(true);
    expect(tocaRespaldo(madrugada, new Date("2026-11-16T03:05:00-05:00"))).toBe(true);
    expect(tocaRespaldo(madrugada, new Date("2026-11-16T22:00:00-05:00"))).toBe(false); // se hizo una a pedido anoche
    const tarde = new Date("2026-11-17T15:00:00-05:00");
    expect(tocaRespaldo(tarde, new Date("2026-11-16T16:00:00-05:00"))).toBe(false); // de día no, espera a la madrugada
    expect(tocaRespaldo(tarde, new Date("2026-11-15T22:00:00-05:00"))).toBe(true); // 41 horas: el servidor estuvo apagado
  });

  it("borra las de más de 30 días, pero siempre deja las 7 más nuevas", () => {
    const dia = (n: number) => ({ id: n, creado_en: new Date(ahora.getTime() - n * 86_400_000).toISOString() });
    const lista = [1, 2, 3, 10, 20, 29, 31, 40, 50, 60].map(dia);
    expect(respaldosABorrar(lista, ahora).map((r) => r.id)).toEqual([40, 50, 60]);
    // Si el servidor estuvo meses apagado, no se queda sin copias.
    expect(respaldosABorrar([40, 50, 60, 70].map(dia), ahora)).toEqual([]);
  });

  it("la lista de tablas de la copia coincide con las tablas de la base", () => {
    const carpeta = join(process.cwd(), "supabase", "migrations");
    const creadas = new Set<string>();
    for (const archivo of readdirSync(carpeta).filter((f) => f.endsWith(".sql"))) {
      for (const m of readFileSync(join(carpeta, archivo), "utf8").matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) creadas.add(m[1]);
    }
    const esperadas = [...creadas].filter((t) => !(TABLAS_EXCLUIDAS as readonly string[]).includes(t)).sort();
    expect([...TABLAS_PUBLICAS].sort()).toEqual(esperadas);
  });
});
