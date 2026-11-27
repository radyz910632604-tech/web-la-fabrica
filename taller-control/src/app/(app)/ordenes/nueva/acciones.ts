"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizarCelular } from "@/lib/celulares";
import { normalizarPlaca, validarPlaca } from "@/lib/placas";
import { tieneAlguno } from "@/lib/roles";
import { validarEntrega } from "@/lib/taller/entrega";
import { VALORES_COMBUSTIBLE } from "@/lib/taller/estados";
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
  carroceria: string | null;
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
    .select(`id, marca, modelo, anio, color, combustible, transmision, carroceria, kilometraje_actual, clientes (${COLUMNAS_CLIENTE})`)
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
    carroceria: data.carroceria,
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
    combustible: z.preprocess(vacioANulo, z.enum(VALORES_COMBUSTIBLE).nullable()),
    // La caja ya no se pide al ingresar: si no llega, se conserva la que tenía el carro.
    transmision: z.preprocess(vacioANulo, z.enum(["mecanica", "automatica", "cvt", "otra"]).nullable()).optional(),
    carroceria: z.preprocess(vacioANulo, z.enum(["sedan", "hatchback", "suv", "camioneta", "pickup", "van", "coupe", "station_wagon", "otro"]).nullable()),
  }),
  combustible: z.preprocess(vacioANulo, z.coerce.number().int().refine((v) => [0, 25, 50, 75, 100].includes(v)).nullable()),
  kilometraje: z.preprocess(vacioANulo, z.coerce.number().int().min(0, "No puede ser negativo.").max(3_000_000).nullable()),
  servicios: z.array(z.object({ id: z.string().nullable(), descripcion: z.string().trim().min(2).max(160) })), // opcional: se puede agregar después en la orden
  observaciones: z.preprocess(vacioANulo, z.string().trim().max(2000).nullable()),
  tecnicoId: z.preprocess(vacioANulo, z.string().uuid().nullable()),
  citaId: z.preprocess(vacioANulo, z.string().uuid().nullable()),
  entrega: z.object({ dia: z.string(), hora: z.string(), porDefinir: z.boolean() }),
  // Solo al editar (roles de caja): el precio CON IGV de cada servicio; vacío = sin precio.
  precios: z.array(z.object({ descripcion: z.string().trim().min(2).max(160), precio: z.preprocess(vacioANulo, z.coerce.number().min(0, "El precio no puede ser negativo.").max(9_999_999).nullable()) })).optional(),
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
    // La hora de entrega se revisa igual, para mostrar todos los errores de una vez.
    const e = esquemaIngreso.shape.entrega.safeParse((datos as { entrega?: unknown } | null)?.entrega);
    const entrega = e.success && (e.data.dia || e.data.hora) ? validarEntrega(e.data, new Date()) : null;
    if (entrega && "error" in entrega) errores.entrega = entrega.error;
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
  // La hora de entrega es opcional: si no se eligió nada, queda «por definir» y se pone después en la orden.
  const sinHora = !d.entrega.dia && !d.entrega.hora;
  const entrega = validarEntrega(sinHora ? { dia: "", hora: "", porDefinir: true } : d.entrega, new Date());
  if ("error" in entrega) errores.entrega = entrega.error;
  if (Object.keys(errores).length > 0 || placa.estado === "invalida" || !celular || "error" in entrega) return { errores };

  const supabase = await clienteServidor();
  const empresa = ctx.taller.id;

  const guardado = await guardarClienteYCarro(supabase, empresa, d, celular, placa.placa);
  if ("error" in guardado) return { error: guardado.error };
  const { clienteId, vehiculoId } = guardado;

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
      entrega_prometida: entrega.instante?.toISOString() ?? null,
      nivel_combustible: d.combustible,
    })
    .select("id")
    .single();
  if (errorOrden || !orden) return { error: "No se pudo abrir la orden. Intenta otra vez." };

  const { error: errorServicios } = d.servicios.length
    ? await supabase.from("orden_servicios").insert(d.servicios.map((s) => ({ empresa_id: empresa, orden_id: orden.id, servicio_id: s.id, descripcion: s.descripcion })))
    : { error: null };
  if (errorServicios) return { ordenId: orden.id, error: "La orden se abrió, pero no se guardaron los servicios. Agrégalos en la orden." };

  revalidatePath("/", "layout");
  return { ordenId: orden.id };
}

