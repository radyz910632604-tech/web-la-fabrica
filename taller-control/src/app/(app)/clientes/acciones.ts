"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizarCelular } from "@/lib/celulares";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type Resultado = { ok?: string; error?: string; errores?: Record<string, string>; id?: string };

const DOCUMENTO: Record<string, RegExp> = { dni: /^\d{8}$/, ruc: /^(10|15|17|20)\d{9}$/, ce: /^[A-Z0-9]{6,12}$/ };
const MENSAJE_DOC: Record<string, string> = { dni: "El DNI tiene 8 números.", ruc: "El RUC tiene 11 números y empieza en 10, 15, 17 o 20.", ce: "Entre 6 y 12 letras o números." };

const esquema = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre y apellido.").max(120),
  celular: z.string(),
  tipo_documento: z.enum(["ninguno", "dni", "ruc", "ce"]),
  numero_documento: z.string().trim().toUpperCase(),
  origen: z.enum(["redes", "referido", "recurrente", "otro"]),
  acepta_mensajes: z.string().optional(),
  notas: z.string().trim().max(1000, "Máximo 1000 letras."),
});

/** Crea (sin id) o actualiza (con id) un cliente. */
export async function guardarCliente(id: string | null, _previo: Resultado, form: FormData): Promise<Resultado> {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes"])) return { error: "Tu rol no edita clientes." };
  const r = esquema.safeParse(Object.fromEntries(form));
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[String(i.path[0])] ??= i.message;
    return { errores };
  }
  const d = r.data;
  const celular = normalizarCelular(d.celular);
  const errores: Record<string, string> = {};
  if (!celular) errores.celular = "Celular de 9 dígitos, por ejemplo 987 654 321.";
  if (d.tipo_documento !== "ninguno" && !DOCUMENTO[d.tipo_documento].test(d.numero_documento)) errores.numero_documento = MENSAJE_DOC[d.tipo_documento];
  if (Object.keys(errores).length) return { errores };

  const fila = {
    nombre: d.nombre,
    celular,
    tipo_documento: d.tipo_documento,
    numero_documento: d.tipo_documento === "ninguno" ? null : d.numero_documento,
    origen: d.origen,
    acepta_mensajes: d.acepta_mensajes === "on",
    notas: d.notas || null,
  };
  const supabase = await clienteServidor();
  const consulta = id
    ? supabase.from("clientes").update(fila).eq("id", id).eq("empresa_id", ctx.taller.id).select("id").single()
    : supabase.from("clientes").insert({ empresa_id: ctx.taller.id, ...fila }).select("id").single();
  const { data, error } = await consulta;
  if (error) {
    if (error.code === "23505") return { errores: { celular: "Ya hay un cliente con ese celular en este taller." } };
    return { error: "No se pudo guardar. Revisa los datos e intenta otra vez." };
  }
  revalidatePath("/clientes");
  if (id) revalidatePath(`/clientes/${id}`);
  return { ok: "Cliente guardado.", id: data.id };
}
