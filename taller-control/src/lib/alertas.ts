import { normalizarDescripcion } from "./dinero";
import { cuandoEntrega, duracion, situacionEntrega } from "./taller/entrega";

/**
 * Las 9 alertas de la especificación (5.8). Función pura: recibe los datos
 * ya leídos (con los permisos de quien mira) y devuelve la lista.
 */

export type TipoAlerta =
  | "repuesto_no_cobrado"
  | "entregada_sin_comprobante"
  | "entregada_con_saldo"
  | "margen_bajo"
  | "orden_estancada"
  | "ingreso_incompleto"
  | "precio_compra_subio"
  | "adicional_sin_aprobacion"
  | "comprobante_sin_orden"
  | "stock_bajo"
  | "por_confirmar"
  | "entrega_atrasada"
  | "entrega_por_vencer"
  | "entrega_sin_hora";

export type Alerta = { tipo: TipoAlerta; severidad: "urgente" | "atencion" | "info"; ordenId?: string; href?: string; mensaje: string };

export const NOMBRE_ALERTA: Record<TipoAlerta, string> = {
  repuesto_no_cobrado: "Repuesto no cobrado",
  entregada_sin_comprobante: "Entregada sin comprobante",
  entregada_con_saldo: "Entregada con saldo",
  margen_bajo: "Margen bajo",
  orden_estancada: "Orden sin avance",
  ingreso_incompleto: "Ingreso incompleto",
  precio_compra_subio: "Repuesto más caro",
  adicional_sin_aprobacion: "Adicional sin aprobación",
  comprobante_sin_orden: "Comprobante sin orden",
  stock_bajo: "Stock bajo",
  por_confirmar: "Montos por confirmar",
  entrega_atrasada: "Entrega atrasada",
  entrega_por_vencer: "Entrega por vencer",
  entrega_sin_hora: "Sin hora de entrega",
};

/**
 * ¿El repuesto aparece en el detalle del comprobante? Basta con la descripción
 * completa o con una palabra importante (5 letras o más): "Pastillas de freno
 * Bosch" se da por cobrado si el comprobante dice "cambio de pastillas".
 */
function apareceEn(detalleNormalizado: string, repuesto: string): boolean {
  const r = normalizarDescripcion(repuesto);
  if (detalleNormalizado.includes(r)) return true;
  const palabras = new Set(detalleNormalizado.split(" "));
  return r.split(" ").some((p) => p.length >= 5 && palabras.has(p));
}

export type OrdenParaAlertas = {
  id: string;
  numero: string;
  estado: string;
  estadoCambiadoEn: string;
  fotos: number;
  servicios: number;
  adicionales: number;
  cotizacionesAdicionalesAprobadas: number;
  tieneComprobante: boolean;
  detalleComprobantes: string;
  repuestosComprados: string[];
  saldo: number | null;
  ventaSinIgv: number | null;
  margen: number | null;
  /** Hora prometida al cliente (ISO) y placa, para las alertas de entrega. */
  entregaPrometida?: string | null;
  placa?: string;
};

export type CompraItemParaAlertas = { proveedor: string; descripcion: string; precioUnitarioSinIgv: number; fecha: string; ordenNumero?: string };

