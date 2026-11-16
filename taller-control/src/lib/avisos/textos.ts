/**
 * Textos de los avisos al personal. Funciones puras, con pruebas en tests/.
 * Los resúmenes no llevan montos: los ve cada rol sin riesgo.
 */

export type DatosTaller = {
  taller: string;
  enTaller: number;
  enProceso: number;
  esperandoRepuesto: number;
  listos: number;
  entregadosHoy: number;
  atrasados: number;
  horasSinCambio: number;
};

export type DatosPersona =
  | { tipo: "general" }
  | { tipo: "tecnico"; enProceso: number; esperandoRepuesto: number; listosHoy: number; pendientes: number }
  | { tipo: "almacen"; esperandoRepuesto: number; stockBajo: number }
  | { tipo: "vendedor"; citasHoy: number; llegaron: number; noLlegaron: number };

export function resumenDelDia(momento: "mediodia" | "cierre", nombre: string, t: DatosTaller, p: DatosPersona): { titulo: string; texto: string } {
  const saludo = `${momento === "mediodia" ? "Resumen del mediodía" : "Cierre del día"} · ${t.taller}`;
  const primer = nombre.split(" ")[0];
  let lineas: string[];
  if (p.tipo === "tecnico") {
    lineas = [`${primer}, tus trabajos: ${p.pendientes} por empezar, ${p.enProceso} en proceso, ${p.esperandoRepuesto} esperando repuesto, ${p.listosHoy} listos hoy.`];
  } else if (p.tipo === "almacen") {
    lineas = [`${primer}: ${p.esperandoRepuesto} ${p.esperandoRepuesto === 1 ? "orden espera" : "órdenes esperan"} repuesto y ${p.stockBajo} ${p.stockBajo === 1 ? "repuesto está" : "repuestos están"} en stock bajo.`];
  } else if (p.tipo === "vendedor") {
    lineas = [`${primer}, tus citas de hoy: ${p.citasHoy}; llegaron ${p.llegaron} y no llegaron ${p.noLlegaron}.`];
  } else {
    lineas = [
      `En taller ${t.enTaller + t.enProceso + t.esperandoRepuesto} (esperando repuesto ${t.esperandoRepuesto}) · Listos ${t.listos} · Entregados hoy ${t.entregadosHoy}.`,
      t.atrasados ? `${t.atrasados} ${t.atrasados === 1 ? "orden lleva" : "órdenes llevan"} más de ${t.horasSinCambio} h sin avance.` : "Ninguna orden atrasada.",
    ];
  }
  return { titulo: saludo, texto: lineas.join(" ") };
}

export function citasDelDia(taller: string, citas: { hora: string; nombre: string; servicio: string; confirmada: boolean }[]): { titulo: string; texto: string } {
  if (!citas.length) return { titulo: `Citas de hoy · ${taller}`, texto: "Hoy no hay citas agendadas." };
  const sin = citas.filter((c) => !c.confirmada).length;
  const lista = citas.slice(0, 12).map((c) => `${c.hora} ${c.nombre} (${c.servicio})${c.confirmada ? " ✓" : ""}`).join(" · ");
  return { titulo: `Citas de hoy · ${taller}`, texto: `${citas.length} ${citas.length === 1 ? "cita" : "citas"}, ${sin} sin confirmar: ${lista}${citas.length > 12 ? " …" : ""}` };
}

export function citaNoLlego(nombre: string, hora: string, servicio: string): { titulo: string; texto: string } {
  return { titulo: "Cita sin llegada", texto: `${nombre} no llegó a su cita de las ${hora} (${servicio}). Llámalo para reagendar.` };
}

type DatosEntrega = { placa: string; cliente: string; celular: string; hora: string; estado: string; minutos: string };

/** Antes de la hora prometida, si el carro todavía no está listo. */
export function entregaPorVencer(d: DatosEntrega): { titulo: string; texto: string } {
  return {
    titulo: `Entrega en ${d.minutos}: ${d.placa}`,
    texto: `Se le prometió a ${d.cliente} para ${d.hora} y el carro sigue «${d.estado}». Si no llega a tiempo, avísale antes: ${d.celular}.`,
  };
}

/** Pasada la hora prometida, con el carro todavía sin terminar. */
export function entregaAtrasada(d: DatosEntrega): { titulo: string; texto: string } {
  return {
    titulo: `Entrega atrasada: ${d.placa}`,
    texto: `Se le prometió a ${d.cliente} para ${d.hora} (hace ${d.minutos}) y sigue «${d.estado}». Llámalo con la nueva hora: ${d.celular}, y cámbiala en la orden.`,
  };
}

/** Las variables de una plantilla de WhatsApp no pueden tener saltos de línea. */
export function aUnaLinea(texto: string): string {
  return texto.replace(/\s*\n+\s*/g, " · ").replace(/\s{4,}/g, "   ").slice(0, 1000);
}
