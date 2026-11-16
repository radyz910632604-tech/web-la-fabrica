import { describe, expect, it } from "vitest";
import { calcularAlertas, type OrdenParaAlertas } from "@/lib/alertas";
import { cierreDiario, comisiones, desdeSinIgv, desdeTotal, efectivoEsperado, enSoles, manoObra, montoNeto, montosLinea, saldo, sumarMontos, utilidad } from "@/lib/dinero";

describe("IGV (18 %, configurable)", () => {
  it("desglosa un total con IGV", () => {
    expect(desdeTotal(118, 0.18)).toEqual({ sinIgv: 100, igv: 18, total: 118 });
    expect(desdeTotal(300, 0.18)).toEqual({ sinIgv: 254.24, igv: 45.76, total: 300 });
  });
  it("agrega el IGV a un monto sin IGV", () => {
    expect(desdeSinIgv(254.24, 0.18)).toEqual({ sinIgv: 254.24, igv: 45.76, total: 300 });
  });
  it("sin IGV y IGV siempre suman el total, céntimo a céntimo", () => {
    for (const total of [0.01, 1, 9.99, 185, 2850, 3900.5, 12345.67]) {
      const m = desdeTotal(total, 0.18);
      expect(Math.round((m.sinIgv + m.igv) * 100)).toBe(Math.round(total * 100));
    }
  });
  it("respeta otra tasa si cambia el IGV", () => {
    expect(desdeTotal(110, 0.1)).toEqual({ sinIgv: 100, igv: 10, total: 110 });
  });
  it("las líneas se redondean una por una y luego se suman", () => {
    const lineas = [
      montosLinea({ cantidad: 3, precioUnitario: 33.33, incluyeIgv: false }, 0.18),
      montosLinea({ cantidad: 1, precioUnitario: 118, incluyeIgv: true }, 0.18),
    ];
    expect(sumarMontos(lineas)).toEqual({ sinIgv: 199.99, igv: 36, total: 235.99 });
  });
  it("pasa compras en dólares a soles con su tipo de cambio", () => {
    expect(enSoles(100, "USD", 3.75)).toBe(375);
    expect(enSoles(100, "PEN", 3.75)).toBe(100);
  });
});

describe("utilidad por orden (siempre sin IGV)", () => {
  it("venta sin IGV − compras sin IGV − mano de obra", () => {
    expect(utilidad(2415.25, 1200, 250)).toEqual({ utilidad: 965.25, margen: 965.25 / 2415.25 });
  });
  it("sin venta no hay margen (no se divide entre cero)", () => {
    expect(utilidad(0, 100, 0)).toEqual({ utilidad: -100, margen: null });
  });
});

describe("mano de obra", () => {
  it("prorrateo: costo mensual del técnico ÷ órdenes entregadas en el mes", () => {
    expect(manoObra("prorrateo_mensual", { costoMensualTecnico: 2500, ordenesEntregadasMes: 20 })).toBe(125);
  });
  it("prorrateo sin entregas cuenta la orden como única", () => {
    expect(manoObra("prorrateo_mensual", { costoMensualTecnico: 2500, ordenesEntregadasMes: 0 })).toBe(2500);
  });
  it("fijo por servicio: suma de los montos de sus servicios", () => {
    expect(manoObra("fijo_por_servicio", { montosFijos: [80, 120.5] })).toBe(200.5);
  });
});

describe("saldo de la orden", () => {
  it("con comprobante, se cobra lo del comprobante", () => {
    expect(saldo({ totalComprobantes: 300, totalCotizacionesAprobadas: 280, pagado: 100 })).toEqual({ aCobrar: 300, pagado: 100, saldo: 200 });
  });
  it("sin comprobante, se cobra lo de la cotización aprobada", () => {
    expect(saldo({ totalComprobantes: 0, totalCotizacionesAprobadas: 280, pagado: 280 }).saldo).toBe(0);
  });
  it("una nota de crédito que anula todo deja el saldo en cero (no vuelve a la cotización)", () => {
    expect(saldo({ totalComprobantes: 0, totalCotizacionesAprobadas: 300, pagado: 0, conComprobante: true }).aCobrar).toBe(0);
  });
  it("abonos en partes y una devolución", () => {
    const pagos = [{ tipo: "abono", monto: 100 }, { tipo: "abono", monto: 150 }, { tipo: "devolucion", monto: 30 }];
    const pagado = pagos.reduce((a, p) => a + montoNeto(p), 0);
    expect(saldo({ totalComprobantes: 300, totalCotizacionesAprobadas: 0, pagado }).saldo).toBe(80);
  });
  it("si pagó de más, el saldo es negativo (a favor del cliente)", () => {
    expect(saldo({ totalComprobantes: 100, totalCotizacionesAprobadas: 0, pagado: 120 }).saldo).toBe(-20);
  });
});

