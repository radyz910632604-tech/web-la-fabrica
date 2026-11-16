import { describe, expect, it } from "vitest";
import { calcularAlertas, type OrdenParaAlertas } from "@/lib/alertas";
import { entregaAtrasada, entregaPorVencer } from "@/lib/avisos/textos";
import { fechaHoraDesdeTexto, interpretarSinIa } from "@/lib/ia/sin-ia";
import { atajosEntrega, colorSituacion, cuandoEntrega, duracion, instanteLima, partesLima, situacionEntrega, textoSituacion, validarEntrega } from "@/lib/taller/entrega";

// Lunes 16 de noviembre de 2026, 3:00 p. m. en Lima
const ahora = new Date("2026-11-16T15:00:00-05:00");
const en = (min: number) => new Date(ahora.getTime() + min * 60_000);

describe("situación de la entrega prometida", () => {
  it("sin hora prometida", () => {
    expect(situacionEntrega({ entregaPrometida: null, estado: "en_proceso" }, ahora).tipo).toBe("sin_hora");
  });
  it("a tiempo, por vencer y atrasada según el margen de aviso", () => {
    expect(situacionEntrega({ entregaPrometida: en(300), estado: "en_taller" }, ahora, 120)).toEqual({ tipo: "a_tiempo", minutos: 300 });
    expect(situacionEntrega({ entregaPrometida: en(90), estado: "en_proceso" }, ahora, 120)).toEqual({ tipo: "por_vencer", minutos: 90 });
    expect(situacionEntrega({ entregaPrometida: en(-40), estado: "esperando_repuesto" }, ahora, 120)).toEqual({ tipo: "atrasada", minutos: 40 });
  });
  it("un carro listo ya no está atrasado: se ve si cumplió", () => {
    expect(situacionEntrega({ entregaPrometida: en(-40), estado: "listo", listoEn: en(-60) }, ahora).tipo).toBe("cumplida");
    expect(situacionEntrega({ entregaPrometida: en(-40), estado: "entregado", listoEn: en(-10) }, ahora)).toEqual({ tipo: "tarde", minutos: 30 });
  });
  it("textos y colores", () => {
    expect(textoSituacion({ tipo: "atrasada", minutos: 40 })).toBe("Atrasada 40 min");
    expect(textoSituacion({ tipo: "por_vencer", minutos: 80 })).toBe("Faltan 1 h 20 min");
    expect(colorSituacion({ tipo: "por_vencer", minutos: 10 })).toBe("amarillo");
    expect(colorSituacion({ tipo: "atrasada", minutos: 10 })).toBe("rojo");
    expect(colorSituacion({ tipo: "a_tiempo", minutos: 500 })).toBe("verde");
  });
});

describe("cómo se dice la hora", () => {
  it("duraciones cortas y largas", () => {
    expect(duracion(45)).toBe("45 min");
    expect(duracion(120)).toBe("2 h");
    expect(duracion(130)).toBe("2 h 10 min");
    expect(duracion(3 * 1440)).toBe("3 días");
  });
  it("hoy, mañana o el día de la semana, en hora de Lima", () => {
    expect(cuandoEntrega(new Date("2026-11-16T18:00:00-05:00"), ahora)).toBe("hoy 6:00 p. m.");
    expect(cuandoEntrega(new Date("2026-11-17T10:30:00-05:00"), ahora)).toBe("mañana 10:30 a. m.");
    expect(cuandoEntrega(new Date("2026-11-19T09:00:00-05:00"), ahora)).toMatch(/^jue 19\/11 9:00 a\. m\.$/);
    expect(cuandoEntrega(new Date("2026-11-17T12:00:00-05:00"), ahora)).toBe("mañana 12:00 m.");
  });
  it("valida lo que llega de la pantalla", () => {
    expect(validarEntrega({ dia: "", hora: "", porDefinir: true }, ahora)).toEqual({ instante: null });
    expect(validarEntrega({ dia: "", hora: "", porDefinir: false }, ahora)).toHaveProperty("error");
    expect(validarEntrega({ dia: "2026-11-16", hora: "10:00", porDefinir: false }, ahora)).toEqual({ error: "Esa hora ya pasó. Elige una hora que todavía no llegue." });
    expect(validarEntrega({ dia: "2026-11-16", hora: "18:00", porDefinir: false }, ahora)).toEqual({ instante: new Date("2026-11-16T23:00:00.000Z") });
  });
  it("de los campos de pantalla al instante y de vuelta", () => {
    const d = instanteLima("2026-11-18", "17:30")!;
    expect(d.toISOString()).toBe("2026-11-18T22:30:00.000Z");
    expect(partesLima(d)).toEqual({ dia: "2026-11-18", hora: "17:30" });
    expect(instanteLima("18/11", "5pm")).toBeNull();
  });
  it("atajos: hoy 6 p. m. solo si falta al menos una hora", () => {
    expect(atajosEntrega(ahora).map((a) => a.etiqueta)).toEqual(["Hoy 6 p. m.", "Mañana 12 m.", "Mañana 6 p. m."]);
    expect(atajosEntrega(new Date("2026-11-16T17:30:00-05:00")).map((a) => a.etiqueta)).toEqual(["Mañana 12 m.", "Mañana 6 p. m."]);
  });
});

