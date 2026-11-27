import "server-only";
import { comisiones as calcularComisiones, redondear, type ReglaComision } from "../dinero";
import { NOMBRE_ROL, type Rol } from "../roles";
import { clienteServidor } from "../supabase/servidor";
import { costosVigentes, limitesMes, totalesPeriodo, type ResumenMesDinero } from "./dinero-consultas";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type FilaMes = ResumenMesDinero & { mes: string; margen: number | null; margenNeto: number | null; ticket: number | null; parcial: boolean; comisiones: number };

/** Los últimos `cuantos` meses de Lima terminando en `mes` ("2026-11"), del más antiguo al más nuevo. */
export function mesesHasta(mes: string, cuantos: number): string[] {
  const [a, m] = mes.split("-").map(Number);
  return Array.from({ length: cuantos }, (_, i) => new Date(Date.UTC(a, m - 1 - (cuantos - 1 - i), 1)).toISOString().slice(0, 7));
}

/**
 * Totales de cada mes. El mes en curso se corta en `hoy` y su mano de obra se
 * prorratea a los días transcurridos, para compararlo con los anteriores.
 */
export async function reporteMensual(empresaId: string, meses: string[], hoy: string, verSueldos: boolean): Promise<FilaMes[]> {
  return Promise.all(
    meses.map(async (mes) => {
      const { desdeDia, hastaDia } = limitesMes(mes);
      const parcial = hoy.slice(0, 7) === mes;
      const [a, m] = mes.split("-").map(Number);
      const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
      const fin = parcial ? new Date(Date.UTC(a, m - 1, Number(hoy.slice(8, 10)) + 1)).toISOString().slice(0, 10) : hastaDia;
      const fraccion = parcial ? Number(hoy.slice(8, 10)) / diasMes : 1;
      const [t, personal] = await Promise.all([totalesPeriodo(empresaId, desdeDia, fin, fraccion, verSueldos), verSueldos ? personalDelMes(empresaId, mes) : Promise.resolve([])]);
      // Las comisiones también son costo del personal: se restan de la utilidad neta.
      const comisiones = redondear(personal.reduce((a, p) => a + p.comision, 0));
      const utilidadNeta = redondear(t.utilidadNeta - comisiones);
      return {
        ...t, mes, parcial, comisiones, personal: redondear(t.personal + comisiones), utilidadNeta,
        margen: t.ventas > 0 ? t.utilidad / t.ventas : null, margenNeto: t.ventas > 0 ? utilidadNeta / t.ventas : null,
        ticket: t.entregados > 0 ? redondear(t.ventasConIgv / t.entregados) : null,
      };
    }),
  );
}

export function sumarFilas(filas: FilaMes[], mes: string): FilaMes {
  const s = (k: keyof ResumenMesDinero) => redondear(filas.reduce((a, f) => a + f[k], 0));
  const ventas = s("ventas");
  const entregados = s("entregados");
  const utilidad = s("utilidad");
  const utilidadNeta = s("utilidadNeta");
  return {
    mes,
    gastos: s("gastos"),
    personal: s("personal"),
    utilidadNeta,
    comisiones: redondear(filas.reduce((a, f) => a + f.comisiones, 0)),
    margenNeto: ventas > 0 ? utilidadNeta / ventas : null,
    parcial: filas.some((f) => f.parcial),
    ventas,
    ventasConIgv: s("ventasConIgv"),
    compras: s("compras"),
    manoObra: s("manoObra"),
    utilidad,
    entregados,
    margen: ventas > 0 ? utilidad / ventas : null,
    ticket: entregados > 0 ? redondear(s("ventasConIgv") / entregados) : null,
  };
}

export type FilaPersonal = { id: string; nombre: string; roles: string; costo: number; comision: number; detalle: { regla: string; monto: number }[]; trabajos: number };

/**
 * Personal del mes: costo mensual y comisiones.
 * - Comisiones del asesor: las registradas en Comisiones del mes (no anuladas). El mecánico no comisiona por órdenes.
 * - Cita que llegó y pagó: para quien la agendó, si su orden tiene un pago confirmado (según las reglas activas).
 */
