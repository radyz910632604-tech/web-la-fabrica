import { describe, expect, it } from "vitest";
import { aplicarMigraciones } from "@/lib/base/aplicar";

/**
 * Prueba de punta a punta del actualizador contra una base real.
 * Solo corre si se pasa PRUEBA_DB_URL (la base local de Supabase):
 *   PRUEBA_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run tests/base-actualizador.int.test.ts
 * ESPERA_APLICADAS dice cuántos archivos se espera que aplique esta vez.
 */
describe.skipIf(!process.env.PRUEBA_DB_URL)("actualizador contra la base", () => {
  it("deja la base al día y la segunda vez no hace nada", async () => {
    process.env.SUPABASE_DB_URL = process.env.PRUEBA_DB_URL;
    const r1 = await aplicarMigraciones();
    if (r1.modo !== "automatico") throw new Error("Debió correr en modo automático");
    console.log(JSON.stringify({ aplicadas: r1.aplicadas.length, detectadas: r1.detectadas.length, pendientes: r1.pendientes, error: r1.error }));
    expect(r1.error).toBeUndefined();
    expect(r1.pendientes).toEqual([]);
    if (process.env.ESPERA_APLICADAS) expect(r1.aplicadas).toHaveLength(Number(process.env.ESPERA_APLICADAS));
    const r2 = await aplicarMigraciones();
    if (r2.modo !== "automatico") throw new Error("Debió correr en modo automático");
    expect(r2).toMatchObject({ aplicadas: [], detectadas: [], pendientes: [] });
  }, 120_000);
});
