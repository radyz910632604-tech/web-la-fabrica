/**
 * Usuario para entrar al sistema (separado del celular).
 * Minúsculas, sin espacios ni tildes; letras, números, punto y guion bajo; de 3 a 30.
 * Este archivo no importa nada: lo usan la pantalla, el servidor y las pruebas.
 */

export const REGLA_USUARIO = "De 3 a 30: minúsculas, números, punto (.) o guion bajo (_). Sin espacios ni tildes.";

/** Lo que la persona escribe, en la forma que se guarda (minúsculas, sin espacios a los lados). */
export function normalizarUsuario(texto: string): string {
  return texto.trim().toLowerCase();
}

export function esUsuarioValido(usuario: string): boolean {
  return /^[a-z0-9._]{3,30}$/.test(usuario);
}

/** Sugerencia a partir del nombre: «Cecilia Minope Ruiz» → «cecilia.minope». Igual que en la base. */
export function sugerirUsuario(nombre: string): string {
  const limpio = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!limpio.length) return "";
  const base = (limpio.length >= 2 ? `${limpio[0]}.${limpio[1]}` : limpio[0]).slice(0, 26);
  return base.length < 3 ? base.padEnd(3, "0") : base;
}
