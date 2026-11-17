"use server";

import { revalidatePath } from "next/cache";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type ResultadoFirma = { ok?: string; error?: string };

/**
 * Guarda la firma del cliente (imagen PNG dibujada con el dedo).
 * Se sube con la sesión de quien la toma y la base valida el permiso:
 * al dejar el carro, el asesor; al recogerlo, quien atiende la caja.
 */
export async function guardarFirma(ordenId: string, etapa: "ingreso" | "entrega", form: FormData): Promise<ResultadoFirma> {
  const ctx = await obtenerContexto();
  if (!/^[0-9a-f-]{36}$/.test(ordenId) || !["ingreso", "entrega"].includes(etapa)) return { error: "Datos no válidos." };
  const archivo = form.get("firma");
  if (!(archivo instanceof File) || archivo.size < 200) return { error: "La firma está vacía. Pide al cliente que firme en el recuadro." };
  if (archivo.type !== "image/png" || archivo.size > 1024 * 1024) return { error: "La firma no se pudo leer. Intenta de nuevo." };
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return { error: "La firma no se pudo leer. Intenta de nuevo." };

  const supabase = await clienteServidor();
  const ruta = `${ctx.taller.id}/${ordenId}/firma-${etapa}-${crypto.randomUUID()}.png`;
  const { error: eSubir } = await supabase.storage.from("ordenes").upload(ruta, bytes, { contentType: "image/png", upsert: false });
  if (eSubir) return { error: etapa === "ingreso" ? "Solo el asesor toma la firma de ingreso." : "No tienes permiso para tomar la firma de esta orden." };
  const { error } = await supabase.rpc("registrar_firma", { p_orden: ordenId, p_etapa: etapa, p_ruta: ruta });
  if (error) return { error: error.message || "No se pudo guardar la firma." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: "Firma guardada. Ya sale en el PDF." };
}
