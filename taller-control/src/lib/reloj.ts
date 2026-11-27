/**
 * Reloj interno de la app: cada 5 minutos arma los avisos que tocan y envía
 * los que van al celular (push), sin depender de n8n. Pasada la medianoche
 * hace el corte de cajas, y de madrugada guarda la copia de seguridad.
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
  // Corte de medianoche de las cajas (cierra lo olvidado y arma la Caja Maestra del día anterior).
  const { corteSiToca } = await import("./caja/corte");
  const cajas = await corteSiToca(ahora).catch((e) => (console.error("[reloj] Corte de cajas:", e instanceof Error ? e.message : e), null));
  const { respaldoSiToca } = await import("./respaldo/copia");
  const respaldo = await respaldoSiToca(ahora);
  return { avisos, cajas, respaldo } as const;
}

export function encenderReloj() {
  if (marca.__relojTaller) return;
  if (process.env.NODE_ENV !== "production" && process.env.RELOJ_INTERNO !== "si") return;
  const seguro = () => tic().catch((e) => console.error("[reloj] El ciclo falló:", e instanceof Error ? e.message : e));
  setTimeout(seguro, 30_000).unref?.();
  marca.__relojTaller = setInterval(seguro, CADA_MS);
  marca.__relojTaller.unref?.();
  console.log("[reloj] Encendido: avisos cada 5 minutos, corte de cajas a medianoche y copia de seguridad diaria.");
}
