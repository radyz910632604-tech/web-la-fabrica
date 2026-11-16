/**
 * Cálculos de dinero del taller (especificación 5.4 a 5.8). Funciones puras,
 * probadas en tests/dinero.test.ts. La utilidad usa SIEMPRE montos sin IGV.
 */

/** Redondeo a céntimos (evita 0.1 + 0.2 = 0.30000000000000004). */
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type Montos = { sinIgv: number; igv: number; total: number };

/** Desde el total que paga el cliente (con IGV). */
export function desdeTotal(total: number, tasa: number): Montos {
  const sinIgv = redondear(total / (1 + tasa));
  return { sinIgv, igv: redondear(total - sinIgv), total: redondear(total) };
}

/** Desde el monto sin IGV. */
export function desdeSinIgv(sinIgv: number, tasa: number): Montos {
  const igv = redondear(sinIgv * tasa);
  return { sinIgv: redondear(sinIgv), igv, total: redondear(sinIgv + igv) };
}

export type Linea = { cantidad: number; precioUnitario: number; incluyeIgv: boolean };

/** Montos de una línea y de un documento (se suman las líneas ya redondeadas). */
export function montosLinea(l: Linea, tasa: number): Montos {
  const bruto = l.cantidad * l.precioUnitario;
  return l.incluyeIgv ? desdeTotal(bruto, tasa) : desdeSinIgv(bruto, tasa);
}

export function sumarMontos(lista: Montos[]): Montos {
  return lista.reduce(
    (a, m) => ({ sinIgv: redondear(a.sinIgv + m.sinIgv), igv: redondear(a.igv + m.igv), total: redondear(a.total + m.total) }),
    { sinIgv: 0, igv: 0, total: 0 },
  );
}

/** Compras en dólares se pasan a soles con su tipo de cambio. */
export function enSoles(monto: number, moneda: "PEN" | "USD", tipoCambio: number): number {
  return moneda === "USD" ? redondear(monto * tipoCambio) : monto;
}

/** Utilidad por orden = venta sin IGV − compras sin IGV − mano de obra. */
export function utilidad(venta: number, compras: number, manoObra: number): { utilidad: number; margen: number | null } {
  const u = redondear(venta - compras - manoObra);
  return { utilidad: u, margen: venta > 0 ? u / venta : null };
}

/**
 * Mano de obra de una orden.
 * - prorrateo_mensual: costo mensual del técnico ÷ órdenes que entregó ese mes.
 * - fijo_por_servicio: suma del monto fijo de cada servicio de la orden.
 */
export function manoObra(
  regla: "prorrateo_mensual" | "fijo_por_servicio",
  datos: { costoMensualTecnico?: number; ordenesEntregadasMes?: number; montosFijos?: number[] },
): number {
  if (regla === "fijo_por_servicio") return redondear((datos.montosFijos ?? []).reduce((a, b) => a + b, 0));
  const costo = datos.costoMensualTecnico ?? 0;
  const ordenes = Math.max(datos.ordenesEntregadasMes ?? 0, 1);
  return redondear(costo / ordenes);
}

/**
 * Lo que debe pagar el cliente: el total de sus comprobantes; si todavía no
 * hay comprobante, el de las cotizaciones aprobadas. Saldo negativo = a favor.
 */
export function saldo(datos: { totalComprobantes: number; totalCotizacionesAprobadas: number; pagado: number }) {
  const aCobrar = datos.totalComprobantes > 0 ? datos.totalComprobantes : datos.totalCotizacionesAprobadas;
  return { aCobrar: redondear(aCobrar), pagado: redondear(datos.pagado), saldo: redondear(aCobrar - datos.pagado) };
}

export type ReglaComision = { id: string; nombre: string; evento: "cita_llego_y_pago" | "trabajo_entregado"; tipoMonto: "fijo" | "porcentaje"; valor: number };
export type EventoComision = { evento: ReglaComision["evento"]; personaId: string; ventaSinIgv: number };

