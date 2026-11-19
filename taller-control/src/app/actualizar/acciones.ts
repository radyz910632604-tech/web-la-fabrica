"use server";

import { redirect } from "next/navigation";
import { aplicarMigraciones } from "@/lib/base/aplicar";
import { olvidarEsquema } from "@/lib/base/esquema";

/** Vuelve a revisar la base (y, si hay conexión directa, intenta ponerla al día otra vez). */
export async function revisarBase() {
  if (process.env.SUPABASE_DB_URL) await aplicarMigraciones();
  olvidarEsquema();
  redirect("/");
}
