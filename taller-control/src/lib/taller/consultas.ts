import "server-only";
import { cache } from "react";
import { clienteServidor } from "../supabase/servidor";
import type { EstadoCita, EstadoOrden } from "./estados";

/**
 * Consultas del taller. Todas usan la sesión de quien navega, así que la base
 * de datos devuelve solo lo que su rol puede ver (el técnico no recibe clientes,
 * almacén tampoco, etc.).
 */

export type FilaOrden = {
  id: string;
  numero: number;
  estado: EstadoOrden;
  placa: string;
  vehiculo: string;
  cliente: string | null;
  servicios: string[];
  tecnicoId: string | null;
  tecnico: string | null;
  ingresadoEn: string;
  estadoCambiadoEn: string;
  garantia: boolean;
  entregaPrometida: string | null;
  facturadoEn: string | null;
  listoEn: string | null;
};

type OrdenCruda = {
  id: string;
  numero: number;
  estado: EstadoOrden;
  tecnico_id: string | null;
  ingresado_en: string;
  estado_cambiado_en: string;
  es_reingreso_garantia: boolean;
  entrega_prometida: string | null;
  facturado_en: string | null;
  listo_en: string | null;
  vehiculos: { placa: string; marca: string | null; modelo: string | null } | null;
  clientes: { nombre: string } | null;
  orden_servicios: { descripcion: string }[] | null;
};

const SELECCION_ORDEN =
  "id, numero, estado, tecnico_id, ingresado_en, estado_cambiado_en, es_reingreso_garantia, entrega_prometida, listo_en, facturado_en, vehiculos (placa, marca, modelo), clientes (nombre), orden_servicios (descripcion)";

/** Nombres del personal del taller (para mostrar el técnico de cada orden). */
export const nombresPersonal = cache(async (empresaId: string): Promise<Map<string, string>> => {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("directorio", { p_empresa: empresaId });
  return new Map(((data ?? []) as { perfil_id: string; nombre: string }[]).map((p) => [p.perfil_id, p.nombre]));
});

function aFila(o: OrdenCruda, nombres: Map<string, string>): FilaOrden {
  const v = o.vehiculos;
  return {
    id: o.id,
    numero: o.numero,
    estado: o.estado,
    placa: v?.placa ?? "—",
    vehiculo: [v?.marca, v?.modelo].filter(Boolean).join(" "),
    cliente: o.clientes?.nombre ?? null,
    servicios: (o.orden_servicios ?? []).map((s) => s.descripcion),
    tecnicoId: o.tecnico_id,
    tecnico: o.tecnico_id ? (nombres.get(o.tecnico_id) ?? null) : null,
    ingresadoEn: o.ingresado_en,
    estadoCambiadoEn: o.estado_cambiado_en,
    garantia: o.es_reingreso_garantia,
    entregaPrometida: o.entrega_prometida,
    facturadoEn: o.facturado_en,
    listoEn: o.listo_en,
  };
}

export async function listarOrdenes(
  empresaId: string,
  filtro: { estados?: EstadoOrden[]; vehiculoId?: string; clienteId?: string; tecnicoId?: string; limite?: number; orden?: "reciente" | "ingreso" | "entrega" } = {},
): Promise<FilaOrden[]> {
  const supabase = await clienteServidor();
  let q = supabase
    .from("ordenes_trabajo")
    .select(SELECCION_ORDEN)
    .eq("empresa_id", empresaId)
    .eq("anulada", false);
  if (filtro.estados?.length) q = q.in("estado", filtro.estados);
  if (filtro.vehiculoId) q = q.eq("vehiculo_id", filtro.vehiculoId);
  if (filtro.clienteId) q = q.eq("cliente_id", filtro.clienteId);
  if (filtro.tecnicoId) q = q.eq("tecnico_id", filtro.tecnicoId);
  q =
    filtro.orden === "entrega"
      ? q.order("entrega_prometida", { ascending: true, nullsFirst: false }).order("ingresado_en", { ascending: true })
      : filtro.orden === "ingreso"
        ? q.order("ingresado_en", { ascending: false })
        : q.order("estado_cambiado_en", { ascending: false });
  const [{ data }, nombres] = await Promise.all([q.limit(filtro.limite ?? 200), nombresPersonal(empresaId)]);
  return ((data ?? []) as unknown as OrdenCruda[]).map((o) => aFila(o, nombres));
}

export type Cita = {
  id: string;
  fechaHora: string;
  nombreCliente: string;
  celular: string;
  clienteId: string | null;
  servicio: string;
  red: string;
  campana: string | null;
  vendedorId: string | null;
  vendedor: string | null;
  estado: EstadoCita;
  ordenId: string | null;
  notas: string | null;
};

/** Citas entre dos instantes (normalmente, un día de Lima). */
export async function listarCitas(empresaId: string, desde: Date, hasta: Date): Promise<Cita[]> {
  const supabase = await clienteServidor();
  const [{ data }, nombres] = await Promise.all([
    supabase
      .from("citas")
      .select("id, fecha_hora, nombre_cliente, celular, cliente_id, servicio, red, campana, vendedor_id, estado, orden_id, notas")
      .eq("empresa_id", empresaId)
      .gte("fecha_hora", desde.toISOString())
      .lt("fecha_hora", hasta.toISOString())
      .order("fecha_hora"),
    nombresPersonal(empresaId),
  ]);
  return (data ?? []).map((c) => ({
    id: c.id,
    fechaHora: c.fecha_hora,
    nombreCliente: c.nombre_cliente,
    celular: c.celular,
    clienteId: c.cliente_id,
    servicio: c.servicio,
    red: c.red,
    campana: c.campana,
    vendedorId: c.vendedor_id,
    vendedor: c.vendedor_id ? (nombres.get(c.vendedor_id) ?? null) : null,
    estado: c.estado as EstadoCita,
    ordenId: c.orden_id,
    notas: c.notas,
  }));
}

/** Inicio y fin de un día de Lima (UTC−5, sin horario de verano). */
export function limitesDiaLima(dia: string): { desde: Date; hasta: Date } {
  const desde = new Date(`${dia}T00:00:00-05:00`);
  return { desde, hasta: new Date(desde.getTime() + 24 * 60 * 60 * 1000) };
}

export type Servicio = { id: string; nombre: string; categoria: string; activo: boolean };

export async function catalogo(empresaId: string, soloActivos = true): Promise<Servicio[]> {
  const supabase = await clienteServidor();
  let q = supabase.from("catalogo_servicios").select("id, nombre, categoria, activo").eq("empresa_id", empresaId);
  if (soloActivos) q = q.eq("activo", true);
  const { data } = await q.order("nombre");
  return (data ?? []) as Servicio[];
}

export async function personalConRol(empresaId: string, rol: string): Promise<{ id: string; nombre: string }[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase.rpc("personal_con_rol", { p_empresa: empresaId, p_rol: rol });
  return ((data ?? []) as { perfil_id: string; nombre: string }[]).map((p) => ({ id: p.perfil_id, nombre: p.nombre }));
}
