"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizarCelular } from "@/lib/celulares";
import { normalizarPlaca, validarPlaca } from "@/lib/placas";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export type VehiculoConocido = {
  id: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  color: string | null;
  combustible: string | null;
  transmision: string | null;
  kilometraje: number | null;
  cliente: ClienteConocido | null;
};

export type ClienteConocido = {
  id: string;
  nombre: string;
  celular: string;
  tipoDocumento: string;
  numeroDocumento: string | null;
  origen: string;
  aceptaMensajes: boolean;
};

async function exigirRegistro() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) throw new Error("Tu rol no registra ingresos.");
  return ctx;
}

function aCliente(c: Record<string, unknown> | null): ClienteConocido | null {
  if (!c) return null;
  return {
    id: String(c.id),
    nombre: String(c.nombre),
    celular: String(c.celular),
    tipoDocumento: String(c.tipo_documento),
    numeroDocumento: (c.numero_documento as string | null) ?? null,
    origen: String(c.origen),
    aceptaMensajes: Boolean(c.acepta_mensajes),
  };
}

const COLUMNAS_CLIENTE = "id, nombre, celular, tipo_documento, numero_documento, origen, acepta_mensajes";

/** Si el carro ya vino antes, devuelve sus datos y los de su dueño. */
export async function buscarPlaca(placa: string): Promise<VehiculoConocido | null> {
  const ctx = await exigirRegistro();
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("vehiculos")
    .select(`id, marca, modelo, anio, color, combustible, transmision, kilometraje_actual, clientes (${COLUMNAS_CLIENTE})`)
    .eq("empresa_id", ctx.taller.id)
    .eq("placa", normalizarPlaca(placa))
    .maybeSingle();
  if (!data) return null;
  const cliente = Array.isArray(data.clientes) ? data.clientes[0] : data.clientes;
  return {
    id: data.id,
    marca: data.marca,
    modelo: data.modelo,
    anio: data.anio,
    color: data.color,
    combustible: data.combustible,
    transmision: data.transmision,
    kilometraje: data.kilometraje_actual,
    cliente: aCliente(cliente as Record<string, unknown> | null),
  };
}

/** Si el celular ya es de un cliente, devuelve sus datos. */
export async function buscarCelular(celular: string): Promise<ClienteConocido | null> {
  const ctx = await exigirRegistro();
  const normal = normalizarCelular(celular);
  if (!normal) return null;
  const supabase = await clienteServidor();
  const { data } = await supabase.from("clientes").select(COLUMNAS_CLIENTE).eq("empresa_id", ctx.taller.id).eq("celular", normal).maybeSingle();
  return aCliente(data as Record<string, unknown> | null);
}

const vacioANulo = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const esquemaIngreso = z.object({
  placa: z.string(),
  placaConfirmada: z.boolean(),
  cliente: z.object({
    nombre: z.string().trim().min(2, "Escribe el nombre del cliente.").max(120),
    celular: z.string(),
    tipoDocumento: z.enum(["ninguno", "dni", "ruc", "ce"]),
    numeroDocumento: z.preprocess(vacioANulo, z.string().trim().toUpperCase().nullable()),
    origen: z.enum(["redes", "referido", "recurrente", "otro"]),
    aceptaMensajes: z.boolean(),
  }),
  vehiculo: z.object({
    marca: z.preprocess(vacioANulo, z.string().trim().max(40).nullable()),
    modelo: z.preprocess(vacioANulo, z.string().trim().max(60).nullable()),
    anio: z.preprocess(vacioANulo, z.coerce.number().int().min(1950, "Año desde 1950.").max(2100).nullable()),
    color: z.preprocess(vacioANulo, z.string().trim().max(30).nullable()),
    combustible: z.preprocess(vacioANulo, z.enum(["gasolina", "diesel", "gnv", "glp", "dual", "electrico", "hibrido"]).nullable()),
    transmision: z.preprocess(vacioANulo, z.enum(["mecanica", "automatica", "cvt", "otra"]).nullable()),
  }),
  kilometraje: z.preprocess(vacioANulo, z.coerce.number().int().min(0, "No puede ser negativo.").max(3_000_000).nullable()),
  servicios: z.array(z.object({ id: z.string().nullable(), descripcion: z.string().trim().min(2).max(160) })).min(1, "Elige al menos un servicio."),
  observaciones: z.preprocess(vacioANulo, z.string().trim().max(2000).nullable()),
  tecnicoId: z.preprocess(vacioANulo, z.string().uuid().nullable()),
  citaId: z.preprocess(vacioANulo, z.string().uuid().nullable()),
});


export type ResultadoIngreso = { ordenId?: string; error?: string; errores?: Record<string, string> };

const DOCUMENTO: Record<string, RegExp> = { dni: /^\d{8}$/, ruc: /^(10|15|17|20)\d{9}$/, ce: /^[A-Z0-9]{6,12}$/ };
const MENSAJE_DOC: Record<string, string> = { dni: "El DNI tiene 8 números.", ruc: "El RUC tiene 11 números.", ce: "Entre 6 y 12 letras o números." };

/**
 * Registra el ingreso: crea o actualiza al cliente y al carro, abre la orden y
 * anota los servicios. Todo con la sesión de quien registra (la base revisa su rol).
 */