/** Comisiones del mes por persona, según las reglas activas de gerencia. */
export function comisiones(reglas: ReglaComision[], eventos: EventoComision[]): Map<string, { total: number; detalle: { regla: string; monto: number }[] }> {
  const porPersona = new Map<string, { total: number; detalle: { regla: string; monto: number }[] }>();
  for (const e of eventos) {
    for (const r of reglas.filter((x) => x.evento === e.evento)) {
      const monto = redondear(r.tipoMonto === "fijo" ? r.valor : (e.ventaSinIgv * r.valor) / 100);
      if (monto <= 0) continue;
      const p = porPersona.get(e.personaId) ?? { total: 0, detalle: [] };
      p.total = redondear(p.total + monto);
      p.detalle.push({ regla: r.nombre, monto });
      porPersona.set(e.personaId, p);
    }
  }
  return porPersona;
}

export type MedioPago = "efectivo" | "yape" | "plin" | "tarjeta" | "transferencia";
export const MEDIOS: Record<MedioPago, string> = { efectivo: "Efectivo", yape: "Yape", plin: "Plin", tarjeta: "Tarjeta", transferencia: "Transferencia" };

export type Cierre = {
  boletas: Montos & { cantidad: number };
  facturas: Montos & { cantidad: number };
  compras: Montos & { cantidad: number };
  cobros: Record<MedioPago, number> & { total: number };
  utilidadEstimada: number;
  descuadres: string[];
};

/** Cierre diario: ventas por tipo, compras, cobros por medio, utilidad estimada y lo que no cuadra. */
export function cierreDiario(d: {
  comprobantes: { tipo: "boleta" | "factura"; sinIgv: number; igv: number; total: number }[];
  compras: { sinIgv: number; igv: number; total: number }[];
  pagos: { medio: MedioPago; monto: number }[];
  manoObraDelDia: number;
  entregadasSinComprobante: string[];
  entregadasConSaldo: { orden: string; saldo: number }[];
  comprobantesSinOrden: string[];
}): Cierre {
  const resumir = (lista: { sinIgv: number; igv: number; total: number }[]) => ({ ...sumarMontos(lista), cantidad: lista.length });
  const boletas = resumir(d.comprobantes.filter((c) => c.tipo === "boleta"));
  const facturas = resumir(d.comprobantes.filter((c) => c.tipo === "factura"));
  const compras = resumir(d.compras);
  const cobros = { efectivo: 0, yape: 0, plin: 0, tarjeta: 0, transferencia: 0, total: 0 };
  for (const p of d.pagos) {
    cobros[p.medio] = redondear(cobros[p.medio] + p.monto);
    cobros.total = redondear(cobros.total + p.monto);
  }
  const vendidoConIgv = redondear(boletas.total + facturas.total);
  const descuadres: string[] = [];
  if (Math.abs(vendidoConIgv - cobros.total) >= 0.01) {
    const dif = redondear(cobros.total - vendidoConIgv);
    descuadres.push(
      dif > 0
        ? `Se cobró S/ ${dif.toFixed(2)} más de lo facturado hoy (adelantos o saldos de días anteriores).`
        : `Se facturó S/ ${Math.abs(dif).toFixed(2)} más de lo cobrado hoy (queda por cobrar).`,
    );
  }
  for (const o of d.entregadasSinComprobante) descuadres.push(`${o} se entregó sin comprobante.`);
  for (const o of d.entregadasConSaldo) descuadres.push(`${o.orden} se entregó con S/ ${o.saldo.toFixed(2)} de saldo.`);
  for (const c of d.comprobantesSinOrden) descuadres.push(`El comprobante ${c} no tiene orden asignada.`);
  return {
    boletas,
    facturas,
    compras,
    cobros,
    utilidadEstimada: redondear(boletas.sinIgv + facturas.sinIgv - compras.sinIgv - d.manoObraDelDia),
    descuadres,
  };
}

/** "  Kit de EMBRAGUE " → "kit de embrague" (para comparar descripciones de repuestos). */
export function normalizarDescripcion(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
