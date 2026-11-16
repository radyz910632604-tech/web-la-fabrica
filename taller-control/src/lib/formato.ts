/**
 * Formatos del taller: soles, porcentajes y fechas en hora de Lima.
 */

export const ZONA = "America/Lima";

const soles = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const solesEnteros = new Intl.NumberFormat("es-PE", {
  style: "currency",
  currency: "PEN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const entero = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 0 });

/** 1250 → "S/ 1,250.00" */
export function formatearSoles(monto: number, { sinDecimales = false } = {}): string {
  return (sinDecimales ? solesEnteros : soles).format(monto);
}

/** 14 → "14", 1234 → "1,234" */
export function formatearEntero(n: number): string {
  return entero.format(n);
}

/** 0.0702 → "+7.0 %"; 0 → "0.0 %" (sin signo). */
export function formatearVariacion(fraccion: number): string {
  const pct = Math.round(fraccion * 1000) / 10;
  if (pct === 0) return "0.0 %";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)} %`;
}

/** Variación entre dos valores. Sin base (0) no hay variación: null. */
export function variacion(actual: number, anterior: number): number | null {
  if (anterior === 0) return null;
  return (actual - anterior) / anterior;
}

/** Hora (0-23) en Lima para un instante. */
export function horaEnLima(fecha: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: ZONA, hour: "2-digit", hour12: false }).format(fecha),
  ) % 24;
}

/** "Buenos días" / "Buenas tardes" / "Buenas noches" según la hora de Lima. */
export function saludo(fecha: Date): string {
  const hora = horaEnLima(fecha);
  if (hora >= 5 && hora < 12) return "Buenos días";
  if (hora >= 12 && hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** Fecha de Lima como "2026-11-16". */
export function diaEnLima(fecha: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(fecha);
}

/** "Hoy 09:40", "Ayer 17:15" o "12 nov 10:05", siempre en hora de Lima. */
export function formatearMomento(fecha: Date, ahora: Date = new Date()): string {
  const hora = new Intl.DateTimeFormat("es-PE", {
    timeZone: ZONA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(fecha);
  const dia = diaEnLima(fecha);
  if (dia === diaEnLima(ahora)) return `Hoy ${hora}`;
  const ayer = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  if (dia === diaEnLima(ayer)) return `Ayer ${hora}`;
  const fechaCorta = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "numeric", month: "short" })
    .format(fecha)
    .replace(".", "");
  return `${fechaCorta} ${hora}`;
}

/** Nombre del mes en Lima: "noviembre". */
export function nombreMes(fecha: Date): string {
  return new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, month: "long" }).format(fecha).toLowerCase();
}

/** Primer nombre: "Rosa Huamán" → "Rosa". */
export function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}

/** Iniciales para el avatar: "Rosa Huamán" → "RH". */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const letras = (partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "");
  return letras.toUpperCase();
}
