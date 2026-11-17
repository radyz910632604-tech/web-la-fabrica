import "server-only";
import { gzipSync } from "node:zlib";
import { conectar, estadoActualizador } from "@/lib/base/aplicar";
import { VERSIONES } from "@/lib/base/versiones";
import { clienteAdmin } from "@/lib/supabase/admin";
import { respaldosABorrar, rutaRespaldo, TABLAS_AUTH, TABLAS_EXCLUIDAS, TABLAS_PUBLICAS, tocaRespaldo, type ArchivoRespaldo } from "./tablas";

/**
 * Copia de seguridad de la base: todas las tablas del taller en un archivo
 * comprimido, guardado en el bucket privado «respaldos».
 *  - «completo» (con SUPABASE_DB_URL): incluye los accesos de las personas
 *    con su contraseña cifrada; se puede restaurar tal cual.
 *  - «datos» (sin conexión directa): todo menos las contraseñas; al
 *    restaurar hay que asignar contraseñas nuevas.
 * Las fotos y los PDF subidos no entran: están en el almacenamiento de Supabase.
 * Corre sin sesión (es un proceso programado), por eso usa la llave de servicio.
 */

export type ResultadoRespaldo = { ok: true; id: string; modo: "completo" | "datos"; filas: number; bytes: number } | { ok: false; error: string };

// En globalThis: la copia automática (reloj) y la manual (pantalla) se empaquetan aparte.
const marca = globalThis as { __respaldoTaller?: boolean };

async function leerConBase(): Promise<ArchivoRespaldo["tablas"] | null> {
  let cliente: Awaited<ReturnType<typeof conectar>> = null;
  try {
    cliente = await conectar();
    if (!cliente) return null;
    const tablas: ArchivoRespaldo["tablas"] = {};
    const { rows } = await cliente.query<{ t: string }>("select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1");
    const nombres = [...TABLAS_AUTH.map((t) => `auth.${t}`), ...rows.map((r) => `public.${r.t}`).filter((n) => !TABLAS_EXCLUIDAS.some((x) => n === `public.${x}`))];
    for (const n of nombres) {
      const [esquema, tabla] = n.split(".");
      const r = await cliente.query<{ fila: Record<string, unknown> }>(`select to_jsonb(t) as fila from "${esquema}"."${tabla}" t`);
      tablas[n] = r.rows.map((x) => x.fila);
    }
    return tablas;
  } finally {
    await cliente?.end().catch(() => {});
  }
}

