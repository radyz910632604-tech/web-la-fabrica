import { ZONA, diaEnLima } from "@/lib/formato";
import { ESTADOS_EN_TRABAJO } from "@/lib/taller/estados";

/**
 * Hora de entrega prometida al cliente: cómo va cada orden respecto a lo que
 * se le prometió, y cómo decirlo. Funciones puras (con pruebas en tests/).
 */

export type SituacionEntrega =
  | { tipo: "sin_hora" }
  | { tipo: "a_tiempo"; minutos: number } // faltan
  | { tipo: "por_vencer"; minutos: number } // faltan, dentro del margen de aviso
  | { tipo: "atrasada"; minutos: number } // de atraso, y el carro todavía no está listo
  | { tipo: "cumplida" } // quedó listo antes de la hora
  | { tipo: "tarde"; minutos: number }; // quedó listo, pero después de la hora

const ABIERTOS = new Set<string>(ESTADOS_EN_TRABAJO);

export function situacionEntrega(
  o: { entregaPrometida: Date | null; estado: string; listoEn?: Date | null },
  ahora: Date,
  minutosAviso = 120,
): SituacionEntrega {
  if (!o.entregaPrometida) return { tipo: "sin_hora" };
  const prometida = o.entregaPrometida.getTime();
  if (!ABIERTOS.has(o.estado)) {
    const listo = o.listoEn?.getTime();
    if (!listo || listo <= prometida) return { tipo: "cumplida" };
    return { tipo: "tarde", minutos: Math.round((listo - prometida) / 60_000) };
  }
  const faltan = Math.round((prometida - ahora.getTime()) / 60_000);
  if (faltan < 0) return { tipo: "atrasada", minutos: -faltan };
  if (faltan <= minutosAviso) return { tipo: "por_vencer", minutos: faltan };
  return { tipo: "a_tiempo", minutos: faltan };
}

/** "45 min", "2 h", "1 h 20 min", "3 días". */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r && h < 10 ? `${h} h ${r} min` : `${h} h`;
  }
  return `${Math.round(m / 1440)} días`;
}

/** "6:00 p. m." en hora de Lima; el mediodía exacto, "12:00 m." como se dice en Perú. */
export function horaCorta(fecha: Date): string {
  const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fecha);
  if (hhmm === "12:00") return "12:00 m.";
  return new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, hour: "numeric", minute: "2-digit", hour12: true })
    .format(fecha)
    .replace(/\s+/g, " ")
    .replace(/a\.?\s?m\.?/i, "a. m.")
    .replace(/p\.?\s?m\.?/i, "p. m.");
}

/** "hoy 6:00 p. m.", "mañana 10:30 a. m.", "ayer 5:00 p. m." o "lun 18/11 9:00 a. m.". */
export function cuandoEntrega(fecha: Date, ahora: Date = new Date()): string {
  const dia = diaEnLima(fecha);
  const hora = horaCorta(fecha);
  if (dia === diaEnLima(ahora)) return `hoy ${hora}`;
  if (dia === diaEnLima(new Date(ahora.getTime() + 86_400_000))) return `mañana ${hora}`;
  if (dia === diaEnLima(new Date(ahora.getTime() - 86_400_000))) return `ayer ${hora}`;
  const semana = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, weekday: "short" }).format(fecha).replace(".", "");
  const dm = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "2-digit", month: "2-digit" }).format(fecha);
  return `${semana} ${dm} ${hora}`;
}

/** Frase corta para listas y fichas: "Entrega hoy 6:00 p. m. · faltan 2 h", "Atrasada 40 min". */
export function textoSituacion(s: SituacionEntrega): string {
  switch (s.tipo) {
    case "sin_hora":
      return "Hora de entrega por definir";
    case "a_tiempo":
    case "por_vencer":
      return `Faltan ${duracion(s.minutos)}`;
    case "atrasada":
      return `Atrasada ${duracion(s.minutos)}`;
    case "cumplida":
      return "Listo a tiempo";
    case "tarde":
      return `Listo ${duracion(s.minutos)} tarde`;
  }
}

/** Color del punto según la situación (los mismos de los estados). */
export function colorSituacion(s: SituacionEntrega): "gris" | "verde" | "amarillo" | "rojo" {
  if (s.tipo === "atrasada" || s.tipo === "tarde") return "rojo";
  if (s.tipo === "por_vencer") return "amarillo";
  if (s.tipo === "sin_hora") return "gris";
  return "verde";
}

/** Instante desde el día y la hora de Lima que se eligen en pantalla ("2026-11-18", "17:30"). */
export function instanteLima(dia: string, hora: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const d = new Date(`${dia}T${hora}:00-05:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Día ("2026-11-18") y hora ("17:30") de Lima para llenar los campos de pantalla. */
export function partesLima(fecha: Date): { dia: string; hora: string } {
  const hora = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fecha);
  return { dia: diaEnLima(fecha), hora };
}

/**
 * Atajos para elegir rápido al recibir el carro: hoy a las 6 p. m. (si aún
 * falta al menos una hora), mañana a las 12 m. y mañana a las 6 p. m.
 */
export function atajosEntrega(ahora: Date): { etiqueta: string; dia: string; hora: string }[] {
  const hoy = diaEnLima(ahora);
  const manana = diaEnLima(new Date(ahora.getTime() + 86_400_000));
  const lista: { etiqueta: string; dia: string; hora: string }[] = [];
  const hoySeis = instanteLima(hoy, "18:00")!;
  if (hoySeis.getTime() - ahora.getTime() >= 60 * 60_000) lista.push({ etiqueta: "Hoy 6 p. m.", dia: hoy, hora: "18:00" });
  lista.push({ etiqueta: "Mañana 12 m.", dia: manana, hora: "12:00" });
  lista.push({ etiqueta: "Mañana 6 p. m.", dia: manana, hora: "18:00" });
  return lista;
}

/**
 * Lo que llega de la pantalla: una hora futura, o «por definir» si se marcó.
 * Se acepta hasta 5 minutos en el pasado (lo que tarda en llenarse el formulario).
 */
export function validarEntrega(v: { dia: string; hora: string; porDefinir: boolean }, ahora: Date): { instante: Date | null } | { error: string } {
  if (v.porDefinir && !v.dia && !v.hora) return { instante: null };
  if (!v.dia || !v.hora) return { error: "Elige el día y la hora que le prometes al cliente, o marca «Por definir»." };
  const instante = instanteLima(v.dia, v.hora);
  if (!instante) return { error: "Revisa el día y la hora." };
  if (instante.getTime() < ahora.getTime() - 5 * 60_000) return { error: "Esa hora ya pasó. Elige una hora que todavía no llegue." };
  if (instante.getTime() > ahora.getTime() + 90 * 86_400_000) return { error: "Es más de tres meses: revisa el día." };
  return { instante };
}
