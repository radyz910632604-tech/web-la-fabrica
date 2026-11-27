/** Periodos para los resúmenes de caja (días en hora de Lima, «hasta» incluido). Funciones puras. */

export type Periodo = "hoy" | "ayer" | "semana" | "mes" | "rango";
export const PERIODOS: [Periodo, string][] = [
  ["hoy", "Hoy"],
  ["ayer", "Ayer"],
  ["semana", "Esta semana"],
  ["mes", "Este mes"],
  ["rango", "Elegir fechas"],
];

const esDia = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const sumarDias = (dia: string, n: number) => {
  const f = new Date(`${dia}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
};

/** Días de inicio y fin del periodo. La semana empieza el lunes. */
export function rangoPeriodo(periodo: string | undefined, hoy: string, desde?: string, hasta?: string): { periodo: Periodo; desde: string; hasta: string } {
  if (periodo === "ayer") return { periodo, desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
  if (periodo === "semana") {
    const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay(); // 0 = domingo
    return { periodo, desde: sumarDias(hoy, -((dow + 6) % 7)), hasta: hoy };
  }
  if (periodo === "mes") return { periodo, desde: `${hoy.slice(0, 7)}-01`, hasta: hoy };
  if (periodo === "rango" && esDia(desde)) {
    let fin = esDia(hasta) ? hasta! : hoy;
    if (fin > hoy) fin = hoy;
    const inicio = desde! > fin ? fin : desde!;
    return { periodo, desde: inicio, hasta: fin };
  }
  return { periodo: "hoy", desde: hoy, hasta: hoy };
}

/** Instantes para consultar: desde las 00:00 de Lima del primer día hasta las 00:00 del día siguiente al último. */
export function instantesPeriodo(desde: string, hasta: string): { inicio: string; fin: string } {
  return { inicio: `${desde}T00:00:00-05:00`, fin: `${sumarDias(hasta, 1)}T00:00:00-05:00` };
}
