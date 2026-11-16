import { mensajeVacio, type MensajeInterpretado } from "./esquemas";

/**
 * Lector de mensajes SIN IA: entiende frases cortas con un formato simple
 * ("ABC123 listo", "pago ABC123 150 yape", "historial ABC123"). Sirve de
 * respaldo cuando no hay llave de IA configurada y para las pruebas.
 * Función pura, con pruebas en tests/.
 */

const PLACA = /\b([A-Z]{3}|[A-Z]\d[A-Z]|[A-Z]{2}\d|[A-Z]\d{2}|\d[A-Z]{2})[\s-]?(\d{3})\b/i;
const CELULAR = /(?:\+?51\s?)?\b(9\d{2})[\s-]?(\d{3})[\s-]?(\d{3})\b/;
const MONTO = /(?:s\/\.?\s*|soles?\s*)(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s*(?:soles|lucas|luca|s\/)/i;
const MONTO_SUELTO = /\b(\d{1,6}(?:[.,]\d{1,2})?)\b/;

export function normalizarPlaca(texto: string | null | undefined): string | null {
  if (!texto) return null;
  const m = PLACA.exec(texto.toUpperCase());
  return m ? `${m[1]}${m[2]}`.toUpperCase() : null;
}

function quitar(texto: string, ...partes: (string | null | undefined)[]) {
  let t = texto;
  for (const p of partes) if (p) t = t.replace(p, " ");
  return t.replace(/\s+/g, " ").trim();
}

export function interpretarSinIa(entrada: string): MensajeInterpretado {
  const texto = entrada.trim();
  const bajo = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const placaCruda = PLACA.exec(texto)?.[0] ?? null;
  const placa = normalizarPlaca(texto);

  if (/^(ayuda|help|\?|menu|hola|buenas?)\b/.test(bajo)) return mensajeVacio("ayuda");
  if (/^(historial|historia|que se le hizo)\b/.test(bajo)) return { ...mensajeVacio("historial"), placa };

  // Pago: "pago ABC123 150 yape abono"
  if (/\b(pag[oa]|pagado|yape|plin|abono|abon[oó]|adelanto|cancel[oó]|cobr[eé])\b/.test(bajo)) {
    const m = MONTO.exec(texto) ?? MONTO_SUELTO.exec(quitar(texto, placaCruda));
    const monto = m ? Number((m[1] ?? m[2]).replace(",", ".")) : null;
    const medio = /\byape\b/.test(bajo) ? "yape" : /\bplin\b/.test(bajo) ? "plin" : /\btarjeta|pos|visa\b/.test(bajo) ? "tarjeta" : /\btransfer/.test(bajo) ? "transferencia" : /\befectivo|cash\b/.test(bajo) ? "efectivo" : null;
    const tipo = /\badelanto\b/.test(bajo) ? "adelanto" : /\babon/.test(bajo) ? "abono" : /\b(saldo|cancel|final|complet)/.test(bajo) ? "saldo" : null;
    return { ...mensajeVacio("pago"), placa, monto, medio_pago: medio, tipo_pago: tipo, dudas: monto === null ? "No se entendió el monto." : null };
  }

  // Cita: "cita Juan Perez 987654321 mañana 10am cambio de aceite"
  if (/\b(cita|agendar|agenda)\b/.test(bajo)) {
    const cel = CELULAR.exec(texto);
    return { ...mensajeVacio("cita"), cliente_celular: cel ? `${cel[1]}${cel[2]}${cel[3]}` : null, observaciones: texto, dudas: "Revisa la fecha y la hora de la cita." };
  }

  if (/\bcotiza/.test(bajo)) return { ...mensajeVacio("cotizacion"), placa, observaciones: texto };

  // Ingreso: "ingreso ABC123 Juan Perez 987654321 cambio de aceite y frenos 85000 km"
  if (/\b(ingres[oa]|nuevo ingreso|entr[oó]|lleg[oó])\b/.test(bajo)) {
    const cel = CELULAR.exec(texto);
    const km = /(\d{1,3}(?:[.\s]?\d{3})+|\d{3,6})\s*(?:km|kms|kilometros)/i.exec(texto);
    const resto = quitar(texto.replace(/^(nuevo\s+)?ingres[oa]\s*:?/i, ""), placaCruda, cel?.[0], km?.[0]);
    const [nombreParte, ...servicioParte] = resto.split(/\s+(?:para|por|servicio:?)\s+/i);
    const servicios = (servicioParte.join(" ") || "").split(/\s*(?:,|\by\b)\s*/).map((s) => s.trim()).filter((s) => s.length > 2);
    return {
      ...mensajeVacio("nuevo_ingreso"),
      placa,
      cliente_celular: cel ? `${cel[1]}${cel[2]}${cel[3]}` : null,
      cliente_nombre: nombreParte && servicioParte.length ? nombreParte.trim() || null : null,
      servicios: servicioParte.length ? servicios : resto ? [resto] : [],
      kilometraje: km ? Number(km[1].replace(/[.\s]/g, "")) : null,
    };
  }

  // Avance: "ABC123 listo", "ABC123 esperando repuesto", "avance ABC123 ya se cambió el embrague"
  if (placa && (/\b(avance|listo|lista|terminado|termine|esperando|falta repuesto|en proceso|empece|desarm)/.test(bajo) || bajo.length > 0)) {
    const estado = /\b(listo|lista|terminado|termine)\b/.test(bajo)
      ? "listo"
      : /\b(esperando|falta repuesto|sin repuesto)\b/.test(bajo)
        ? "esperando_repuesto"
        : /\b(en proceso|empece|empezamos|desarm)/.test(bajo)
          ? "en_proceso"
          : null;
    const avance = quitar(texto.replace(/^avance\s*:?/i, ""), placaCruda);
    return { ...mensajeVacio("avance"), placa, nuevo_estado: estado, texto_avance: avance || null };
  }

  return mensajeVacio("desconocido");
}
