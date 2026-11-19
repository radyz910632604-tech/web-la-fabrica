/**
 * Monto en letras para recibos: 550 → «QUINIENTOS CINCUENTA EXACTOS»,
 * 1250.5 → «MIL DOSCIENTOS CINCUENTA CON 50/100». Función pura, con pruebas.
 */

const UNIDADES = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const ESPECIALES = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE"];
const VEINTIS = ["VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function hastaCien(n: number): string {
  if (n < 10) return UNIDADES[n];
  if (n < 20) return ESPECIALES[n - 10];
  if (n < 30) return VEINTIS[n - 20];
  const d = Math.floor(n / 10);
  const u = n % 10;
  return u ? `${DECENAS[d]} Y ${UNIDADES[u]}` : DECENAS[d];
}

function hastaMil(n: number): string {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  return [CENTENAS[c], hastaCien(resto)].filter(Boolean).join(" ");
}

/** Número entero (hasta 999 999 999) en letras, en mayúsculas. */
export function enteroEnLetras(n: number): string {
  const entero = Math.floor(Math.abs(n));
  if (entero === 0) return "CERO";
  const millones = Math.floor(entero / 1_000_000);
  const miles = Math.floor((entero % 1_000_000) / 1000);
  const resto = entero % 1000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${hastaMil(millones).replace(/UNO$/, "UN")} MILLONES`);
  if (miles) partes.push(miles === 1 ? "MIL" : `${hastaMil(miles).replace(/UNO$/, "UN")} MIL`);
  if (resto) partes.push(hastaMil(resto));
  return partes.join(" ");
}

/** «QUINIENTOS CINCUENTA EXACTOS» o «… CON 50/100», como en el recibo del taller. */
export function montoEnLetras(monto: number): string {
  const centimos = Math.round(Math.abs(monto) * 100);
  const soles = Math.floor(centimos / 100);
  const resto = centimos % 100;
  const letras = enteroEnLetras(soles);
  return resto ? `${letras} CON ${String(resto).padStart(2, "0")}/100` : `${letras} EXACTOS`;
}