describe("comisiones", () => {
  const reglas = [
    { id: "r1", nombre: "S/ 20 por cita que llegó y pagó", evento: "cita_llego_y_pago" as const, tipoMonto: "fijo" as const, valor: 20 },
    { id: "r2", nombre: "3 % por trabajo entregado", evento: "trabajo_entregado" as const, tipoMonto: "porcentaje" as const, valor: 3 },
  ];
  it("suma lo que corresponde a cada persona según cada regla", () => {
    const r = comisiones(reglas, [
      { evento: "cita_llego_y_pago", personaId: "andrea", ventaSinIgv: 500 },
      { evento: "cita_llego_y_pago", personaId: "andrea", ventaSinIgv: 900 },
      { evento: "trabajo_entregado", personaId: "luis", ventaSinIgv: 2415.25 },
    ]);
    expect(r.get("andrea")?.total).toBe(40);
    expect(r.get("luis")?.total).toBe(72.46);
  });
  it("sin reglas no hay comisiones", () => {
    expect(comisiones([], [{ evento: "trabajo_entregado", personaId: "luis", ventaSinIgv: 100 }]).size).toBe(0);
  });
});

describe("cierre diario", () => {
  it("separa boletas y facturas, suma cobros por medio y avisa lo que no cuadra", () => {
    const c = cierreDiario({
      comprobantes: [
        { tipo: "boleta", sinIgv: 254.24, igv: 45.76, total: 300 },
        { tipo: "factura", sinIgv: 1000, igv: 180, total: 1180 },
      ],
      compras: [{ sinIgv: 500, igv: 90, total: 590 }],
      pagos: [
        { medio: "yape", monto: 300 },
        { medio: "transferencia", monto: 1000 },
      ],
      manoObraDelDia: 150,
      entregadasSinComprobante: ["OT-000012"],
      entregadasConSaldo: [{ orden: "OT-000013", saldo: 180 }],
      comprobantesSinOrden: [],
    });
    expect(c.boletas).toEqual({ sinIgv: 254.24, igv: 45.76, total: 300, cantidad: 1 });
    expect(c.facturas.total).toBe(1180);
    expect(c.cobros).toMatchObject({ yape: 300, transferencia: 1000, efectivo: 0, total: 1300 });
    expect(c.utilidadEstimada).toBe(604.24);
    expect(c.descuadres).toEqual([
      "Se facturó S/ 180.00 más de lo cobrado hoy (queda por cobrar).",
      "OT-000012 se entregó sin comprobante.",
      "OT-000013 se entregó con S/ 180.00 de saldo.",
    ]);
  });
  it("un día que cuadra no tiene descuadres", () => {
    const c = cierreDiario({
      comprobantes: [{ tipo: "boleta", sinIgv: 100, igv: 18, total: 118 }],
      compras: [],
      pagos: [{ medio: "efectivo", monto: 118 }],
      manoObraDelDia: 0,
      entregadasSinComprobante: [],
      entregadasConSaldo: [],
      comprobantesSinOrden: [],
    });
    expect(c.descuadres).toEqual([]);
  });
});

describe("caja de recepción", () => {
  it("efectivo esperado = inicial + cobros en efectivo − devoluciones + ingresos − gastos", () => {
    const r = efectivoEsperado({
      montoInicial: 100,
      pagos: [
        { tipo: "abono", medio: "efectivo", monto: 100 },
        { tipo: "abono", medio: "yape", monto: 150 },
        { tipo: "devolucion", medio: "efectivo", monto: 10 },
      ],
      movimientos: [{ tipo: "egreso", medio: "efectivo", monto: 20 }, { tipo: "ingreso", medio: "efectivo", monto: 50 }],
    });
    expect(r).toEqual({ cobros: 90, ingresos: 50, egresos: 20, esperado: 220 });
  });
});

