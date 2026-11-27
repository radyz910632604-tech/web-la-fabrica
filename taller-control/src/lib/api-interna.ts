import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * La API interna solo la llama n8n, con la clave secreta CLAVE_API_INTERNA
 * en el encabezado «x-clave-interna». Sin clave configurada, la API está apagada.
 */
export function claveInternaValida(peticion: Request): boolean {
  const esperada = process.env.CLAVE_API_INTERNA ?? "";
  if (esperada.length < 32) return false;
  const recibida = peticion.headers.get("x-clave-interna") ?? "";
  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function noAutorizado(): Response {
  return Response.json({ error: "No autorizado." }, { status: 401 });
}
