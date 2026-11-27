import "server-only";
import { clienteAdmin } from "@/lib/supabase/admin";
import { versionesFaltantes } from "./esquema";

/**
 * ¿Se puede instalar? Solo si el dueño puso CLAVE_INSTALACION (12 letras o
 * más), la base ya tiene sus tablas y todavía no existe ninguna persona.
 */
export async function instalacionAbierta(): Promise<"apagada" | "falta_base" | "ya_instalado" | "abierta"> {
  if ((process.env.CLAVE_INSTALACION ?? "").length < 12) return "apagada";
  if ((await versionesFaltantes()).length) return "falta_base";
  const { count, error } = await clienteAdmin().from("perfiles").select("id", { count: "exact", head: true });
  if (error) return "falta_base";
  return (count ?? 0) > 0 ? "ya_instalado" : "abierta";
}