export function calcularAlertas(d: {
  ahora: Date;
  ordenes: OrdenParaAlertas[];
  itemsCompra: CompraItemParaAlertas[];
  comprobantesSinOrden: string[];
  horasSinCambio: number;
  margenMinimoPct: number;
  verDinero: boolean;
  verMargen: boolean;
  /** Repuestos del inventario que llegaron a su stock mínimo. */
  stockBajo?: { codigo: string; nombre: string; stock: number; minimo: number }[];
  /** Documentos leídos por IA que esperan que una persona los apruebe. */
  porConfirmar?: { texto: string; href: string }[];
  /** Cuánto antes de la hora prometida se avisa (minutos). */
  minutosAvisoEntrega?: number;
}): Alerta[] {
  const alertas: Alerta[] = [];
  const limite = d.ahora.getTime() - d.horasSinCambio * 60 * 60 * 1000;

  for (const o of d.ordenes) {
    const entregada = o.estado === "entregado";
    if (!entregada && new Date(o.estadoCambiadoEn).getTime() < limite) {
      alertas.push({ tipo: "orden_estancada", severidad: "atencion", ordenId: o.id, mensaje: `${o.numero} lleva más de ${d.horasSinCambio} horas sin cambiar de estado.` });
    }
    if (o.entregaPrometida !== undefined && ["en_taller", "en_proceso", "esperando_repuesto"].includes(o.estado)) {
      const carro = o.placa ? `${o.numero} (${o.placa})` : o.numero;
      if (!o.entregaPrometida) {
        alertas.push({ tipo: "entrega_sin_hora", severidad: "info", ordenId: o.id, mensaje: `${carro} no tiene hora de entrega prometida al cliente.` });
      } else {
        const prometida = new Date(o.entregaPrometida);
        const s = situacionEntrega({ entregaPrometida: prometida, estado: o.estado }, d.ahora, d.minutosAvisoEntrega ?? 120);
        if (s.tipo === "atrasada") {
          alertas.push({ tipo: "entrega_atrasada", severidad: "urgente", ordenId: o.id, mensaje: `${carro} se prometió para ${cuandoEntrega(prometida, d.ahora)} y va ${duracion(s.minutos)} tarde. Llama al cliente con la nueva hora.` });
        } else if (s.tipo === "por_vencer") {
          alertas.push({ tipo: "entrega_por_vencer", severidad: "atencion", ordenId: o.id, mensaje: `${carro} se entrega ${cuandoEntrega(prometida, d.ahora)} (faltan ${duracion(s.minutos)}) y todavía no está listo.` });
        }
      }
    }
    if (!entregada && (o.fotos === 0 || o.servicios === 0)) {
      const falta = [o.fotos === 0 ? "fotos" : null, o.servicios === 0 ? "servicios" : null].filter(Boolean).join(" ni ");
      alertas.push({ tipo: "ingreso_incompleto", severidad: "info", ordenId: o.id, mensaje: `${o.numero} no tiene ${falta}.` });
    }
    if (o.adicionales > 0 && o.cotizacionesAdicionalesAprobadas === 0 && o.estado !== "en_taller") {
      alertas.push({ tipo: "adicional_sin_aprobacion", severidad: "atencion", ordenId: o.id, mensaje: `${o.numero} tiene trabajos adicionales sin cotización aprobada por el cliente.` });
    }
    if (!d.verDinero) continue;
    if (entregada && !o.tieneComprobante) {
      alertas.push({ tipo: "entregada_sin_comprobante", severidad: "urgente", ordenId: o.id, mensaje: `${o.numero} se entregó sin boleta ni factura registrada.` });
    }
    if (entregada && o.saldo !== null && o.saldo > 0.009) {
      alertas.push({ tipo: "entregada_con_saldo", severidad: "urgente", ordenId: o.id, mensaje: `${o.numero} se entregó con S/ ${o.saldo.toFixed(2)} de saldo.` });
    }
    if (o.tieneComprobante && o.detalleComprobantes.trim()) {
      const detalle = normalizarDescripcion(o.detalleComprobantes);
      const faltan = o.repuestosComprados.filter((r) => !apareceEn(detalle, r));
      if (faltan.length) {
        alertas.push({ tipo: "repuesto_no_cobrado", severidad: "atencion", ordenId: o.id, mensaje: `${o.numero}: se compró ${faltan.join(", ")} y no aparece en el comprobante.` });
      }
    }
    if (d.verMargen && o.margen !== null && o.ventaSinIgv && o.margen * 100 < d.margenMinimoPct) {
      alertas.push({ tipo: "margen_bajo", severidad: "atencion", ordenId: o.id, mensaje: `${o.numero} deja ${(o.margen * 100).toFixed(1)} % de margen (mínimo ${d.margenMinimoPct} %).` });
    }
  }

  // Precio de compra más alto que la última vez con el mismo proveedor.
  const ordenados = [...d.itemsCompra].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = new Map<string, number>();
  for (const i of ordenados) {
    const clave = `${i.proveedor}|${normalizarDescripcion(i.descripcion)}`;
    const previo = ultimo.get(clave);
    if (previo !== undefined && i.precioUnitarioSinIgv > previo + 0.009) {
      const subio = ((i.precioUnitarioSinIgv - previo) / previo) * 100;
      alertas.push({
        tipo: "precio_compra_subio",
        severidad: "info",
        mensaje: `${i.descripcion} de ${i.proveedor} subió ${subio.toFixed(1)} % (de S/ ${previo.toFixed(2)} a S/ ${i.precioUnitarioSinIgv.toFixed(2)} sin IGV).`,
      });
    }
    ultimo.set(clave, i.precioUnitarioSinIgv);
  }

  if (d.verDinero) {
    for (const c of d.comprobantesSinOrden) {
      alertas.push({ tipo: "comprobante_sin_orden", severidad: "atencion", mensaje: `El comprobante ${c} no tiene orden asignada.` });
    }
  }

  for (const r of d.stockBajo ?? []) {
    alertas.push({ tipo: "stock_bajo", severidad: r.stock <= 0 ? "urgente" : "atencion", href: "/inventario?ver=bajo", mensaje: `${r.nombre} (${r.codigo}): ${r.stock <= 0 ? "se acabó" : `quedan ${r.stock}`}, el mínimo es ${r.minimo}.` });
  }
  for (const t of d.porConfirmar ?? []) {
    alertas.push({ tipo: "por_confirmar", severidad: "atencion", href: t.href, mensaje: `${t.texto} fue leído por IA y espera que alguien revise y confirme los montos.` });
  }

  const peso = { urgente: 0, atencion: 1, info: 2 };
  return alertas.sort((a, b) => peso[a.severidad] - peso[b.severidad]);
}
