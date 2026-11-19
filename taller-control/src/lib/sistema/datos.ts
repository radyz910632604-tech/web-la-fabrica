import "server-only";
import { pushConfigurado } from "@/lib/avisos/push";
import { estadoActualizador } from "@/lib/base/aplicar";
import { versionesFaltantes } from "@/lib/base/esquema";
import { estadoIa } from "@/lib/ia/proveedor";
import { origenPedido } from "@/lib/origen";
import type { Contexto } from "@/lib/sesion";
import { clienteAdmin } from "@/lib/supabase/admin";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { DatosSistema } from "./estado";

export type FilaRespaldo = { id: string; creadoEn: string; origen: string; modo: "completo" | "datos"; estado: string; bytes: number | null; filas: number | null; error: string | null; descargadoEn: string | null };

/** Reúne el estado del sistema con la sesión de gerencia (la base solo se lo deja ver a gerencia). Quien llama comprueba antes el rol. */
export async function datosDelSistema(ctx: Contexto): Promise<{ datos: DatosSistema; respaldos: FilaRespaldo[] }> {
  const supabase = await clienteServidor();
  const [faltan, { data: taller }, { data: respaldosCrudos }, { data: estado }, { data: miembros }, origen] = await Promise.all([
    versionesFaltantes(),
    supabase.from("empresas").select("ruc, direccion, telefono, correo, logo_ruta").eq("id", ctx.taller.id).maybeSingle(),
    supabase.from("respaldos").select("id, creado_en, origen, modo, estado, tamano_bytes, filas, error, descargado_en").order("creado_en", { ascending: false }).limit(15),
    supabase.from("estado_sistema").select("clave, actualizado_en"),
    supabase.from("miembros").select("perfil_id").eq("empresa_id", ctx.taller.id).eq("activo", true),
    origenPedido(),
  ]);
  const personas = [...new Set((miembros ?? []).map((m) => m.perfil_id as string))];
  // Cada quien solo ve sus propios celulares; para contar los del equipo hace falta la llave de servicio
  // (solo el número, y solo después de comprobar arriba que quien mira es gerencia).
  let celulares = 0;
  if (personas.length && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { count } = await clienteAdmin().from("suscripciones_push").select("id", { count: "exact", head: true }).in("perfil_id", personas);
    celulares = count ?? 0;
  }
  const respaldos: FilaRespaldo[] = (respaldosCrudos ?? []).map((r) => ({
    id: r.id, creadoEn: r.creado_en, origen: r.origen, modo: r.modo, estado: r.estado, bytes: r.tamano_bytes, filas: r.filas, error: r.error, descargadoEn: r.descargado_en,
  }));
  const ultimo = respaldos.find((r) => r.estado === "listo") ?? null;
  const fallo = respaldos.find((r) => r.estado === "fallido") ?? null;
  const descargas = respaldos.map((r) => r.descargadoEn).filter(Boolean).sort() as string[];
  const marca = (clave: string) => (estado ?? []).find((e) => e.clave === clave)?.actualizado_en ?? null;
  const act = estadoActualizador();
  const ia = estadoIa();
  return {
    respaldos,
    datos: {
      ahora: new Date(),
      base: { automatica: act ? act.modo === "automatico" : Boolean(process.env.SUPABASE_DB_URL), faltan: faltan.length, error: act?.modo === "automatico" ? act.error : null },
      respaldo: { ultimo: ultimo ? { creadoEn: ultimo.creadoEn, modo: ultimo.modo } : null, ultimoFallo: fallo ? { creadoEn: fallo.creadoEn, error: fallo.error } : null, ultimaDescarga: descargas.at(-1) ?? null },
      taller: { ruc: Boolean(taller?.ruc), direccion: Boolean(taller?.direccion), telefono: Boolean(taller?.telefono), correo: Boolean(taller?.correo), logo: Boolean(taller?.logo_ruta) },
      avisos: { llaves: pushConfigurado(), celulares, ultimoCiclo: marca("ciclo_interno") },
      whatsapp: { clave: (process.env.CLAVE_API_INTERNA ?? "").length >= 32, ultimoN8n: marca("ciclo_n8n") },
      ia: { lectura: ia.lectura, audio: ia.audio },
      direccion: { https: origen?.https ?? false, host: origen?.host ?? "" },
      personal: { activos: personas.length },
    },
  };
}