export async function registrarIngreso(datos: unknown): Promise<ResultadoIngreso> {
  const ctx = await exigirRegistro();
  const r = esquemaIngreso.safeParse(datos);
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[i.path.join(".")] ??= i.message;
    return { errores };
  }
  const d = r.data;
  const errores: Record<string, string> = {};

  const placa = validarPlaca(d.placa);
  if (placa.estado === "invalida") errores.placa = "Escribe la placa del carro, por ejemplo ABC-123.";
  if (placa.estado === "revisar" && !d.placaConfirmada) errores.placa = "Esa placa no tiene el formato de siempre. Revísala y marca que es correcta.";
  const celular = normalizarCelular(d.cliente.celular);
  if (!celular) errores["cliente.celular"] = "Celular de 9 dígitos, por ejemplo 987 654 321.";
  const tipo = d.cliente.tipoDocumento;
  if (tipo !== "ninguno" && !(d.cliente.numeroDocumento && DOCUMENTO[tipo].test(d.cliente.numeroDocumento))) {
    errores["cliente.numeroDocumento"] = MENSAJE_DOC[tipo];
  }
  if (Object.keys(errores).length > 0 || placa.estado === "invalida" || !celular) return { errores };

  const supabase = await clienteServidor();
  const empresa = ctx.taller.id;

  // 1. Cliente (por celular)
  const datosCliente = {
    nombre: d.cliente.nombre,
    tipo_documento: tipo,
    numero_documento: tipo === "ninguno" ? null : d.cliente.numeroDocumento,
    origen: d.cliente.origen,
    acepta_mensajes: d.cliente.aceptaMensajes,
  };
  const { data: clienteExistente } = await supabase.from("clientes").select("id").eq("empresa_id", empresa).eq("celular", celular).maybeSingle();
  let clienteId = clienteExistente?.id as string | undefined;
  if (clienteId) {
    const { error } = await supabase.from("clientes").update(datosCliente).eq("id", clienteId);
    if (error) return { error: "No se pudo actualizar al cliente." };
  } else {
    const { data, error } = await supabase.from("clientes").insert({ empresa_id: empresa, celular, ...datosCliente }).select("id").single();
    if (error || !data) return { error: "No se pudo guardar al cliente." };
    clienteId = data.id;
  }

  // 2. Carro (por placa)
  const datosVehiculo = { ...d.vehiculo, cliente_id: clienteId };
  const { data: vehiculoExistente } = await supabase.from("vehiculos").select("id").eq("empresa_id", empresa).eq("placa", placa.placa).maybeSingle();
  let vehiculoId = vehiculoExistente?.id as string | undefined;
  if (vehiculoId) {
    const { error } = await supabase.from("vehiculos").update(datosVehiculo).eq("id", vehiculoId);
    if (error) return { error: "No se pudo actualizar el carro." };
  } else {
    const { data, error } = await supabase.from("vehiculos").insert({ empresa_id: empresa, placa: placa.placa, ...datosVehiculo }).select("id").single();
    if (error || !data) return { error: "No se pudo guardar el carro." };
    vehiculoId = data.id;
  }

  // 3. Orden y servicios
  const { data: orden, error: errorOrden } = await supabase
    .from("ordenes_trabajo")
    .insert({
      empresa_id: empresa,
      vehiculo_id: vehiculoId,
      cliente_id: clienteId,
      kilometraje_ingreso: d.kilometraje,
      observaciones_ingreso: d.observaciones,
      tecnico_id: d.tecnicoId,
      cita_id: d.citaId,
    })
    .select("id")
    .single();
  if (errorOrden || !orden) return { error: "No se pudo abrir la orden. Intenta otra vez." };

  const { error: errorServicios } = await supabase
    .from("orden_servicios")
    .insert(d.servicios.map((s) => ({ empresa_id: empresa, orden_id: orden.id, servicio_id: s.id, descripcion: s.descripcion })));
  if (errorServicios) return { ordenId: orden.id, error: "La orden se abrió, pero no se guardaron los servicios. Agrégalos en la orden." };

  revalidatePath("/", "layout");
  return { ordenId: orden.id };
}

/** Sube una foto (ya reducida en el celular) a la orden. */
export async function subirFoto(ordenId: string, form: FormData): Promise<{ ok?: true; error?: string }> {
  const ctx = await obtenerContexto();
  const archivo = form.get("foto");
  const etapa = String(form.get("etapa") ?? "ingreso");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "No llegó la foto." };
  if (!["image/jpeg", "image/png", "image/webp"].includes(archivo.type)) return { error: "Solo se aceptan fotos." };
  if (archivo.size > 6 * 1024 * 1024) return { error: "La foto pesa demasiado." };
  if (!["ingreso", "proceso", "entrega"].includes(etapa)) return { error: "Etapa no válida." };

  const supabase = await clienteServidor();
  const ruta = `${ctx.taller.id}/${ordenId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("ordenes").upload(ruta, archivo, { contentType: archivo.type, upsert: false });
  if (error) return { error: "No tienes permiso para subir fotos a esta orden, o se cortó la conexión." };

  const { error: errorFila } = await supabase.from("archivos").insert({
    empresa_id: ctx.taller.id,
    orden_id: ordenId,
    tipo: "foto",
    etapa,
    bucket: "ordenes",
    ruta,
    mime: archivo.type,
    tamano_bytes: archivo.size,
    subido_por: ctx.perfil.id,
  });
  if (errorFila) return { error: "La foto se subió, pero no quedó registrada en la orden." };
  revalidatePath(`/ordenes/${ordenId}`);
  return { ok: true };
}
