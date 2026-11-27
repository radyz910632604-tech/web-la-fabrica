import "server-only";
import { clienteServidor } from "@/lib/supabase/servidor";
import { stockBajo } from "@/lib/inventario";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type Repuesto = {
  id: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  unidad: string;
  stock: number;
  stockMinimo: number;
  costoPromedio: number;
  ultimoCosto: number | null;
  precioSinIgv: number | null;
  activo: boolean;
  bajo: boolean;
};

const CAMPOS = "id, codigo, nombre, marca, unidad, stock, stock_minimo, costo_promedio_sin_igv, ultimo_costo_sin_igv, precio_venta_sin_igv, activo";

type Fila = {
  id: string; codigo: string; nombre: string; marca: string | null; unidad: string; stock: Num; stock_minimo: Num;
  costo_promedio_sin_igv: Num; ultimo_costo_sin_igv: Num; precio_venta_sin_igv: Num; activo: boolean;
};

function aRepuesto(r: Fila): Repuesto {
  const base = {
    id: r.id, codigo: r.codigo, nombre: r.nombre, marca: r.marca, unidad: r.unidad, stock: n(r.stock), stockMinimo: n(r.stock_minimo),
    costoPromedio: n(r.costo_promedio_sin_igv), ultimoCosto: r.ultimo_costo_sin_igv === null ? null : n(r.ultimo_costo_sin_igv),
    precioSinIgv: r.precio_venta_sin_igv === null ? null : n(r.precio_venta_sin_igv), activo: r.activo,
  };
  return { ...base, bajo: base.activo && stockBajo(base) };
}

/** Repuestos del taller (lee con la sesión: sin permiso, lista vacía). */
export async function listarRepuestos(empresaId: string, { buscar = "", incluirInactivos = false } = {}): Promise<Repuesto[]> {
  const supabase = await clienteServidor();
  let q = supabase.from("repuestos").select(CAMPOS).eq("empresa_id", empresaId).order("nombre").limit(500);
  if (!incluirInactivos) q = q.eq("activo", true);
  const texto = buscar.trim().replace(/[%,()]/g, " ");
  if (texto) q = q.or(`nombre.ilike.%${texto}%,codigo.ilike.%${texto}%,marca.ilike.%${texto}%`);
  const { data } = await q;
  return ((data ?? []) as Fila[]).map(aRepuesto);
}

export async function repuesto(empresaId: string, id: string): Promise<Repuesto | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase.from("repuestos").select(CAMPOS).eq("empresa_id", empresaId).eq("id", id).maybeSingle();
  return data ? aRepuesto(data as Fila) : null;
}

export type Movimiento = {
  id: string;
  tipo: "entrada" | "salida" | "ajuste";
  cantidad: number;
  costo: number;
  stockDespues: number | null;
  ordenId: string | null;
  ordenNumero: number | null;
  compra: string | null;
  nota: string | null;
  estado: "vigente" | "anulado";
  motivoAnulacion: string | null;
  creadoEn: string;
  quien: string | null;
};

type FilaMov = {
  id: string; tipo: Movimiento["tipo"]; cantidad: Num; costo_unitario_sin_igv: Num; stock_despues: Num; orden_id: string | null; nota: string | null;
  estado: Movimiento["estado"]; motivo_anulacion: string | null; creado_en: string; creado_por: string | null;
  ordenes_trabajo: { numero: number } | { numero: number }[] | null;
  compra_items: { compras: { serie: string | null; numero: string | null; proveedores: { razon_social: string } | { razon_social: string }[] | null } | null } | null;
};

const uno = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** Kardex de un repuesto, del más reciente al más antiguo. */
export async function kardex(empresaId: string, repuestoId: string): Promise<Movimiento[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("movimientos_inventario")
    .select("id, tipo, cantidad, costo_unitario_sin_igv, stock_despues, orden_id, nota, estado, motivo_anulacion, creado_en, creado_por, ordenes_trabajo (numero), compra_items (compras (serie, numero, proveedores (razon_social)))")
    .eq("empresa_id", empresaId)
    .eq("repuesto_id", repuestoId)
    .order("creado_en", { ascending: false })
    .limit(300);
  const filas = (data ?? []) as unknown as FilaMov[];
  const ids = [...new Set(filas.map((f) => f.creado_por).filter(Boolean))] as string[];
  const { data: perfiles } = ids.length ? await supabase.from("perfiles").select("id, nombre").in("id", ids) : { data: [] };
  const nombres = new Map((perfiles ?? []).map((p) => [p.id, p.nombre as string]));
  return filas.map((f) => {
    const compra = f.compra_items?.compras ?? null;
    const prov = uno(compra?.proveedores ?? null);
    return {
      id: f.id, tipo: f.tipo, cantidad: n(f.cantidad), costo: n(f.costo_unitario_sin_igv), stockDespues: f.stock_despues === null ? null : n(f.stock_despues),
      ordenId: f.orden_id, ordenNumero: uno(f.ordenes_trabajo)?.numero ?? null,
      compra: compra ? `${prov?.razon_social ?? "Proveedor"}${compra.serie ? ` ${compra.serie}-${compra.numero}` : ""}` : null,
      nota: f.nota, estado: f.estado, motivoAnulacion: f.motivo_anulacion, creadoEn: f.creado_en, quien: f.creado_por ? (nombres.get(f.creado_por) ?? null) : null,
    };
  });
}

export type SalidaOrden = { id: string; repuesto: string; codigo: string; cantidad: number; costo: number; unidad: string; creadoEn: string };

/** Repuestos del inventario entregados a una orden (vigentes). */
export async function salidasDeOrden(ordenId: string): Promise<SalidaOrden[]> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("movimientos_inventario")
    .select("id, cantidad, costo_unitario_sin_igv, creado_en, repuestos (nombre, codigo, unidad)")
    .eq("orden_id", ordenId)
    .eq("tipo", "salida")
    .eq("estado", "vigente")
    .order("creado_en");
  type F = { id: string; cantidad: Num; costo_unitario_sin_igv: Num; creado_en: string; repuestos: { nombre: string; codigo: string; unidad: string } | { nombre: string; codigo: string; unidad: string }[] | null };
  return ((data ?? []) as F[]).map((f) => {
    const r = uno(f.repuestos);
    return { id: f.id, repuesto: r?.nombre ?? "Repuesto", codigo: r?.codigo ?? "", unidad: r?.unidad ?? "unidad", cantidad: -n(f.cantidad), costo: Math.round(-n(f.cantidad) * n(f.costo_unitario_sin_igv) * 100) / 100, creadoEn: f.creado_en };
  });
}
