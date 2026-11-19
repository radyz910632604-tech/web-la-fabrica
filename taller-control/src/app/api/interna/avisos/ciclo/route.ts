import { claveInternaValida, noAutorizado } from "@/lib/api-interna";
import { cicloDeAvisos } from "@/lib/avisos/ciclo";

/**
 * POST /api/interna/avisos/ciclo — n8n lo llama cada 15 minutos.
 * Devuelve los WhatsApp pendientes (con su plantilla y variables) para que
 * n8n los mande. Los avisos al celular ya los envía el reloj interno de la
 * app cada 5 minutos; si n8n llama, no se repiten.
 */
export async function POST(peticion: Request) {
  if (!claveInternaValida(peticion)) return noAutorizado();
  // Solo en pruebas locales se puede simular la hora (para probar los resúmenes).
  const simulada = process.env.NODE_ENV !== "production" ? new URL(peticion.url).searchParams.get("ahora") : null;
  return Response.json(await cicloDeAvisos(simulada ? new Date(simulada) : new Date(), "n8n"));
}
