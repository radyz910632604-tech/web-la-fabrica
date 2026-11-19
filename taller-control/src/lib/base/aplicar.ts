import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { planear, VERSIONES, versionDe } from "./versiones";

/**
 * Actualizador de la base de datos. Al arrancar la app (y solo si está
 * SUPABASE_DB_URL), aplica los archivos de supabase/migrations que falten,
 * cada uno en su propia transacción, y anota lo hecho en
 * mantenimiento.migraciones. Lo que se pegó antes a mano se reconoce y solo
 * se anota. Si algo falla, no se aplica nada de ese archivo y la app avisa.
 */

export type ResultadoBase =
  | { modo: "manual" }
  | { modo: "automatico"; aplicadas: string[]; detectadas: string[]; pendientes: string[]; error?: string; revisadoEn: string };

const CARPETA = join(process.cwd(), "supabase", "migrations");
// En globalThis: el arranque (instrumentation) y las páginas se empaquetan aparte y no comparten variables del archivo.
const memoria = globalThis as { __baseTaller?: ResultadoBase | null };
const anotar = (r: ResultadoBase) => (memoria.__baseTaller = r);
export const estadoActualizador = (): ResultadoBase | null => memoria.__baseTaller ?? null;

export async function archivosDeMigracion(): Promise<string[]> {
  try {
    return (await readdir(CARPETA)).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  } catch {
    return [];
  }
}
export const leerMigracion = (archivo: string) => readFile(join(CARPETA, archivo), "utf8");

/** Conexión directa a Postgres. La contraseña puede venir aparte (SUPABASE_DB_PASSWORD) para no tener que codificarla en la dirección. */
export async function conectar() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) return null;
  const { Client } = await import("pg");
  const destino = new URL(url);
  const local = ["localhost", "127.0.0.1", "host.docker.internal"].includes(destino.hostname);
  const ca = process.env.SUPABASE_DB_CA;
  const cliente = new Client({
    host: destino.hostname,
    port: Number(destino.port || 5432),
    user: decodeURIComponent(destino.username),
    password: process.env.SUPABASE_DB_PASSWORD || decodeURIComponent(destino.password),
    database: destino.pathname.replace(/^\//, "") || "postgres",
    // Supabase firma con su propia autoridad: con SUPABASE_DB_CA se verifica; sin ella, la conexión va cifrada sin verificar.
    ssl: local ? undefined : ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    statement_timeout: 120_000,
    application_name: "taller-control",
  });
  await cliente.connect();
  return cliente;
}

export async function aplicarMigraciones(): Promise<ResultadoBase> {
  if (!process.env.SUPABASE_DB_URL) return anotar({ modo: "manual" });
  const r: Extract<ResultadoBase, { modo: "automatico" }> = { modo: "automatico", aplicadas: [], detectadas: [], pendientes: [], revisadoEn: new Date().toISOString() };
  let cliente: Awaited<ReturnType<typeof conectar>> = null;
  try {
    cliente = await conectar();
    if (!cliente) return anotar({ modo: "manual" });
    // Un solo actualizador a la vez (por si arrancan dos copias de la app).
    await cliente.query("select pg_advisory_lock(hashtext('taller-control-migraciones'))");
    await cliente.query(`
      create schema if not exists mantenimiento;
      create table if not exists mantenimiento.migraciones (
        version text primary key,
        archivo text not null,
        modo text not null check (modo in ('aplicada', 'detectada')),
        aplicada_en timestamptz not null default now()
      );
    `);
    const archivos = await archivosDeMigracion();
    const { rows } = await cliente.query<{ version: string }>("select version from mantenimiento.migraciones");
    const anotadas = new Set(rows.map((x) => x.version));
    const sondas = new Map<string, boolean>();
    for (const v of VERSIONES) {
      if (anotadas.has(v.version)) continue;
      const s = await cliente.query(v.sql);
      sondas.set(v.version, Object.values(s.rows[0] ?? {})[0] === true);
    }
    const plan = planear(archivos, anotadas, sondas);
    for (const archivo of plan.detectadas) {
      await cliente.query("insert into mantenimiento.migraciones (version, archivo, modo) values ($1, $2, 'detectada') on conflict do nothing", [versionDe(archivo), archivo]);
      r.detectadas.push(archivo);
    }
    r.pendientes = [...plan.porAplicar];
    for (const archivo of plan.porAplicar) {
      const sql = await leerMigracion(archivo);
      try {
        await cliente.query("begin");
        await cliente.query(sql);
        await cliente.query("insert into mantenimiento.migraciones (version, archivo, modo) values ($1, $2, 'aplicada')", [versionDe(archivo), archivo]);
        await cliente.query("commit");
      } catch (e) {
        await cliente.query("rollback").catch(() => {});
        r.error = `${archivo}: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
      r.aplicadas.push(archivo);
      r.pendientes = r.pendientes.filter((x) => x !== archivo);
    }
    // La API de Supabase vuelve a leer la estructura.
    if (r.aplicadas.length) await cliente.query("notify pgrst, 'reload schema'").catch(() => {});
  } catch (e) {
    r.error = `No se pudo conectar a la base: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    await cliente?.query("select pg_advisory_unlock(hashtext('taller-control-migraciones'))").catch(() => {});
    await cliente?.end().catch(() => {});
  }
  return anotar(r);
}