export async function personalDelMes(empresaId: string, mes: string): Promise<FilaPersonal[]> {
  const supabase = await clienteServidor();
  const { desde, hasta, hastaDia } = limitesMes(mes);
  const [{ data: personas }, costos, { data: reglas }, { data: registradas }, { data: citas }] = await Promise.all([
    supabase.rpc("directorio", { p_empresa: empresaId }),
    costosVigentes(empresaId, hastaDia),
    supabase.from("reglas_comision").select("id, nombre, evento, tipo_monto, valor").eq("empresa_id", empresaId).eq("activa", true).eq("evento", "cita_llego_y_pago"),
    supabase.from("comisiones").select("perfil_id, monto, orden_id").eq("empresa_id", empresaId).eq("periodo", `${mes}-01`).neq("estado", "anulada"),
    supabase.from("citas").select("vendedor_id, orden_id").eq("empresa_id", empresaId).eq("estado", "llego").not("orden_id", "is", null).gte("fecha_hora", desde.toISOString()).lt("fecha_hora", hasta.toISOString()),
  ]);
  const idsOrden = [...new Set((citas ?? []).map((c) => c.orden_id as string))];
  const [{ data: ventas }, { data: pagos }, { data: notas }] = idsOrden.length
    ? await Promise.all([
        supabase.from("comprobantes_venta").select("orden_id, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", idsOrden),
        supabase.from("pagos").select("orden_id").eq("estado", "confirmado").neq("tipo", "devolucion").in("orden_id", idsOrden),
        supabase.from("notas_credito").select("orden_id, subtotal_sin_igv").eq("estado", "confirmado").in("orden_id", idsOrden),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const ventaPor = new Map<string, number>();
  for (const v of ventas ?? []) if (v.orden_id) ventaPor.set(v.orden_id, redondear((ventaPor.get(v.orden_id) ?? 0) + n(v.subtotal_sin_igv)));
  for (const x of notas ?? []) if (x.orden_id) ventaPor.set(x.orden_id, redondear((ventaPor.get(x.orden_id) ?? 0) - n(x.subtotal_sin_igv)));
  const pagadas = new Set((pagos ?? []).map((p) => p.orden_id));

  const eventos = [
    ...(citas ?? []).filter((c) => c.vendedor_id && pagadas.has(c.orden_id)).map((c) => ({ evento: "cita_llego_y_pago" as const, personaId: c.vendedor_id as string, ventaSinIgv: ventaPor.get(c.orden_id as string) ?? 0 })),
  ];
  const r: ReglaComision[] = (reglas ?? []).map((x) => ({ id: x.id, nombre: x.nombre, evento: x.evento, tipoMonto: x.tipo_monto, valor: n(x.valor) }));
  const porPersona = calcularComisiones(r, eventos);
  const trabajos = new Map<string, number>();
  for (const e of eventos) trabajos.set(e.personaId, (trabajos.get(e.personaId) ?? 0) + 1);
  // Comisiones del asesor ya registradas (aprobadas o no): cuentan una sola vez, aquí.
  for (const c of registradas ?? []) {
    const p = porPersona.get(c.perfil_id) ?? { total: 0, detalle: [] };
    p.total = redondear(p.total + n(c.monto));
    const fila = p.detalle.find((d) => d.regla === "Comisiones del asesor");
    if (fila) fila.monto = redondear(fila.monto + n(c.monto));
    else p.detalle.push({ regla: "Comisiones del asesor", monto: n(c.monto) });
    porPersona.set(c.perfil_id, p);
    if (c.orden_id) trabajos.set(c.perfil_id, (trabajos.get(c.perfil_id) ?? 0) + 1);
  }

  return ((personas ?? []) as { perfil_id: string; nombre: string; roles: Rol[]; activo: boolean }[])
    .filter((p) => p.activo || porPersona.has(p.perfil_id))
    .map((p) => ({
      id: p.perfil_id,
      nombre: p.nombre,
      roles: p.roles.map((x) => NOMBRE_ROL[x]).join(", "),
      costo: costos.get(p.perfil_id) ?? 0,
      comision: porPersona.get(p.perfil_id)?.total ?? 0,
      detalle: porPersona.get(p.perfil_id)?.detalle ?? [],
      trabajos: trabajos.get(p.perfil_id) ?? 0,
    }));
}
