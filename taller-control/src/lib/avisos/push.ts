import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNotification, setVapidDetails } from "web-push";

/**
 * Notificaciones push de la app instalada (PWA). Gratis: no pasan por
 * WhatsApp. Necesitan las llaves VAPID_PUBLICA y VAPID_PRIVADA (se generan
 * una vez con `npx web-push generate-vapid-keys`).
 */
export function pushConfigurado(): boolean {
  return Boolean(process.env.VAPID_PUBLICA && process.env.VAPID_PRIVADA);
}

let listo = false;
function preparar() {
  if (listo) return;
  setVapidDetails(process.env.VAPID_CONTACTO || "mailto:avisos@taller-control.invalid", process.env.VAPID_PUBLICA!, process.env.VAPID_PRIVADA!);
  listo = true;
}

/** Envía un aviso a todos los dispositivos de una persona. Borra los que ya no existen. */
export async function pushAPersona(admin: SupabaseClient, perfilId: string, aviso: { titulo: string; texto: string; enlace?: string | null }): Promise<{ enviados: number }> {
  if (!pushConfigurado()) return { enviados: 0 };
  preparar();
  const { data: subs } = await admin.from("suscripciones_push").select("id, endpoint, p256dh, auth").eq("perfil_id", perfilId);
  let enviados = 0;
  for (const s of subs ?? []) {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ titulo: aviso.titulo, texto: aviso.texto, enlace: aviso.enlace ?? "/" }), { TTL: 6 * 3600 });
      enviados++;
      await admin.from("suscripciones_push").update({ ultimo_envio: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode;
      if (codigo === 404 || codigo === 410) await admin.from("suscripciones_push").delete().eq("id", s.id);
    }
  }
  return { enviados };
}
