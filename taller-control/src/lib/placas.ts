/**
 * Placas peruanas. Se guardan en mayúsculas sin guion (ABC123) y se
 * muestran con guion (ABC-123).
 *
 * Formato actual: 3 letras o números (al menos una letra) + 3 números.
 * Si llega otro formato (moto, placa antigua, extranjera), el sistema no la
 * rechaza: pide confirmarla (ver estado "revisar").
 */

export type ResultadoPlaca =
  | { estado: "valida"; placa: string }
  | { estado: "revisar"; placa: string }
  | { estado: "invalida" };

export function normalizarPlaca(entrada: string): string {
  return entrada.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function validarPlaca(entrada: string): ResultadoPlaca {
  const placa = normalizarPlaca(entrada);
  if (placa.length < 4 || placa.length > 8) return { estado: "invalida" };
  if (/^(?=[A-Z0-9]{0,2}[A-Z])[A-Z0-9]{3}\d{3}$/.test(placa)) return { estado: "valida", placa };
  return { estado: "revisar", placa };
}

/** ABC123 → "ABC-123". Otros formatos se muestran tal cual. */
export function formatearPlaca(placa: string): string {
  const p = normalizarPlaca(placa);
  return /^[A-Z0-9]{3}\d{3}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}
