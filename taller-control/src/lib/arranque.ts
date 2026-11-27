import { aplicarMigraciones } from "./base/aplicar";

/**
 * Lo que la app hace una sola vez al arrancar, antes de atender a nadie:
 * poner la base de datos al día (si hay conexión directa) y encender el
 * reloj interno (avisos y copia de seguridad diaria).
 */
export async function arrancar() {
  const r = await aplicarMigraciones();
  if (r.modo === "manual") {
    console.log("[base] Sin SUPABASE_DB_URL: la base no se actualiza sola. Si falta algo, la app lo avisa a gerencia.");
  } else {
    if (r.detectadas.length) console.log(`[base] Ya estaban aplicadas: ${r.detectadas.length}.`);
    if (r.aplicadas.length) console.log(`[base] Aplicadas ahora: ${r.aplicadas.join(", ")}.`);
    if (r.error) console.error(`[base] NO se pudo actualizar la base. ${r.error}`);
    else if (!r.aplicadas.length) console.log("[base] La base de datos está al día.");
  }
  const { encenderReloj } = await import("./reloj");
  encenderReloj();
}
