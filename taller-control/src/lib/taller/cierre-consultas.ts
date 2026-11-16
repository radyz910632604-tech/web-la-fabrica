import "server-only";
import { cierreDiario, enSoles, montoNeto, redondear, type Cierre, type MedioPago } from "../dinero";
import { clienteServidor } from "../supabase/servidor";
import { limitesDiaLima, listarOrdenes } from "./consultas";
import { costosVigentes, cuentasDeOrdenes } from "./dinero-consultas";
import { numeroOrden } from "./estados";

type Num = number | string | null;
const n = (v: Num) => Number(v ?? 0);

export type CierreDelDia = Cierre & { dia: string; manoObra: number; entregadas: number; verUtilidad: boolean };

/** Arma el cierre de un día de Lima ("2026-11-16") con lo registrado en la base. */
export async function cierreDelDia(empresaId: string, dia: string, verUtilidad: boolean): Promise<CierreDelDia> {
  const supabase = await clienteServidor();
  const { desde, hasta } = limitesDiaLima(dia);
  const [{ data: comps }, { data: compras }, { data: pagos }, entregadas, costos, tecnicos, { data: notas }] = await Promise.all([
    supabase.from("comprobantes_venta").select("tipo, serie, numero, subtotal_sin_igv, igv, total, orden_id").eq("empresa_id", empresaId).eq("estado", "confirmado").eq("fecha_emision", dia),
    supabase.from("compras").select("subtotal_sin_igv, igv, total, moneda, tipo_cambio").eq("empresa_id", empresaId).eq("estado", "confirmado").eq("fecha_emision", dia),
    supabase.from("pagos").select("medio, monto, tipo").eq("empresa_id", empresaId).eq("estado", "confirmado").gte("pagado_en", desde.toISOString()).lt("pagado_en", hasta.toISOString()),
    listarOrdenes(empresaId, { estados: ["entregado"], limite: 200, orden: "reciente" }).then((l) => l.filter((o) => {
      const t = new Date(o.estadoCambiadoEn);
      return t >= desde && t < hasta;
    })),
    verUtilidad ? costosVigentes(empresaId) : Promise.resolve(new Map<string, number>()),
    verUtilidad ? supabase.from("miembros").select("perfil_id").eq("empresa_id", empresaId).eq("rol", "tecnico").eq("activo", true) : Promise.resolve({ data: [] }),
    supabase.from("notas_credito").select("subtotal_sin_igv, igv, total").eq("empresa_id", empresaId).eq("estado", "confirmado").eq("fecha_emision", dia),
  ]);
  const cuentas = await cuentasDeOrdenes(empresaId, entregadas.map((o) => ({ id: o.id, numero: o.numero, placa: o.placa, cliente: o.cliente, estado: o.estado })));
  const [a, m] = dia.split("-").map(Number);
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const costoMes = ((tecnicos.data ?? []) as { perfil_id: string }[]).reduce((s, t) => s + (costos.get(t.perfil_id) ?? 0), 0);
  const manoObra = verUtilidad ? redondear(costoMes / diasMes) : 0;

  const c = cierreDiario({
    comprobantes: (comps ?? []).map((x) => ({ tipo: x.tipo as "boleta" | "factura", sinIgv: n(x.subtotal_sin_igv), igv: n(x.igv), total: n(x.total) })),
    compras: (compras ?? []).map((x) => {
      const mon = x.moneda as "PEN" | "USD";
      return { sinIgv: enSoles(n(x.subtotal_sin_igv), mon, n(x.tipo_cambio)), igv: enSoles(n(x.igv), mon, n(x.tipo_cambio)), total: enSoles(n(x.total), mon, n(x.tipo_cambio)) };
    }),
    pagos: (pagos ?? []).map((p) => ({ medio: p.medio as MedioPago, monto: montoNeto({ tipo: p.tipo, monto: n(p.monto) }) })),
    notasCredito: (notas ?? []).map((x) => ({ sinIgv: n(x.subtotal_sin_igv), igv: n(x.igv), total: n(x.total) })),
    manoObraDelDia: manoObra,
    entregadasSinComprobante: cuentas.filter((x) => !x.tieneComprobante).map((x) => numeroOrden(x.numero)),
    entregadasConSaldo: cuentas.filter((x) => x.tieneComprobante && x.saldo > 0.009).map((x) => ({ orden: numeroOrden(x.numero), saldo: x.saldo })),
    comprobantesSinOrden: (comps ?? []).filter((x) => !x.orden_id).map((x) => `${x.serie}-${x.numero}`),
  });
  return { ...c, dia, manoObra, entregadas: entregadas.length, verUtilidad };
}
