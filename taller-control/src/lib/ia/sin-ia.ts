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

/** «85 mil», «85,000 km», «58000» → kilómetros. */
function kilometros(bajo: string): number | null {
  const mil = /(\d{1,3}(?:[.,]\d{1,3})?)\s*mil\b/.exec(bajo);
  if (mil) return Math.round(Number(mil[1].replace(",", ".")) * 1000);
  const n = /(\d{1,3}(?:[.\s,]\d{3})+|\d{3,7})/.exec(bajo);
  return n ? Number(n[1].replace(/[.\s,]/g, "")) : null;
}

export function interpretarSinIa(entrada: string): MensajeInterpretado {
  const texto = entrada.trim();
  const bajo = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const placaCruda = PLACA.exec(texto)?.[0] ?? null;
  const placa = normalizarPlaca(texto);

  if (/^(ayuda|help|\?|menu|hola|buenas?)\b/.test(bajo)) return mensajeVacio("ayuda");
  // «historial ABC123 en pdf» → el PDF; «historial ABC123» → la respuesta corta por WhatsApp.
  if (/^(historial|historia|que se le hizo)\b/.test(bajo)) return /\bpdf\b/.test(bajo) ? { ...mensajeVacio("documento"), documento: "historial", placa } : { ...mensajeVacio("historial"), placa };
  if (/^(?:(?:manda(?:me)?|envia(?:me)?|pasa(?:me)?|dame)\s+)?(?:el\s+)?(?:pdf\s+(?:de(?:l)?\s+)?)?(historial)\b/.test(bajo) && placa) return { ...mensajeVacio("documento"), documento: "historial", placa };
  if (/^(?:(?:manda(?:me)?|envia(?:me)?|pasa(?:me)?|dame)\s+)?(?:el\s+)?resumen(?:\s+(?:para|de)\s+factura(?:r|cion))?\b/.test(bajo) && placa) return { ...mensajeVacio("documento"), documento: "resumen", placa };

  // Pedir un documento: «recibo ABC123», «mándame la cotización de ABC123», «cierre de caja».
  const doc = /^(?:(?:manda(?:me)?|envia(?:me)?|pasa(?:me)?|dame|quiero|pdf(?: de)?)\s+)?(?:(?:el|la)\s+)?(?:pdf\s+(?:de\s+)?(?:el|la)?\s*)?(recibo|cotizacion|proforma|orden(?: de (?:trabajo|reparacion))?|cierre(?: de caja)?|arqueo(?: de caja)?|caja)\b/.exec(bajo);
  if (doc) {
    const tipo = /^(recibo)/.test(doc[1]) ? "recibo" : /^(cotizacion|proforma)/.test(doc[1]) ? "cotizacion" : /^orden/.test(doc[1]) ? "orden" : "caja";
    const resto = quitar(bajo.slice(doc[0].length), placaCruda?.toLowerCase());
    if ((tipo === "caja" && !placa) || (placa && !/\d/.test(resto))) return { ...mensajeVacio("documento"), documento: tipo, placa };
  }

  // Llegaron repuestos (nota de voz de almacén): «llegaron de Lubricantes Demo factura F001-123: 4 aceite 10W40 a 85, 2 filtro a 30».
  if (/^(llegaron|recibi(mos)?|compre|compramos|compra de)\b/.test(bajo) || /\b(repuestos?|pedido|mercaderia)\b.*\b(llegaron|llego)\b|\b(llegaron|llego)\b.*\b(repuestos?|pedido|mercaderia)\b/.test(bajo)) {
    const comp = /\b([fb][a-z0-9]{3})\s*-?\s*(\d{1,8})\b/i.exec(texto);
    const prov = /\bde\s+([^,:]+?)(?=\s*(?:,|:|\bfactura\b|\bboleta\b|\bticket\b|$))/i.exec(texto.split(":")[0]);
    const lista = texto.includes(":") ? texto.slice(texto.indexOf(":") + 1) : "";
    const items_compra = lista
      .split(/[,;\n]+|\s+y\s+(?=\d)/)
      .map((parte) => {
        const m = /^\s*(\d+(?:[.,]\d+)?)\s+(.+?)(?:\s+(?:a|x|por)?\s*(?:s\/\.?\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:soles|c\/u|cada uno)?)?\s*$/i.exec(parte.trim());
        if (!m || m[2].trim().length < 2) return null;
        return { descripcion: m[2].replace(/\s+(a|x|por)$/i, "").trim(), cantidad: Number(m[1].replace(",", ".")), precio_unitario: m[3] ? Number(m[3].replace(",", ".")) : null };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return {
      ...mensajeVacio("recepcion"),
      placa,
      proveedor: prov ? prov[1].trim().slice(0, 160) : null,
      comprobante: comp ? `${comp[1].toUpperCase()}-${comp[2]}` : null,
      items_compra,
    };
  }

  // Repuestos que van a un carro: «ABC123 salieron 1 sincronizador de tercera, 4 aceite ATF a 25».
  if (placa && /\b(salieron|salio|saque|sacamos|vale|cargar?|cargue|use|usamos|se pusieron|se puso)\b/.test(bajo)) {
    const lista = quitar(texto, placaCruda).replace(/^.*?\b(salieron|salió|salio|saqué|saque|sacamos|vale|cargar|carga|cargué|cargue|usé|use|usamos|se pusieron|se puso)\b\s*:?/i, "");
    const items_compra = lista
      .split(/[,;\n]+|\s+y\s+(?=\d)/)
      .map((parte) => {
        const m = /^\s*(\d+(?:[.,]\d+)?)\s+(?:litros?\s+de\s+|galones?\s+de\s+|unidades?\s+de\s+)?(.+?)(?:\s+(?:a|x|por)\s*(?:s\/\.?\s*)?(\d+(?:[.,]\d{1,2})?))?\s*$/i.exec(parte.trim());
        if (!m || m[2].trim().length < 2) return null;
        return { descripcion: m[2].trim(), cantidad: Number(m[1].replace(",", ".")), precio_unitario: m[3] ? Number(m[3].replace(",", ".")) : null };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (items_compra.length) return { ...mensajeVacio("repuestos"), placa, items_compra };
  }

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
    // «…, entrega hoy 6pm», «se entrega mañana a las 10am», «lo recoge el jueves 5pm»: va al final.
    const entrega = /(?:,\s*|\s+)(?:se\s+|lo\s+)?(?:entrega(?:r|mos)?|recoge(?:r|n)?|prometid[oa]|listo)\s+(?:para\s+)?(.*\d.*)$/i.exec(texto);
    const cuerpo = entrega ? texto.slice(0, entrega.index) : texto;
    const cel = CELULAR.exec(cuerpo);
    const km = /(\d{1,3}(?:[.\s]?\d{3})+|\d{3,6}|\d{1,3}\s*mil)\s*(?:km|kms|kilometros|kil[oó]metros)/i.exec(cuerpo);
    const resto = quitar(cuerpo.replace(/^(nuevo\s+)?ingres[oa]\s*:?/i, ""), placaCruda, cel?.[0], km?.[0]);
    const [nombreParte, ...servicioParte] = resto.split(/\s+(?:para|por|servicio:?)\s+/i);
    const servicios = (servicioParte.join(" ") || "").split(/\s*(?:,|\by\b)\s*/).map((s) => s.trim()).filter((s) => s.length > 2);
    return {
      ...mensajeVacio("nuevo_ingreso"),
      placa,
      cliente_celular: cel ? `${cel[1]}${cel[2]}${cel[3]}` : null,
      cliente_nombre: nombreParte && servicioParte.length ? nombreParte.trim() || null : null,
      servicios: servicioParte.length ? servicios : resto ? [resto] : [],
      kilometraje: km ? kilometros(km[1].toLowerCase()) : null,
      entrega_prometida: entrega ? entrega[1].trim() : null,
    };
  }

  // Corrección de lo recién guardado: «No, el kilometraje es 58 mil», «el celular es 987654321», «corrige: color blanco».
  if (/^(no\b|corrig|correcci|me equivoque|perdon|error\b)/.test(bajo) && /\b(km\b|kilometr|celular|telefono|numero|nombre|color|marca|modelo|ano\b|entrega|diagnostico)/.test(bajo)) {
    const km = kilometros(bajo);
    const cel = CELULAR.exec(texto);
    const color = /\bcolor\s+(?:es\s+)?([a-z]+)/.exec(bajo)?.[1] ?? null;
    const anio = /\bano\s+(?:es\s+)?((?:19|20)\d{2})\b/.exec(bajo)?.[1];
    const nombre = /\bnombre\s+(?:es\s+)?(.+)$/i.exec(texto)?.[1]?.trim() ?? null;
    const entrega = /\bentrega\s+(?:es\s+)?(?:para\s+)?(.*\d.*)$/i.exec(texto)?.[1]?.trim() ?? null;
    const diag = /\bdiagn[oó]stico\s*(?:es|:)?\s*(.{3,})$/i.exec(texto)?.[1]?.trim() ?? null;
    return {
      ...mensajeVacio("correccion"),
      placa,
      kilometraje: /\b(km|kilometr)/.test(bajo) ? km : null,
      cliente_celular: /\b(celular|telefono|numero)\b/.test(bajo) && cel ? `${cel[1]}${cel[2]}${cel[3]}` : null,
      cliente_nombre: nombre,
      color,
      anio: anio ? Number(anio) : null,
      entrega_prometida: entrega,
      diagnostico: diag,
    };
  }

  // Avance: "ABC123 listo", "ABC123 esperando repuesto", "ABC123 diagnóstico: embrague gastado", "ABC123 el cliente aprobó"
  if (placa && (/\b(avance|listo|lista|terminado|termine|esperando|falta repuesto|en proceso|empece|desarm|diagnostico|aprob)/.test(bajo) || bajo.length > 0)) {
    const estado = /\b(listo|lista|terminado|termine)\b/.test(bajo)
      ? "listo"
      : /\b(cliente aprobo|aprobo|aprobado|aprobaron|acepto el presupuesto)\b/.test(bajo)
        ? "aprobado"
        : /\b(espera(?:ndo)? aprobacion|presupuesto enviado|mande el presupuesto|envie el presupuesto)\b/.test(bajo)
          ? "espera_aprobacion"
          : /\b(esperando|falta repuesto|sin repuesto)\b/.test(bajo)
            ? "esperando_repuesto"
            : /\b(en proceso|empece|empezamos|desarm|en reparacion)/.test(bajo)
              ? "en_proceso"
              : /\b(revisando|en diagnostico|empece el diagnostico)\b/.test(bajo)
                ? "en_diagnostico"
                : null;
    const diag = /diagn[oó]stico\s*:?\s*([^.]{3,}?)(?:\.\s+(.*))?$/i.exec(texto);
    const sinDiag = diag ? texto.slice(0, diag.index) + (diag[2] ?? "") : texto;
    const avance = quitar(sinDiag.replace(/^avance\s*:?/i, ""), placaCruda).replace(/^[,.:;\s-]+|[,.:;\s-]+$/g, "");
    return { ...mensajeVacio("avance"), placa, nuevo_estado: estado, diagnostico: diag ? diag[1].trim() : null, texto_avance: avance || null };
  }

  return mensajeVacio("desconocido");
}

/**
 * Fecha y hora de Lima desde frases cortas: «mañana 10am», «hoy 4:30 pm»,
 * «18/11 9:00», «2026-11-20 15:00», «el lunes 11». Devuelve AAAA-MM-DDTHH:MM.
 * `hoy` es la fecha de Lima en formato AAAA-MM-DD.
 */
export function fechaHoraDesdeTexto(texto: string, hoy: string): string | null {
  const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const base = new Date(`${hoy}T12:00:00-05:00`);
  const sumar = (dias: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(base.getTime() + dias * 86400000));
  let dia: string | null = null;
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  const dm = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (iso) dia = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (dm) {
    const anio = dm[3] ? (dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : hoy.slice(0, 4);
    dia = `${anio}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  } else if (/\bpasado manana\b/.test(t)) dia = sumar(2);
  else if (/\bmanana\b/.test(t)) dia = sumar(1);
  else if (/\bhoy\b/.test(t)) dia = hoy;
  else {
    const dias = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
    const k = dias.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
    if (k >= 0) {
      const actual = base.getUTCDay();
      dia = sumar(((k - actual + 7) % 7) || 7);
    }
  }
  const sinFecha = t.replace(/(\d{4})-(\d{2})-(\d{2})/, " ").replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, " ");
  const h = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.\s?m\.|p\.\s?m\.|de la manana|de la tarde|de la noche)?\b/.exec(sinFecha.replace(/\b(?:a las|las|alas)\b/g, " "));
  if (!dia || !h) return null;
  let hora = Number(h[1]);
  const min = h[2] ?? "00";
  const sufijo = h[3] ?? "";
  if (/p|tarde|noche/.test(sufijo) && hora < 12) hora += 12;
  if (/a\.?\s?m|manana/.test(sufijo) && hora === 12) hora = 0;
  if (!sufijo && hora >= 1 && hora <= 6) hora += 12; // «a las 4» en un taller es de la tarde
  if (hora > 23 || Number(min) > 59) return null;
  return `${dia}T${String(hora).padStart(2, "0")}:${min}`;
}

/** Ítems de cotización desde «pastillas 180, mano de obra 60, 2 filtros 35». */
export function itemsDesdeTexto(texto: string): { descripcion: string; tipo: "servicio" | "repuesto"; cantidad: number; precio_con_igv: number }[] {
  return texto
    .replace(/^.*?\bcotiza\w*\s*/i, "")
    .replace(PLACA, " ")
    .split(/[,;\n]+/)
    .map((parte) => {
      const m = /^\s*(?:(\d+)\s*(?:x|×)?\s+)?(.+?)\s*(?:s\/\.?\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:soles)?\s*$/i.exec(parte.trim());
      if (!m) return null;
      const descripcion = m[2].replace(/\s+(a|en|por)$/i, "").trim();
      if (descripcion.length < 2) return null;
      const tipo: "servicio" | "repuesto" = /mano de obra|servicio|cambio|instalaci|revisi|diagn|alinea|balance|limpieza/i.test(descripcion) ? "servicio" : "repuesto";
      return { descripcion, tipo, cantidad: m[1] ? Number(m[1]) : 1, precio_con_igv: Number(m[3].replace(",", ".")) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