async function leerConApi(): Promise<ArchivoRespaldo["tablas"]> {
  const admin = clienteAdmin();
  const tablas: ArchivoRespaldo["tablas"] = {};
  for (const t of TABLAS_PUBLICAS) {
    const filas: Record<string, unknown>[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await admin.from(t).select("*").range(desde, desde + 999);
      if (error) throw new Error(`No se pudo leer ${t}: ${error.message}`);
      filas.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    tablas[`public.${t}`] = filas;
  }
  return tablas;
}

export async function hacerRespaldo(origen: "automatico" | "manual", ahora = new Date()): Promise<ResultadoRespaldo> {
  if (marca.__respaldoTaller) return { ok: false, error: "Ya hay una copia en curso. Espera un momento." };
  marca.__respaldoTaller = true;
  const admin = clienteAdmin();
  try {
    let modo: "completo" | "datos" = "datos";
    let tablas: ArchivoRespaldo["tablas"] | null = null;
    if (process.env.SUPABASE_DB_URL) {
      try {
        tablas = await leerConBase();
        if (tablas) modo = "completo";
      } catch (e) {
        console.error("[respaldo] Sin conexión directa, se hace por la API:", e instanceof Error ? e.message : e);
      }
    }
    tablas ??= await leerConApi();
    const act = estadoActualizador();
    const archivo: ArchivoRespaldo = {
      formato: "taller-control-respaldo",
      version: 1,
      creado_en: ahora.toISOString(),
      modo,
      versiones_base: act?.modo === "automatico" ? VERSIONES.map((v) => v.version).filter((v) => !act.pendientes.some((p) => p.startsWith(v))) : VERSIONES.map((v) => v.version),
      tablas,
    };
    const filas = Object.values(tablas).reduce((a, t) => a + t.length, 0);
    const comprimido = gzipSync(Buffer.from(JSON.stringify(archivo)));
    const ruta = rutaRespaldo(ahora);
    const { error: eSubir } = await admin.storage.from("respaldos").upload(ruta, comprimido, { contentType: "application/gzip", upsert: true });
    if (eSubir) throw new Error(`No se pudo guardar el archivo: ${eSubir.message}`);
    const { data, error } = await admin
      .from("respaldos")
      .insert({ origen, modo, ruta, tamano_bytes: comprimido.length, tablas: Object.keys(tablas).length, filas, creado_en: ahora.toISOString() })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo anotar la copia: ${error?.message}`);
    await limpiar(ahora);
    return { ok: true, id: data.id, modo, filas, bytes: comprimido.length };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 900);
    await admin.from("respaldos").insert({ origen, modo: "datos", estado: "fallido", error, creado_en: ahora.toISOString() }).then(() => {}, () => {});
    console.error("[respaldo] Falló la copia de seguridad:", error);
    return { ok: false, error };
  } finally {
    marca.__respaldoTaller = false;
  }
}

async function limpiar(ahora: Date) {
  const admin = clienteAdmin();
  const { data } = await admin.from("respaldos").select("id, ruta, creado_en").eq("estado", "listo").order("creado_en", { ascending: false }).limit(400);
  const viejos = respaldosABorrar(data ?? [], ahora);
  if (!viejos.length) return;
  await admin.storage.from("respaldos").remove(viejos.map((v) => v.ruta).filter(Boolean) as string[]);
  await admin.from("respaldos").delete().in("id", viejos.map((v) => v.id));
  // Los intentos fallidos de hace más de 30 días tampoco hacen falta.
  await admin.from("respaldos").delete().eq("estado", "fallido").lt("creado_en", new Date(ahora.getTime() - 30 * 86_400_000).toISOString());
}

/** Lo llama el reloj interno cada 5 minutos: hace la copia del día cuando toca. */
export async function respaldoSiToca(ahora = new Date()): Promise<ResultadoRespaldo | null> {
  const admin = clienteAdmin();
  const { data: ultimo } = await admin.from("respaldos").select("creado_en").eq("estado", "listo").order("creado_en", { ascending: false }).limit(1).maybeSingle();
  // Si acaba de fallar, no se reintenta cada 5 minutos: se espera una hora.
  const { data: fallo } = await admin.from("respaldos").select("creado_en").eq("estado", "fallido").order("creado_en", { ascending: false }).limit(1).maybeSingle();
  if (fallo && ahora.getTime() - new Date(fallo.creado_en).getTime() < 3_600_000 && (!ultimo || fallo.creado_en > ultimo.creado_en)) return null;
  if (!tocaRespaldo(ahora, ultimo ? new Date(ultimo.creado_en) : null)) return null;
  const r = await hacerRespaldo("automatico", ahora);
  if (!r.ok) await avisarFallo(ahora).catch(() => {});
  return r;
}

/** Si la copia automática falla, gerencia recibe un aviso en su celular (uno por día). El ciclo de avisos lo envía. */
async function avisarFallo(ahora: Date) {
  const admin = clienteAdmin();
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(ahora);
  const { data } = await admin.from("miembros").select("perfil_id, empresa_id").eq("rol", "gerencia").eq("activo", true);
  const vistos = new Set<string>();
  const filas = (data ?? [])
    .filter((m) => !vistos.has(m.perfil_id) && vistos.add(m.perfil_id))
    .map((m) => ({
      empresa_id: m.empresa_id, tipo: "respaldo_fallido", destino: "personal", perfil_id: m.perfil_id, canal: "push",
      titulo: "No se hizo la copia de seguridad", texto: "La copia automática falló. Entra a Estado del sistema para ver el motivo y hacer una a mano.",
      enlace: "/sistema", clave_unica: `respaldo-fallido:${dia}:${m.perfil_id}`,
    }));
  if (filas.length) await admin.from("avisos").upsert(filas, { onConflict: "clave_unica", ignoreDuplicates: true });
}
