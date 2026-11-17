import "server-only";
import { headers } from "next/headers";

/** Dirección con la que se está abriendo la app en este pedido (según el navegador y el proxy de EasyPanel). */
export async function origenPedido(): Promise<{ https: boolean; host: string; url: string } | null> {
  try {
    const h = await headers();
    const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
    const proto = (h.get("x-forwarded-proto") ?? "http").split(",")[0].trim() === "https" ? "https" : "http";
    return { https: proto === "https", host, url: `${proto}://${host}` };
  } catch {
    return null; // fuera de un pedido (por ejemplo, el reloj interno)
  }
}

/**
 * Dirección pública de la app, para enlaces que salen del sistema (el QR de
 * la orden impresa). Si está URL_PUBLICA se usa esa; si no, la del pedido,
 * salvo que sea un nombre interno del servidor (n8n llamando por dentro).
 */
export async function urlPublica(): Promise<string | null> {
  const fija = (process.env.URL_PUBLICA ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(fija)) return fija;
  const o = await origenPedido();
  if (!o) return null;
  const nombre = o.host.replace(/:\d+$/, "");
  if (!nombre.includes(".") && nombre !== "localhost") return null;
  return o.url;
}