type Ingreso = z.infer<typeof esquemaIngreso>;

/** Crea o actualiza al cliente (por celular) y al carro (por placa). Lo usan el ingreso y la edición. */
async function guardarClienteYCarro(
  supabase: Awaited<ReturnType<typeof clienteServidor>>,
  empresa: string,
  d: Ingreso,
  celular: string,
  placa: string,
): Promise<{ clienteId: string; vehiculoId: string } | { error: string }> {
  // 1. Cliente (por celular)
  const tipo = d.cliente.tipoDocumento;
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
  const { transmision, ...restoVehiculo } = d.vehiculo;
  const datosVehiculo = { ...restoVehiculo, ...(transmision !== undefined ? { transmision } : {}), cliente_id: clienteId };
  const { data: vehiculoExistente } = await supabase.from("vehiculos").select("id").eq("empresa_id", empresa).eq("placa", placa).maybeSingle();
  let vehiculoId = vehiculoExistente?.id as string | undefined;
  if (vehiculoId) {
    const { error } = await supabase.from("vehiculos").update(datosVehiculo).eq("id", vehiculoId);
    if (error) return { error: "No se pudo actualizar el carro." };
  } else {
    const { data, error } = await supabase.from("vehiculos").insert({ empresa_id: empresa, placa: placa, ...datosVehiculo }).select("id").single();
    if (error || !data) return { error: "No se pudo guardar el carro." };
    vehiculoId = data.id;
  }

  return { clienteId: clienteId!, vehiculoId: vehiculoId! };
}

/** Revisa los datos del formulario (lo mismo que en el ingreso, sin la hora de entrega). */
function revisar(d: Ingreso) {
  const errores: Record<string, string> = {};
  const placa = validarPlaca(d.placa);
  if (placa.estado === "invalida") errores.placa = "Escribe la placa del carro, por ejemplo ABC-123.";
  if (placa.estado === "revisar" && !d.placaConfirmada) errores.placa = "Esa placa no tiene el formato de siempre. Revísala y marca que es correcta.";
  const celular = normalizarCelular(d.cliente.celular);
  if (!celular) errores["cliente.celular"] = "Celular de 9 dígitos, por ejemplo 987 654 321.";
  const tipo = d.cliente.tipoDocumento;
  if (tipo !== "ninguno" && !(d.cliente.numeroDocumento && DOCUMENTO[tipo].test(d.cliente.numeroDocumento))) errores["cliente.numeroDocumento"] = MENSAJE_DOC[tipo];
  return { errores, placa, celular };
}

/**
 * Corrige una orden mientras el carro sigue en el taller: cliente, carro, kilometraje,
 * observaciones, nivel, técnico y servicios. Entregada o anulada ya no se toca
 * (la base también lo impide). Con la sesión de quien edita.
 */
