import "server-only";
import { clienteServidor } from "@/lib/supabase/servidor";

export const ESTADO_COTIZACION: Record<string, { texto: string; color: "verde" | "amarillo" | "rojo" | "gris" }> = {
  borrador: { texto: "Borrador", color: "gris" },
  enviada: { texto: "Enviada", color: "amarillo" },
  aprobada: { texto: "Aprobada", color: "verde" },
  rechazada: { texto: "Rechazada", color: "rojo" },
  anulada: { texto: "Anulada", color: "gris" },
};

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);
const uno = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export type FilaCotizacion = {
  id: string;
  numero: number | null;
  version: number;
  estado: string;
  fecha: string;
  ordenId: string | null;
  ordenNumero: number | null;
  cliente: string;
  placa: string | null;
  total: number;
  descuento: number;
  conIgv: boolean;
};

export type DetalleCotizacion = FilaCotizacion & {
  adicional: boolean;
  celular: string | null;
  documento: string | null;
  vehiculo: string | null;
  medio: string | null;
  nota: string | null;
  totalLineas: number;
  sinIgv: number;
  igv: number;
  descuentoTipo: "monto" | "porcentaje" | null;
  descuentoValor: number | null;
  descuentoMotivo: string | null;
  /** Si ya hay recibo, boleta o factura en la orden (entonces no se edita). */
  bloqueada: boolean;
  items: { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; precio: number; total: number }[];
};

const SELECCION =
  "id, numero, version, estado, creado_en, orden_id, es_adicional, cliente_nombre, cliente_celular, cliente_documento, placa, vehiculo, total, total_lineas, subtotal_sin_igv, igv, tasa_igv, descuento, descuento_tipo, descuento_valor, descuento_motivo, aprobada_por_medio, respuesta_texto, ordenes_trabajo (numero, vehiculos (placa, marca, modelo), clientes (nombre, celular, numero_documento))";

type Cruda = Record<string, unknown>;
const aFila = (c: Cruda): FilaCotizacion => {
  const o = uno(c.ordenes_trabajo as Cruda | Cruda[] | null);
  const v = uno(o?.vehiculos as Cruda | Cruda[] | null);
  const cl = uno(o?.clientes as Cruda | Cruda[] | null);
  return {
    id: String(c.id),
    numero: (c.numero as number) ?? null,
    version: c.version as number,
    estado: String(c.estado),
    fecha: String(c.creado_en),
    ordenId: (c.orden_id as string) ?? null,
    ordenNumero: (o?.numero as number) ?? null,
    cliente: String(cl?.nombre ?? c.cliente_nombre ?? "—"),
    placa: (v?.placa as string) ?? (c.placa as string) ?? null,
    total: n(c.total as Num),
    descuento: n(c.descuento as Num),
    conIgv: n(c.tasa_igv as Num) > 0,
  };
};

/** Las cotizaciones del taller, de la más reciente a la más antigua (la base filtra por rol). */
export async function listarCotizaciones(empresaId: string, filtro: { estado?: string; texto?: string } = {}): Promise<FilaCotizacion[]> {
  const supabase = await clienteServidor();
  let q = supabase.from("cotizaciones").select(SELECCION).eq("empresa_id", empresaId).order("creado_en", { ascending: false }).limit(200);
  if (filtro.estado === "vigentes") q = q.neq("estado", "anulada");
  else if (filtro.estado) q = q.eq("estado", filtro.estado);
  const { data } = await q;
  let filas = ((data ?? []) as Cruda[]).map(aFila);
  const t = filtro.texto?.trim().toLowerCase().replace(/[\s-]/g, "");
  if (t) filas = filas.filter((f) => `${f.cliente}${f.placa ?? ""}${f.numero ?? ""}`.toLowerCase().replace(/[\s-]/g, "").includes(t));
  return filas;
}

export async function detalleCotizacion(empresaId: string, id: string): Promise<DetalleCotizacion | null> {
  const supabase = await clienteServidor();
  const { data: c } = await supabase.from("cotizaciones").select(`${SELECCION}, cotizacion_items (tipo, descripcion, cantidad, precio_unitario_total, total)`).eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  if (!c) return null;
  const base = aFila(c as Cruda);
  const o = uno((c as Cruda).ordenes_trabajo as Cruda | Cruda[] | null);
  const v = uno(o?.vehiculos as Cruda | Cruda[] | null);
  const cl = uno(o?.clientes as Cruda | Cruda[] | null);
  let bloqueada = false;
  if (base.ordenId) {
    const [{ count: r }, { count: cv }] = await Promise.all([
      supabase.from("recibos").select("id", { count: "exact", head: true }).eq("orden_id", base.ordenId).neq("estado", "anulado"),
      supabase.from("comprobantes_venta").select("id", { count: "exact", head: true }).eq("orden_id", base.ordenId).neq("estado", "anulado"),
    ]);
    bloqueada = (r ?? 0) + (cv ?? 0) > 0;
  }
  return {
    ...base,
    adicional: Boolean(c.es_adicional),
    celular: (cl?.celular as string) ?? c.cliente_celular ?? null,
    documento: (cl?.numero_documento as string) ?? c.cliente_documento ?? null,
    vehiculo: v ? [v.marca, v.modelo].filter(Boolean).join(" ") || null : (c.vehiculo ?? null),
    medio: c.aprobada_por_medio,
    nota: c.respuesta_texto,
    totalLineas: n(c.total_lineas ?? c.total),
    sinIgv: n(c.subtotal_sin_igv),
    igv: n(c.igv),
    descuentoTipo: c.descuento_tipo,
    descuentoValor: c.descuento_valor == null ? null : n(c.descuento_valor),
    descuentoMotivo: c.descuento_motivo,
    bloqueada,
    items: ((c.cotizacion_items ?? []) as { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: Num; precio_unitario_total: Num; total: Num }[]).map((i) => ({
      tipo: i.tipo,
      descripcion: i.descripcion,
      cantidad: n(i.cantidad),
      precio: n(i.precio_unitario_total),
      total: n(i.total),
    })),
  };
}
