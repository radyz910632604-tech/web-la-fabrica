/**
 * Celulares: se guardan en formato internacional (+51987654321) y se
 * aceptan escritos como la gente los escribe (987 654 321, 51987654321…).
 *
 * El login es "celular + contraseña". Por dentro, Supabase usa un correo
 * interno que nunca recibe mensajes: el dominio .invalid está reservado
 * para eso y no existe en internet.
 *
 * Este archivo no importa nada: lo usan la app y los scripts de Node.
 */

export const DOMINIO_LOGIN = "celular.taller-control.invalid";

/** Devuelve el celular en formato +51987654321, o null si no es válido. */
export function normalizarCelular(entrada: string): string | null {
  const limpio = entrada.trim().replace(/[\s\-().]/g, "");
  if (!/^\+?\d+$/.test(limpio)) return null;

  // Un número de otro país se escribe con + o 00 delante; sin eso, se asume Perú.
  const internacional = limpio.startsWith("+") || limpio.startsWith("00");
  let digitos = limpio.replace(/^\+|^00/, "");

  // Celular peruano escrito sin código de país: 9 dígitos que empiezan en 9.
  if (/^9\d{8}$/.test(digitos)) digitos = `51${digitos}`;

  // Perú (+51): solo celulares, 9 dígitos que empiezan en 9.
  if (digitos.startsWith("51")) {
    return /^519\d{8}$/.test(digitos) ? `+${digitos}` : null;
  }

  // Otros países: solo con + o 00, en formato internacional (E.164).
  return internacional && /^[1-9]\d{7,14}$/.test(digitos) ? `+${digitos}` : null;
}

/** El correo interno con el que Supabase identifica a la persona. */
export function celularAEmail(celular: string): string {
  return `${celular.replace(/^\+/, "")}@${DOMINIO_LOGIN}`;
}

/** +51987654321 → "987 654 321". Otros países se muestran completos. */
export function formatearCelular(celular: string): string {
  const peru = /^\+51(9\d{2})(\d{3})(\d{3})$/.exec(celular);
  return peru ? `${peru[1]} ${peru[2]} ${peru[3]}` : celular;
}
