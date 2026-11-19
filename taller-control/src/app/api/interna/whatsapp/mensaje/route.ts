import { z } from "zod";
import { claveInternaValida, noAutorizado } from "@/lib/api-interna";
import { procesarMensaje } from "@/lib/whatsapp/procesar";

/**
 * POST /api/interna/whatsapp/mensaje — lo llama n8n por cada mensaje que
 * llega a WhatsApp (con la firma de Meta ya validada y el archivo descargado).
 * Responde el texto y los botones que n8n debe enviar de vuelta.
 */
const esquema = z.object({
  wa_id: z.string().min(4).max(200),
  celular: z.string().min(8).max(20),
  nombre: z.string().max(120).optional(),
  tipo: z.enum(["texto", "audio", "imagen", "documento", "video", "boton", "otro"]),
  texto: z.string().max(4000).optional(),
  boton_id: z.string().max(100).optional(),
  media: z.object({ base64: z.string().max(23_000_000), mime: z.string().max(100), nombre: z.string().max(200).optional() }).optional(),
});

export async function POST(peticion: Request) {
  if (!claveInternaValida(peticion)) return noAutorizado();
  let cuerpo: unknown;
  try {
    cuerpo = await peticion.json();
  } catch {
    return Response.json({ error: "JSON no válido." }, { status: 400 });
  }
  const r = esquema.safeParse(cuerpo);
  if (!r.success) return Response.json({ error: "Datos incompletos.", detalle: r.error.issues.slice(0, 3).map((i) => i.path.join(".")) }, { status: 400 });
  const salida = await procesarMensaje(r.data);
  // «para»: a qué número responder (n8n lo usa tal cual).
  return Response.json({ ...salida, para: r.data.celular.replace(/^\+/, "") });
}
