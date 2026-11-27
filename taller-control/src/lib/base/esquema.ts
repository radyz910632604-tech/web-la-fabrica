import "server-only";
import { clienteAdmin } from "@/lib/supabase/admin";
import { archivosDeMigracion, estadoActualizador, leerMigracion } from "./aplicar";
import { enBloques, faltantesPorRest, VERSIONES, versionDe } from "./versiones";

/**
 * ¿La base de datos tiene todo lo que esta versión de la app necesita?
 * Si el actualizador automático ya dejó todo al día, no se pregunta nada más.
 * Si no, se revisa con la API que existan las tablas y columnas de cada
 * versión. La respuesta «al día» se recuerda; la de «falta», solo 20 segundos.
 */
let cache: { faltan: string[]; hasta: number } | null = null;

export function olvidarEsquema() {
  cache = null;
}

export async function versionesFaltantes(): Promise<string[]> {
  if (cache && cache.hasta > Date.now()) return cache.faltan;
  const act = estadoActualizador();
  if (act?.modo === "automatico" && !act.error && act.pendientes.length === 0) {
    cache = { faltan: [], hasta: Infinity };
    return [];
  }
  let admin;
  try {
    admin = clienteAdmin();
  } catch {
    return []; // sin llave de servicio no se puede revisar: no se bloquea
  }
  const existe = new Map<string, boolean>();
  let dudoso = false;
  await Promise.all(
    VERSIONES.filter((v) => v.rest).map(async (v) => {
      const [tabla, columna] = v.rest!;
      const { error } = await admin.from(tabla).select(columna).limit(1);
      if (!error) existe.set(v.version, true);
      else if (["PGRST205", "PGRST204", "42P01", "42703"].includes(error.code ?? "")) existe.set(v.version, false);
      else dudoso = true; // problema de red u otro: no se concluye nada
    }),
  );
  if (dudoso) return cache?.faltan ?? [];
  const faltan = faltantesPorRest(existe);
  cache = { faltan, hasta: faltan.length ? Date.now() + 20_000 : Infinity };
  return faltan;
}

/** Lo que falta, listo para pegar en el editor SQL de Supabase (uno o más bloques, en orden). */
export async function bloquesPendientes(): Promise<{ titulo: string; sql: string }[]> {
  const faltan = new Set(await versionesFaltantes());
  if (!faltan.size) return [];
  const archivos = (await archivosDeMigracion()).filter((a) => faltan.has(versionDe(a) ?? ""));
  const pendientes = await Promise.all(archivos.map(async (archivo) => ({ archivo, sql: await leerMigracion(archivo) })));
  const nombre = (archivo: string) => VERSIONES.find((v) => v.version === versionDe(archivo))?.nombre ?? archivo;
  return enBloques(pendientes).map((b) => ({
    titulo: b.archivos.map(nombre).join(" · "),
    sql: `-- Taller Control · actualización de la base de datos. Pegar todo y tocar Run una sola vez.\n${b.sql}`,
  }));
}

/** Dirección del editor SQL del proyecto de Supabase (sale de SUPABASE_URL). */
export function urlEditorSql(): string | null {
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.SUPABASE_URL ?? "")?.[1];
  return ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : null;
}