export async function editarIngreso(ordenId: string, datos: unknown): Promise<ResultadoIngreso> {
  const ctx = await exigirRegistro();
  const r = esquemaIngreso.safeParse(datos);
  if (!r.success) {
    const errores: Record<string, string> = {};
    for (const i of r.error.issues) errores[i.path.join(".")] ??= i.message;
    return { errores };
  }
  const d = r.data;
  const { errores, placa, celular } = revisar(d);
  if (Object.keys(errores).length > 0 || placa.estado === "invalida" || !celular) return { errores };

  const supabase = await clienteServidor();
  const empresa = ctx.taller.id;
  const { data: orden } = await supabase.from("ordenes_trabajo").select("id, estado, anulada, kilometraje_ingreso").eq("id", ordenId).eq("empresa_id", empresa).maybeSingle();
  if (!orden) return { error: "No se encontró la orden." };
  if (orden.anulada) return { error: "La orden está anulada: ya no se edita." };
  if (orden.estado === "entregado") return { error: "El carro ya se entregó: la orden ya no se edita." };

  const guardado = await guardarClienteYCarro(supabase, empresa, d, celular, placa.placa);
  if ("error" in guardado) return { error: guardado.error };

  const { error, count } = await supabase
    .from("ordenes_trabajo")
    .update(
      {
        vehiculo_id: guardado.vehiculoId,
        cliente_id: guardado.clienteId,
        kilometraje_ingreso: d.kilometraje,
        observaciones_ingreso: d.observaciones,
        tecnico_id: d.tecnicoId,
        nivel_combustible: d.combustible,
      },
      { count: "exact" },
    )
    .eq("id", ordenId);
  if (error || count !== 1) return { error: error?.code === "42501" ? error.message : "No se pudo guardar la orden." };
  // El kilometraje del carro sube si el corregido es mayor.
  if (d.kilometraje != null) {
    await supabase.from("vehiculos").update({ kilometraje_actual: d.kilometraje }).eq("id", guardado.vehiculoId).or(`kilometraje_actual.is.null,kilometraje_actual.lt.${d.kilometraje}`);
  }

  // Servicios: se quitan los que ya no están y se agregan los nuevos; los que siguen no se tocan.
  const { data: actuales } = await supabase.from("orden_servicios").select("id, servicio_id, descripcion").eq("orden_id", ordenId);
  const clave = (s: { id?: string | null; servicio_id?: string | null; descripcion: string }) => `${s.servicio_id ?? s.id ?? ""}|${s.descripcion.trim().toLowerCase()}`;
  const nuevos = new Map(d.servicios.map((s) => [clave({ servicio_id: s.id, descripcion: s.descripcion }), s]));
  const quitar = (actuales ?? []).filter((a) => !nuevos.has(clave(a))).map((a) => a.id);
  for (const a of actuales ?? []) nuevos.delete(clave(a));
  if (quitar.length) {
    const { error: e } = await supabase.from("orden_servicios").delete().in("id", quitar);
    if (e) return { error: "Se guardó la orden, pero no se pudieron quitar algunos servicios." };
  }
  if (nuevos.size) {
    const { error: e } = await supabase
      .from("orden_servicios")
      .insert([...nuevos.values()].map((s) => ({ empresa_id: empresa, orden_id: ordenId, servicio_id: s.id, descripcion: s.descripcion, es_adicional: true })));
    if (e) return { error: "Se guardó la orden, pero no se agregaron los servicios nuevos." };
  }

  // Precios de los servicios (si quien edita es de caja y los mandó).
  if (d.precios && tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "recepcion"])) {
    const fallo = await sincronizarPrecios(supabase, ordenId, d.servicios, d.precios);
    if (fallo) {
      revalidatePath("/", "layout");
      return { error: `Se guardaron los datos de la orden, pero no los precios: ${fallo}` };
    }
  }

  revalidatePath("/", "layout");
  return { ordenId };
}

type LineaCot = { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; base?: number; precio?: number };

/**
 * Deja los precios de la orden como en la pantalla de edición, sin duplicar el total:
 * cambia el precio de las líneas que ya existían, agrega las nuevas (a la última cotización
 * aprobada o vigente) y quita las de los servicios que se sacaron. Los productos no se tocan.
 * Cada cambio es una versión nueva de la cotización (editar_lineas_orden) con quién la hizo.
 */