describe("avisos al asesor", () => {
  const datos = { placa: "ABC-123", cliente: "Juan Pérez", celular: "987 654 321", hora: "hoy 6:00 p. m.", estado: "En proceso", minutos: "1 h 30 min" };
  it("antes de vencer", () => {
    const a = entregaPorVencer(datos);
    expect(a.titulo).toBe("Entrega en 1 h 30 min: ABC-123");
    expect(a.texto).toContain("Se le prometió a Juan Pérez para hoy 6:00 p. m.");
    expect(a.texto).toContain("987 654 321");
  });
  it("cuando ya pasó la hora", () => {
    const a = entregaAtrasada({ ...datos, minutos: "40 min" });
    expect(a.titulo).toBe("Entrega atrasada: ABC-123");
    expect(a.texto).toContain("hace 40 min");
  });
});

describe("WhatsApp: hora prometida al recibir el carro", () => {
  it("entiende «entrega hoy 6pm» sin IA y no lo confunde con el servicio", () => {
    const m = interpretarSinIa("ingreso ABC123 Juan Perez 987654321 para cambio de aceite, entrega hoy 6pm");
    expect(m.intencion).toBe("nuevo_ingreso");
    expect(m.servicios).toEqual(["cambio de aceite"]);
    expect(m.entrega_prometida).toBe("hoy 6pm");
    expect(fechaHoraDesdeTexto(m.entrega_prometida!, "2026-11-16")).toBe("2026-11-16T18:00");
  });
  it("también «se entrega mañana a las 10am» y «para recoger el jueves 5pm»", () => {
    expect(interpretarSinIa("ingreso ABC123 por frenos se entrega mañana a las 10am").entrega_prometida).toBe("mañana a las 10am");
    expect(interpretarSinIa("ingreso ABC123 por frenos, recoge el jueves 5pm").entrega_prometida).toBe("el jueves 5pm");
    expect(interpretarSinIa("ingreso ABC123 por frenos").entrega_prometida).toBeNull();
  });
});

describe("alertas de entrega", () => {
  const base: OrdenParaAlertas = {
    id: "o1", numero: "OT-000001", estado: "en_proceso", estadoCambiadoEn: ahora.toISOString(), fotos: 2, servicios: 1, adicionales: 0,
    cotizacionesAdicionalesAprobadas: 0, tieneComprobante: false, detalleComprobantes: "", repuestosComprados: [], saldo: null, ventaSinIgv: null, margen: null, placa: "ABC-123",
  };
  const correr = (o: Partial<OrdenParaAlertas>) =>
    calcularAlertas({ ahora, ordenes: [{ ...base, ...o }], itemsCompra: [], comprobantesSinOrden: [], horasSinCambio: 48, margenMinimoPct: 20, verDinero: false, verMargen: false });
  it("atrasada es urgente, por vencer es atención y sin hora es para revisar", () => {
    expect(correr({ entregaPrometida: en(-30).toISOString() })[0]).toMatchObject({ tipo: "entrega_atrasada", severidad: "urgente" });
    expect(correr({ entregaPrometida: en(-30).toISOString() })[0].mensaje).toContain("OT-000001 (ABC-123) se prometió para hoy 2:30 p. m. y va 30 min tarde");
    expect(correr({ entregaPrometida: en(60).toISOString() })[0]).toMatchObject({ tipo: "entrega_por_vencer", severidad: "atencion" });
    expect(correr({ entregaPrometida: null })[0]).toMatchObject({ tipo: "entrega_sin_hora", severidad: "info" });
    expect(correr({ entregaPrometida: en(600).toISOString() })).toHaveLength(0);
  });
  it("un carro listo no tiene alerta de entrega", () => {
    expect(correr({ estado: "listo", entregaPrometida: en(-30).toISOString() })).toHaveLength(0);
  });
});

describe("monto en letras del recibo", async () => {
  const { montoEnLetras, enteroEnLetras } = await import("@/lib/letras");
  it("como en el recibo del taller", () => {
    expect(montoEnLetras(550)).toBe("QUINIENTOS CINCUENTA EXACTOS");
    expect(montoEnLetras(1600)).toBe("MIL SEISCIENTOS EXACTOS");
    expect(montoEnLetras(889.99)).toBe("OCHOCIENTOS OCHENTA Y NUEVE CON 99/100");
    expect(montoEnLetras(100)).toBe("CIEN EXACTOS");
    expect(montoEnLetras(121)).toBe("CIENTO VEINTIUNO EXACTOS");
  });
  it("miles y millones", () => {
    expect(enteroEnLetras(21000)).toBe("VEINTIÚN MIL".replace("Ú", "U"));
    expect(enteroEnLetras(1_250_000)).toBe("UN MILLÓN DOSCIENTOS CINCUENTA MIL");
    expect(enteroEnLetras(2_000_001)).toBe("DOS MILLONES UNO");
  });
});
