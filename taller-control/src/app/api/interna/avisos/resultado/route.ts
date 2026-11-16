import { z } from "zod";
import { claveInternaValida, noAutorizado } from "@/lib/api-interna";
import { registrarEnvios } from "@/lib/avisos/ciclo";

/** POST /api/interna/avisos/resultado — n8n informa si cada WhatsApp salió. */
const esquema = z.object({ resultados: z.array(z.object({ id: z.string().uuid(), ok: z.boolean(), error: z.string().max(500).optional() })).max(200) });

export async function POST(peticion: Request) {
  if (!claveInternaValida(peticion)) return noAutorizado();
  const r = esquema.safeParse(await peticion.json().catch(() => null));
  if (!r.success) return Response.json({ error: "Datos incompletos." }, { status: 400 });
  await registrarEnvios(r.data.resultados);
  return Response.json({ ok: true });
}