async function sincronizarPrecios(
  supabase: Awaited<ReturnType<typeof clienteServidor>>,
  ordenId: string,
  servicios: { descripcion: string }[],
  precios: { descripcion: string; precio: number | null }[],
): Promise<string | null> {
  const clave = (t: string) => t.trim().toLowerCase();
  const elegidos = new Set(servicios.map((sv) => clave(sv.descripcion)));
  const precioDe = new Map(precios.filter((x) => x.precio != null).map((x) => [clave(x.descripcion), x.precio as number]));
  const { data: cots } = await supabase
    .from("cotizaciones")
    .select("id, estado, version, tasa_igv, cotizacion_items (tipo, descripcion, cantidad, subtotal_sin_igv, total, creado_en)")
    .eq("orden_id", ordenId)
    .in("estado", ["borrador", "enviada", "aprobada"])
    .order("version");
  type Item = { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; subtotal_sin_igv: number; total: number; creado_en: string | null };
  const conPrecio = new Set<string>();
  const cambios: { cot: string | null; conIgv: boolean; lineas: LineaCot[] }[] = [];
  for (const c of cots ?? []) {
    const items = ((c.cotizacion_items ?? []) as Item[]).sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
    let cambio = false;
    const lineas: LineaCot[] = [];
    for (const i of items) {
      const cant = Number(i.cantidad);
      const base = Math.round((Number(i.subtotal_sin_igv) / cant) * 10000) / 10000;
      if (i.tipo === "repuesto") {
        lineas.push({ tipo: i.tipo, descripcion: i.descripcion, cantidad: cant, base });
        continue;
      }
      const k = clave(i.descripcion);
      if (!elegidos.has(k)) {
        cambio = true; // el servicio se quitó de la orden: su precio también
        continue;
      }
      conPrecio.add(k);
      const nuevo = precioDe.get(k);
      const actual = Math.round((Number(i.total) / cant) * 100) / 100;
      if (nuevo != null && Math.abs(nuevo - actual) > 0.004) {
        cambio = true;
        lineas.push({ tipo: "servicio", descripcion: i.descripcion, cantidad: cant, precio: nuevo });
      } else lineas.push({ tipo: "servicio", descripcion: i.descripcion, cantidad: cant, base });
    }
    if (cambio) cambios.push({ cot: c.id, conIgv: Number(c.tasa_igv) > 0, lineas });
  }
  // Servicios con precio que todavía no estaban en ninguna cotización.
  const nuevos = servicios.filter((sv) => !conPrecio.has(clave(sv.descripcion)) && precioDe.has(clave(sv.descripcion)));
  if (nuevos.length) {
    const vigentes = cots ?? [];
    const destino = [...vigentes].reverse().find((c) => c.estado === "aprobada") ?? vigentes.at(-1) ?? null;
    const lineasNuevas = nuevos.map((sv) => ({ tipo: "servicio" as const, descripcion: sv.descripcion.trim(), cantidad: 1, precio: precioDe.get(clave(sv.descripcion))! }));
    const yaCambia = destino ? cambios.find((x) => x.cot === destino.id) : null;
    if (yaCambia) yaCambia.lineas.push(...lineasNuevas);
    else if (destino) {
      const items = ((destino.cotizacion_items ?? []) as Item[]).sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
      cambios.push({
        cot: destino.id,
        conIgv: Number(destino.tasa_igv) > 0,
        lineas: [...items.map((i) => ({ tipo: i.tipo, descripcion: i.descripcion, cantidad: Number(i.cantidad), base: Math.round((Number(i.subtotal_sin_igv) / Number(i.cantidad)) * 10000) / 10000 })), ...lineasNuevas],
      });
    } else cambios.push({ cot: null, conIgv: true, lineas: lineasNuevas });
  }
  for (const x of cambios) {
    const { error } = await supabase.rpc("editar_lineas_orden", { p_orden: ordenId, p_cotizacion: x.cot, p_items: x.lineas, p_con_igv: x.conIgv, p_aprobar: true });
    if (error) return ["23514", "22023", "42501"].includes(error.code ?? "") ? error.message : "intenta otra vez.";
  }
  return null;
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
