"use server";

import { randomUUID } from "node:crypto";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import type { ComprobanteLeido } from "./esquemas";
import { leerComprobante, MIMES_DOCUMENTO } from "./proveedor";

export type LecturaIa = { datos?: ComprobanteLeido; archivo?: string; error?: string };

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };

/**
 * Lee con IA la foto o el PDF de un comprobante y guarda el archivo original
 * (con la sesión de quien lo sube). Devuelve los datos para llenar el
 * formulario: la persona los revisa y lo que registre queda «por confirmar».
 */
export async function leerDocumentoConIa(form: FormData): Promise<LecturaIa> {
  const ctx = await obtenerContexto();
  const pista = form.get("pista") === "venta" ? "venta" : "compra";
  const permitido = pista === "compra" ? tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"]) : tieneAlguno(ctx.roles, CAJA);
  if (!permitido) return { error: "Tu rol no registra este tipo de comprobante." };
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige la foto o el PDF." };
  if (!MIMES_DOCUMENTO.includes(archivo.type)) return { error: "Sube una foto (JPG, PNG o WEBP) o un PDF." };

  const datos = Buffer.from(await archivo.arrayBuffer());
  const r = await leerComprobante({ datos, mime: archivo.type, nombre: archivo.name }, pista);
  if (!r.ok) return { error: r.error };
  if (!r.datos.es_comprobante) return { error: "Eso no parece una factura, boleta ni ticket. Prueba con otra foto." };
  if (r.datos.legible === "no_se_lee") return { error: "La IA no pudo leer el comprobante. Toma la foto de frente, con buena luz, o regístralo a mano." };

  const ruta = `${ctx.taller.id}/${pista === "compra" ? "compras" : "ventas"}/${randomUUID()}.${EXTENSION[archivo.type] ?? "bin"}`;
  const supabase = await clienteServidor();
  const { error } = await supabase.storage.from("comprobantes").upload(ruta, datos, { contentType: archivo.type, upsert: false });
  return { datos: r.datos, archivo: error ? undefined : ruta };
}

/** Enlace temporal (10 minutos) para ver el archivo de un comprobante. */
export async function enlaceArchivo(ruta: string): Promise<string | null> {
  const ctx = await obtenerContexto();
  if (!ruta.startsWith(`${ctx.taller.id}/`)) return null;
  const supabase = await clienteServidor();
  const { data } = await supabase.storage.from("comprobantes").createSignedUrl(ruta, 600);
  return data?.signedUrl ?? null;
}