describe("cierre con notas de crédito", () => {
  it("la nota de crédito resta de lo vendido y de la utilidad", () => {
    const c = cierreDiario({
      comprobantes: [{ tipo: "boleta", sinIgv: 254.24, igv: 45.76, total: 300 }],
      notasCredito: [{ sinIgv: 42.37, igv: 7.63, total: 50 }],
      compras: [],
      pagos: [{ medio: "efectivo", monto: 250 }],
      manoObraDelDia: 0,
      entregadasSinComprobante: [],
      entregadasConSaldo: [],
      comprobantesSinOrden: [],
    });
    expect(c.notas).toEqual({ sinIgv: 42.37, igv: 7.63, total: 50, cantidad: 1 });
    expect(c.utilidadEstimada).toBe(211.87);
    expect(c.descuadres).toEqual([]);
  });
});

describe("alertas", () => {
  const base: OrdenParaAlertas = {
    id: "o1",
    numero: "OT-000001",
    estado: "en_proceso",
    estadoCambiadoEn: "2026-11-16T10:00:00Z",
    fotos: 2,
    servicios: 1,
    adicionales: 0,
    cotizacionesAdicionalesAprobadas: 0,
    tieneComprobante: false,
    detalleComprobantes: "",
    repuestosComprados: [],
    saldo: null,
    ventaSinIgv: null,
    margen: null,
  };
  const correr = (ordenes: OrdenParaAlertas[], extra: Partial<Parameters<typeof calcularAlertas>[0]> = {}) =>
    calcularAlertas({
      ahora: new Date("2026-11-16T12:00:00Z"),
      ordenes,
      itemsCompra: [],
      comprobantesSinOrden: [],
      horasSinCambio: 48,
      margenMinimoPct: 20,
      verDinero: true,
      verMargen: true,
      ...extra,
    }).map((a) => a.tipo);

  it("una orden al día no genera alertas", () => {
    expect(correr([base])).toEqual([]);
  });
  it("detecta las 9 situaciones de la especificación", () => {
    expect(correr([{ ...base, estadoCambiadoEn: "2026-11-13T10:00:00Z" }])).toContain("orden_estancada");
    expect(correr([{ ...base, fotos: 0 }])).toContain("ingreso_incompleto");
    expect(correr([{ ...base, adicionales: 1 }])).toContain("adicional_sin_aprobacion");
    expect(correr([{ ...base, estado: "entregado" }])).toContain("entregada_sin_comprobante");
    expect(correr([{ ...base, estado: "entregado", tieneComprobante: true, saldo: 50 }])).toContain("entregada_con_saldo");
    expect(correr([{ ...base, tieneComprobante: true, detalleComprobantes: "Mano de obra caja", repuestosComprados: ["Kit de embrague"] }])).toContain("repuesto_no_cobrado");
    expect(correr([{ ...base, ventaSinIgv: 1000, margen: 0.12 }])).toContain("margen_bajo");
    expect(correr([], { comprobantesSinOrden: ["B001-45"] })).toContain("comprobante_sin_orden");
    expect(
      correr([], {
        itemsCompra: [
          { proveedor: "Repuestos Lima", descripcion: "Pastillas de freno", precioUnitarioSinIgv: 80, fecha: "2026-10-01" },
          { proveedor: "Repuestos Lima", descripcion: "PASTILLAS de freno ", precioUnitarioSinIgv: 92, fecha: "2026-11-10" },
        ],
      }),
    ).toEqual(["precio_compra_subio"]);
  });
  it("el repuesto que sí aparece en el comprobante no alerta", () => {
    expect(correr([{ ...base, tieneComprobante: true, detalleComprobantes: "Kit de embrague y mano de obra", repuestosComprados: ["Kit de embrague"] }])).toEqual([]);
    expect(correr([{ ...base, tieneComprobante: true, detalleComprobantes: "Cambio de pastillas", repuestosComprados: ["Pastillas de freno Bosch"] }])).toEqual([]);
  });
  it("quien no ve dinero no recibe alertas de dinero; el margen solo lo ve gerencia", () => {
    expect(correr([{ ...base, estado: "entregado" }], { verDinero: false })).toEqual([]);
    expect(correr([{ ...base, ventaSinIgv: 1000, margen: 0.12 }], { verMargen: false })).toEqual([]);
  });
});
