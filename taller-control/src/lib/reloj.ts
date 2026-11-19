/**
 * Reloj interno de la app: cada 5 minutos arma los avisos que tocan y envía
 * los que van al celular (push), sin depender de n8n. Una vez al día, de
 * madrugada, guarda la copia de seguridad.
 *
 * Solo corre en producción (o con RELOJ_INTERNO=si para probar). Si la base
 * está atrasada o falta la llave de servicio, espera sin hacer nada.
 */
const CADA_MS = 5 * 60_000;
const marca = globalThis as { __relojTaller?: ReturnType<typeof setInterval> };

export async function tic(ahora = new Date()) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { omitido: "sin llave de servicio" } as const;
  const { versionesFaltantes } = await import("./base/esquema");
  if ((await versionesFaltantes()).length) return { omitido: "base atrasada" } as const;
  const { cicloDeAvisos } = await import("./avisos/ciclo");
  const avisos = await cicloDeAvisos(ahora, "interno");
  const { respaldoSiToca } = await import("./respaldo/copia");
  const respaldo = await respaldoSiToca(ahora);
  return { avisos, respaldo } as const;
}

export function encenderReloj() {
  if (marca.__relojTaller) return;
  if (process.env.NODE_ENV !== "production" && process.env.RELOJ_INTERNO !== "si") return;
  const seguro = () => tic().catch((e) => console.error("[reloj] El ciclo falló:", e instanceof Error ? e.message : e));
  setTimeout(seguro, 30_000).unref?.();
  marca.__relojTaller = setInterval(seguro, CADA_MS);
  marca.__relojTaller.unref?.();
  console.log("[reloj] Encendido: avisos cada 5 minutos y copia de seguridad diaria.");
}
