import "server-only";
import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

/**
 * Documentos PDF del taller (recibo, proforma, orden de reparación, arqueo,
 * reportes). A4 y Helvetica (viene dentro del PDF). El formato sigue al de los
 * documentos que el taller ya entrega: recuadro gris con el logo y los datos
 * del taller, el tipo de documento a la derecha, recuadros de cliente y
 * vehículo, detalle, «Última línea», totales a la derecha y firma.
 */

export type DatosTaller = {
  nombre: string;
  razonSocial?: string | null;
  ruc?: string | null;
  direccion?: string | null;
  telefono?: string | null;
  correo?: string | null;
  lema?: string | null;
  logo?: { bytes: Uint8Array; tipo: "png" | "jpg" } | null;
};

export type Columna = { titulo: string; ancho: number; alinear?: "izq" | "der" };

export type OpcionesDocumento = {
  /** Líneas «Etiqueta: valor» bajo el título (fecha, número de orden, quién lo hizo). */
  cabecera?: [string, string | null | undefined][];
  /** Líneas destacadas en rojo bajo el título (placa y número en la orden). */
  destacados?: string[];
  colorTitulo?: "tinta" | "azul" | "rojo";
  /** Texto grande en diagonal en cada página («ORIGINAL», «ANULADO»). */
  marcaAgua?: string;
};

const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 28;
const UTIL = ANCHO - MARGEN * 2;

const TINTA = rgb(0.1, 0.11, 0.13);
const TINTA_2 = rgb(0.33, 0.34, 0.36);
const TINTA_3 = rgb(0.55, 0.55, 0.57);
const REGLA = rgb(0.86, 0.86, 0.87);
const FONDO = rgb(0.94, 0.94, 0.94);
const FONDO_SUAVE = rgb(0.975, 0.975, 0.975);
const BLANCO = rgb(1, 1, 1);
const AZUL = rgb(0.16, 0.38, 0.72);
const ROJO = rgb(0.86, 0.13, 0.13);
const COLOR_TITULO = { tinta: TINTA, azul: AZUL, rojo: ROJO };

// Helvetica solo trae los caracteres de Windows-1252: se cambian los demás.
const CAMBIOS: Record<string, string> = { "−": "-", "→": "->", "\u202f": " ", "\u2009": " ", "\u00a0": " ", "≤": "<=", "≥": ">=", "≈": "~", "✓": "x" };
const WIN1252_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
export function limpiar(texto: string): string {
  let r = "";
  for (const c of texto) {
    const code = c.codePointAt(0) ?? 0;
    if (CAMBIOS[c] !== undefined) r += CAMBIOS[c];
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN1252_EXTRA.includes(c)) r += c;
    else if (c === "\n") r += " ";
    else r += "?";
  }
  return r;
}

type Color = ReturnType<typeof rgb>;

export class Documento {
  private constructor(
    private pdf: PDFDocument,
    private normal: PDFFont,
    private negrita: PDFFont,
    private taller: DatosTaller,
    private titulo: string,
    private numero: string,
    private pie: string,
    private opciones: OpcionesDocumento,
    private logo: PDFImage | null,
  ) {}

  private pagina!: PDFPage;
  private y = 0;

  static async crear(taller: DatosTaller, titulo: string, numero: string, pie: string, opciones: OpcionesDocumento = {}): Promise<Documento> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(limpiar(`${titulo} ${numero}`.trim()));
    pdf.setAuthor(limpiar(taller.razonSocial || taller.nombre));
    pdf.setCreator("Taller Control");
    pdf.setProducer("Taller Control");
    let logo: PDFImage | null = null;
    try {
      if (taller.logo) logo = taller.logo.tipo === "png" ? await pdf.embedPng(taller.logo.bytes) : await pdf.embedJpg(taller.logo.bytes);
    } catch {
      logo = null; // un logo dañado no impide el documento
    }
    const d = new Documento(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), taller, titulo, numero, pie, opciones, logo);
    d.nuevaPagina();
    return d;
  }

  // ---- Medidas y texto ----------------------------------------------------

  private ancho(texto: string, tam: number, fuerte = false) {
    return (fuerte ? this.negrita : this.normal).widthOfTextAtSize(limpiar(texto), tam);
  }

  /** Corta un texto en líneas que caben en `max` puntos. */
  private partir(texto: string, tam: number, max: number, fuerte = false): string[] {
    const lineas: string[] = [];
    for (const parrafo of limpiar(texto).split(/\r?\n/)) {
      let actual = "";
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = actual ? `${actual} ${palabra}` : palabra;
        if (this.ancho(prueba, tam, fuerte) <= max) actual = prueba;
        else {
          if (actual) lineas.push(actual);
          let resto = palabra;
          while (this.ancho(resto, tam, fuerte) > max && resto.length > 1) {
            let i = resto.length - 1;
            while (i > 1 && this.ancho(resto.slice(0, i), tam, fuerte) > max) i--;
            lineas.push(resto.slice(0, i));
            resto = resto.slice(i);
          }
          actual = resto;
        }
      }
      lineas.push(actual);
    }
    return lineas;
  }

  private escribir(texto: string, x: number, y: number, tam: number, opciones: { fuerte?: boolean; color?: Color; alinear?: "izq" | "der" | "centro"; ancho?: number } = {}) {
    const t = limpiar(texto);
    const w = this.ancho(t, tam, opciones.fuerte);
    const caja = opciones.ancho ?? 0;
    const xx = opciones.alinear === "der" ? x + caja - w : opciones.alinear === "centro" ? x + (caja - w) / 2 : x;
    this.pagina.drawText(t, { x: xx, y, size: tam, font: opciones.fuerte ? this.negrita : this.normal, color: opciones.color ?? TINTA });
  }

  /** «Etiqueta: valor» con la etiqueta en negrita. Devuelve el ancho usado. */
  private par(etiqueta: string, valor: string, x: number, y: number, tam: number, opciones: { alinear?: "izq" | "der"; ancho?: number; color?: Color } = {}) {
    const e = `${etiqueta}: `;
    const we = this.ancho(e, tam, true);
    const wv = this.ancho(valor, tam);
    const inicio = opciones.alinear === "der" ? x + (opciones.ancho ?? 0) - we - wv : x;
    this.escribir(e, inicio, y, tam, { fuerte: true, color: opciones.color });
    this.escribir(valor, inicio + we, y, tam, { color: opciones.color ?? TINTA_2 });
  }

  /** Rectángulo con esquinas redondeadas (relleno y/o borde). */
  private rect(x: number, y: number, w: number, h: number, opciones: { relleno?: Color; borde?: Color; radio?: number }) {
    const r = Math.min(opciones.radio ?? 6, h / 2, w / 2);
    const k = r * 0.5523;
    const ruta = `M ${r} 0 H ${w - r} C ${w - r + k} 0 ${w} ${r - k} ${w} ${r} V ${h - r} C ${w} ${h - r + k} ${w - r + k} ${h} ${w - r} ${h} H ${r} C ${r - k} ${h} 0 ${h - r + k} 0 ${h - r} V ${r} C 0 ${r - k} ${r - k} 0 ${r} 0 Z`;
    // drawSvgPath usa el eje y hacia abajo desde (x, y + h).
    this.pagina.drawSvgPath(ruta, { x, y: y + h, color: opciones.relleno, borderColor: opciones.borde, borderWidth: opciones.borde ? 0.75 : 0 });
  }

  private nuevaPagina() {
    this.pagina = this.pdf.addPage([ANCHO, ALTO]);
    const t = this.taller;
    const o = this.opciones;
    const arriba = ALTO - MARGEN;
    const xLogo = MARGEN + 10;
    const lado = 86;
    const xTexto = this.logo ? xLogo + lado + 12 : MARGEN + 12;
    const anchoTexto = ANCHO - MARGEN - 200 - xTexto;

    // Lado izquierdo: datos del taller (se miden antes de dibujar el recuadro).
    const izquierda: { texto: string; tam: number; fuerte?: boolean; etiqueta?: string; color?: Color }[] = [
      { texto: t.razonSocial || t.nombre, tam: 10.5, fuerte: true },
      ...(t.ruc ? [{ etiqueta: "R.U.C", texto: t.ruc, tam: 7.5 }] : []),
      ...(t.telefono ? [{ etiqueta: "Teléfono", texto: t.telefono, tam: 7.5 }] : []),
      ...(t.correo ? [{ etiqueta: "Correo", texto: t.correo, tam: 7.5 }] : []),
      ...(t.direccion ? [{ etiqueta: "Dirección", texto: t.direccion, tam: 7.5 }] : []),
    ];
    const lema = t.lema ? this.partir(`"${t.lema}"`, 7.5, anchoTexto) : [];
    const altoIzq = 14 + (izquierda.length - 1) * 10 + (lema.length ? 4 + lema.length * 9.5 : 0);

    // Lado derecho: tipo de documento, número y datos del documento.
    const cabecera = (o.cabecera ?? []).filter(([, v]) => v) as [string, string][];
    const altoDer = 15 + (this.numero ? 12 : 0) + (o.destacados?.length ?? 0) * 12 + cabecera.length * 11;
    const alto = Math.max(this.logo ? lado + 16 : 0, altoIzq + 22, altoDer + 22, 70);
    const base = arriba - alto;
    this.rect(MARGEN, base, UTIL, alto, { relleno: FONDO });

    if (this.logo) {
      const y = arriba - 8 - lado;
      this.rect(xLogo, y, lado, lado, { relleno: BLANCO, borde: REGLA, radio: 2 });
      const escala = Math.min((lado - 6) / this.logo.width, (lado - 6) / this.logo.height);
      const w = this.logo.width * escala;
      const h = this.logo.height * escala;
      this.pagina.drawImage(this.logo, { x: xLogo + (lado - w) / 2, y: y + (lado - h) / 2, width: w, height: h });
    }
    let yi = arriba - 20;
    for (const l of izquierda) {
      if (l.etiqueta) this.par(l.etiqueta, l.texto, xTexto, yi, l.tam);
      else this.escribir(l.texto, xTexto, yi, l.tam, { fuerte: l.fuerte });
      yi -= l.fuerte ? 13 : 10;
    }
    if (lema.length) {
      yi -= 3;
      for (const l of lema) {
        this.escribir(l, xTexto, yi, 7.5, { color: TINTA_2 });
        yi -= 9.5;
      }
    }

    const xd = ANCHO - MARGEN - 12 - 190;
    let yd = arriba - 22;
    this.escribir(this.titulo.toUpperCase(), xd, yd, 12, { fuerte: true, alinear: "der", ancho: 190, color: COLOR_TITULO[o.colorTitulo ?? "tinta"] });
    yd -= 13;
    if (this.numero) {
      this.escribir(this.numero, xd, yd, 9.5, { fuerte: true, alinear: "der", ancho: 190 });
      yd -= 12;
    }
    for (const d of o.destacados ?? []) {
      this.escribir(d, xd, yd, 10, { fuerte: true, alinear: "der", ancho: 190, color: ROJO });
      yd -= 12;
    }
    for (const [e, v] of cabecera) {
      this.par(e, v, xd, yd, 8.5, { alinear: "der", ancho: 190, color: TINTA });
      yd -= 11;
    }
    this.y = base - 16;
  }

  /** Asegura `alto` puntos libres; si no, pasa a una página nueva. */
  private espacio(alto: number) {
    if (this.y - alto < MARGEN + 24) this.nuevaPagina();
  }

  // ---- Bloques -------------------------------------------------------------

  /**
   * Recuadro gris con «Etiqueta: valor» en columnas (cliente, vehículo…).
   * `combustible` dibuja el medidor a la derecha (0, 25, 50, 75 o 100).
   */
  recuadro(titulo: string | null, pares: [string, string | null | undefined][], opciones: { columnas?: number; combustible?: number | null } = {}) {
    const lista = pares.filter(([, v]) => v !== null && v !== undefined && v !== "") as [string, string][];
    const conMedidor = opciones.combustible !== undefined;
    const anchoDatos = UTIL - 20 - (conMedidor ? 130 : 0);
    const columnas = opciones.columnas ?? 2;
    const filas = Math.ceil(lista.length / columnas);
    const alto = 12 + (titulo ? 15 : 0) + Math.max(filas * 11, conMedidor ? 70 : 0) + 4;
    this.espacio(alto + 8);
    const base = this.y - alto + 10;
    this.rect(MARGEN, base, UTIL, alto, { relleno: FONDO_SUAVE });
    let y = this.y - 4;
    if (titulo) {
      this.escribir(titulo, MARGEN + 10, y, 8.5, { fuerte: true });
      y -= 15;
    }
    const anchoCol = anchoDatos / columnas;
    lista.forEach(([e, v], i) => {
      const col = Math.floor(i / filas);
      const fila = i % filas;
      this.par(e, v, MARGEN + 10 + col * anchoCol, y - fila * 11, 8);
    });
    if (conMedidor) this.medidor(ANCHO - MARGEN - 75, base + alto - (titulo ? 22 : 12), opciones.combustible ?? null);
    this.y = base - 14;
  }

  /** Medidor de combustible (semicírculo E–F con aguja). */
  private medidor(cx: number, arriba: number, nivel: number | null) {
    this.escribir("Nivel del combustible", cx - 60, arriba, 8.5, { fuerte: true, alinear: "centro", ancho: 120 });
    const cy = arriba - 44;
    const r = 24;
    const punto = (grados: number, radio = r) => ({ x: cx + radio * Math.cos((grados * Math.PI) / 180), y: cy + radio * Math.sin((grados * Math.PI) / 180) });
    for (let g = 180; g > 0; g -= 6) {
      const a = punto(g);
      const b = punto(g - 6);
      this.pagina.drawLine({ start: a, end: b, thickness: 2.5, color: g > 150 ? ROJO : TINTA_3 });
    }
    for (const g of [135, 90, 45]) this.pagina.drawLine({ start: punto(g, r - 6), end: punto(g, r - 2), thickness: 1, color: TINTA_2 });
    this.escribir("E", cx - r - 4, cy - 11, 7, { fuerte: true });
    this.escribir("F", cx + r, cy - 11, 7, { fuerte: true });
    if (nivel !== null) {
      const g = 180 - nivel * 1.8;
      this.pagina.drawLine({ start: { x: cx, y: cy }, end: punto(g, r - 5), thickness: 1.6, color: TINTA });
    }
    this.pagina.drawCircle({ x: cx, y: cy, size: 2.2, color: TINTA });
    const NIVEL: Record<number, string> = { 0: "Reserva (0%)", 25: "1/4 (25%)", 50: "1/2 (50%)", 75: "3/4 (75%)", 100: "Lleno (100%)" };
    this.escribir(nivel === null ? "Sin dato" : NIVEL[nivel] ?? `${nivel}%`, cx - 60, cy - 22, 8.5, { fuerte: true, alinear: "centro", ancho: 120 });
  }

  /** Pares etiqueta / valor en dos columnas, sin recuadro. */
  datos(pares: [string, string | null | undefined][], columnas = 2) {
    const lista = pares.filter(([, v]) => v !== null && v !== undefined && v !== "") as [string, string][];
    const anchoCol = UTIL / columnas;
    for (let i = 0; i < lista.length; i += columnas) {
      const fila = lista.slice(i, i + columnas);
      const alturas = fila.map(([, v]) => this.partir(v, 9, anchoCol - 12).length);
      const alto = 10 + Math.max(...alturas) * 11 + 5;
      this.espacio(alto);
      fila.forEach(([etiqueta, valor], k) => {
        const x = MARGEN + k * anchoCol;
        this.escribir(etiqueta, x, this.y, 7.5, { color: TINTA_3 });
        this.partir(valor, 9, anchoCol - 12).forEach((l, j) => this.escribir(l, x, this.y - 11 - j * 11, 9));
      });
      this.y -= alto;
    }
  }

  seccion(titulo: string, detalle?: string) {
    this.espacio(40);
    this.y -= 6;
    this.escribir(titulo, MARGEN, this.y, 10.5, { fuerte: true });
    if (detalle) this.escribir(detalle, MARGEN + this.ancho(titulo, 10.5, true) + 8, this.y, 8, { color: TINTA_3 });
    this.y -= 6;
    this.pagina.drawLine({ start: { x: MARGEN, y: this.y }, end: { x: ANCHO - MARGEN, y: this.y }, thickness: 0.6, color: REGLA });
    this.y -= 12;
  }

  parrafo(texto: string, opciones: { tam?: number; color?: "normal" | "tenue" | "rojo"; fuerte?: boolean } = {}) {
    const tam = opciones.tam ?? 9;
    const color = opciones.color === "tenue" ? TINTA_2 : opciones.color === "rojo" ? ROJO : TINTA;
    for (const l of this.partir(texto, tam, UTIL, opciones.fuerte)) {
      this.espacio(tam + 4);
      this.escribir(l, MARGEN, this.y, tam, { color, fuerte: opciones.fuerte });
      this.y -= tam + 3.5;
    }
    this.y -= 4;
  }

  /** Recuadro gris con un aviso o las observaciones (título opcional en negrita). */
  nota(texto: string, titulo?: string) {
    const lineas = this.partir(texto, 8.5, UTIL - 20);
    const alto = lineas.length * 11 + 12 + (titulo ? 13 : 0);
    this.espacio(alto + 6);
    this.rect(MARGEN, this.y - alto + 10, UTIL, alto, { relleno: FONDO_SUAVE });
    let y = this.y - 2;
    if (titulo) {
      this.escribir(titulo, MARGEN + 10, y, 8.5, { fuerte: true });
      y -= 13;
    }
    lineas.forEach((l, i) => this.escribir(l, MARGEN + 10, y - i * 11, 8.5, { color: TINTA_2 }));
    this.y -= alto + 8;
  }

  /** Tabla con cabecera en mayúsculas y regla debajo; filas alternadas en gris. */
  tabla(columnas: Columna[], filas: string[][], opciones: { resaltarUltima?: boolean; cebra?: boolean } = {}) {
    const total = columnas.reduce((a, c) => a + c.ancho, 0);
    const anchos = columnas.map((c) => (c.ancho / total) * UTIL);
    const xs = anchos.map((_, i) => MARGEN + anchos.slice(0, i).reduce((a, b) => a + b, 0));
    const cabecera = () => {
      this.espacio(22);
      columnas.forEach((c, i) => this.escribir(c.titulo.toUpperCase(), xs[i] + 4, this.y, 7, { fuerte: true, color: TINTA, alinear: c.alinear, ancho: anchos[i] - 8 }));
      this.y -= 6;
      this.pagina.drawLine({ start: { x: MARGEN, y: this.y }, end: { x: ANCHO - MARGEN, y: this.y }, thickness: 0.9, color: TINTA_3 });
      this.y -= 12;
    };
    cabecera();
    filas.forEach((fila, f) => {
      const fuerte = opciones.resaltarUltima && f === filas.length - 1;
      const partes = fila.map((v, i) => this.partir(v ?? "", 8.5, anchos[i] - 8, fuerte));
      const alto = Math.max(...partes.map((p) => p.length)) * 10.5 + 6;
      if (this.y - alto < MARGEN + 24) {
        this.nuevaPagina();
        cabecera();
      }
      if (opciones.cebra && f % 2 === 1) this.pagina.drawRectangle({ x: MARGEN, y: this.y - alto + 9, width: UTIL, height: alto, color: FONDO_SUAVE });
      partes.forEach((lineas, i) =>
        lineas.forEach((l, j) => this.escribir(l, xs[i] + 4, this.y - j * 10.5, 8.5, { alinear: columnas[i].alinear, ancho: anchos[i] - 8, fuerte })),
      );
      this.y -= alto;
      if (!opciones.cebra) this.pagina.drawLine({ start: { x: MARGEN, y: this.y + 9 }, end: { x: ANCHO - MARGEN, y: this.y + 9 }, thickness: 0.4, color: REGLA });
    });
    this.y -= 4;
  }

  /** Línea punteada con «Última línea» al centro: nada se agrega debajo del detalle. */
  ultimaLinea() {
    this.espacio(20);
    const texto = "Última línea";
    const w = this.ancho(texto, 8);
    const centro = ANCHO / 2;
    for (const [a, b] of [[MARGEN, centro - w / 2 - 8], [centro + w / 2 + 8, ANCHO - MARGEN]]) {
      this.pagina.drawLine({ start: { x: a, y: this.y + 3 }, end: { x: b, y: this.y + 3 }, thickness: 0.6, color: TINTA_3, dashArray: [3, 3] });
    }
    this.escribir(texto, centro - w / 2, this.y, 8, { color: TINTA_2 });
    this.y -= 16;
  }

  /**
   * Cierre del documento: a la izquierda la firma y el agradecimiento; a la
   * derecha el recuadro de totales (grupos separados por líneas y el total).
   */
  cierre(firma: string, grupos: [string, string][][], total: [string, string], opciones: { gracias?: boolean; colorTotal?: "tinta" | "rojo" } = {}) {
    const w = 235;
    const x = ANCHO - MARGEN - w;
    const filas = grupos.reduce((a, g) => a + g.length, 0);
    const alto = 14 + filas * 11 + grupos.length * 8 + 26;
    this.espacio(alto + 10);
    const base = this.y - alto + 8;
    this.rect(x, base, w, alto, { relleno: FONDO_SUAVE, borde: REGLA, radio: 3 });
    let y = this.y - 6;
    grupos.forEach((g, i) => {
      for (const [e, v] of g) {
        this.escribir(e, x + 12, y, 8.5, { color: TINTA_2 });
        this.escribir(v, x + 12, y, 8.5, { alinear: "der", ancho: w - 24, color: TINTA_2 });
        y -= 11;
      }
      this.pagina.drawLine({ start: { x: x + 12, y: y + 6 }, end: { x: x + w - 12, y: y + 6 }, thickness: 0.6, color: i === grupos.length - 1 ? TINTA_2 : REGLA });
      y -= 8;
    });
    const color = opciones.colorTotal === "rojo" ? ROJO : TINTA;
    this.escribir(total[0], x + 12, y - 6, 12, { fuerte: true, color });
    this.escribir(total[1], x + 12, y - 6, 12, { fuerte: true, alinear: "der", ancho: w - 24, color });

    // Firma y agradecimiento, centrados en el espacio de la izquierda.
    const ancho = UTIL - w - 30;
    const yf = this.y - alto / 2 + 4;
    if (firma) this.pagina.drawLine({ start: { x: MARGEN + ancho / 2 - 75, y: yf + 12 }, end: { x: MARGEN + ancho / 2 + 75, y: yf + 12 }, thickness: 0.75, color: TINTA_2 });
    if (firma) this.partir(firma, 8.5, 170).forEach((l, i) => this.escribir(l, MARGEN, yf - i * 11, 8.5, { alinear: "centro", ancho, color: TINTA_2 }));
    if (opciones.gracias !== false) this.escribir("*** GRACIAS POR SU PREFERENCIA ***", MARGEN, yf - (firma ? this.partir(firma, 8.5, 170).length * 11 + 8 : 0), 8, { alinear: "centro", ancho, color: TINTA_2 });
    this.y = base - 14;
  }

  /** Recuadro con líneas separadas («Método de pago», «Monto en letras»). */
  lineasEnRecuadro(lineas: [string, string][]) {
    const alto = lineas.length * 20 + 10;
    this.espacio(alto + 8);
    const base = this.y - alto + 10;
    this.rect(MARGEN + 6, base, UTIL - 12, alto, { relleno: FONDO_SUAVE, borde: REGLA, radio: 4 });
    let y = this.y - 6;
    lineas.forEach(([e, v], i) => {
      this.par(e, v, MARGEN + 18, y, 8.5, { color: TINTA });
      if (i < lineas.length - 1) this.pagina.drawLine({ start: { x: MARGEN + 18, y: y - 8 }, end: { x: ANCHO - MARGEN - 18, y: y - 8 }, thickness: 0.5, color: REGLA });
      y -= 20;
    });
    this.y = base - 12;
  }

  /** Totales alineados a la derecha (para reportes y arqueos). */
  totales(filas: [string, string, boolean?][]) {
    const w = 250;
    const x = ANCHO - MARGEN - w;
    this.espacio(filas.length * 16 + 10);
    for (const [etiqueta, valor, fuerte] of filas) {
      if (fuerte) this.pagina.drawRectangle({ x, y: this.y - 5, width: w, height: 18, color: FONDO });
      this.escribir(etiqueta, x + 8, this.y, fuerte ? 10 : 8.5, { fuerte, color: fuerte ? TINTA : TINTA_2 });
      this.escribir(valor, x + 8, this.y, fuerte ? 10 : 8.5, { fuerte, alinear: "der", ancho: w - 16 });
      this.y -= fuerte ? 20 : 14;
    }
    this.y -= 6;
  }

  /** Líneas para firmar (cliente, taller). */
  firmas(nombres: string[]) {
    this.espacio(70);
    this.y -= 40;
    const w = (UTIL - 40 * (nombres.length - 1)) / nombres.length;
    nombres.forEach((n, i) => {
      const x = MARGEN + i * (w + 40);
      this.pagina.drawLine({ start: { x, y: this.y + 12 }, end: { x: x + w, y: this.y + 12 }, thickness: 0.75, color: TINTA_3 });
      this.escribir(n, x, this.y, 8.5, { color: TINTA_2, alinear: "centro", ancho: w });
    });
    this.y -= 18;
  }

  async bytes(): Promise<Uint8Array> {
    const paginas = this.pdf.getPages();
    paginas.forEach((p, i) => {
      this.pagina = p;
      if (this.opciones.marcaAgua) {
        const texto = limpiar(this.opciones.marcaAgua);
        const tam = 96;
        // En diagonal, de arriba a la izquierda hacia abajo a la derecha, centrado en la hoja.
        const lado = this.normal.widthOfTextAtSize(texto, tam) * 0.7071;
        p.drawText(texto, { x: ANCHO / 2 - lado / 2 - 25, y: ALTO / 2 + lado / 2 - 25, size: tam, font: this.normal, color: rgb(0.78, 0.78, 0.78), opacity: 0.4, rotate: degrees(-45) });
      }
      this.escribir(this.pie, MARGEN, MARGEN - 12, 6.5, { color: TINTA_3 });
      this.escribir(`Página ${i + 1} de ${paginas.length}`, MARGEN, MARGEN - 12, 6.5, { color: TINTA_3, alinear: "der", ancho: UTIL });
    });
    return this.pdf.save();
  }
}

/** S/. 1,234.56 (o -S/. 12.00), como en los documentos del taller. */
export function soles(n: number): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return `${v < 0 ? "-" : ""}S/. ${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 1,234.56 sin símbolo, para columnas de precio. */
export function importe(n: number): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fechaCorta(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: iso.length === 10 ? "UTC" : "America/Lima" }).format(d);
}

export function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(iso));
}

/** 14-11-2026 15:25:08, como en el recibo del taller. */
export function fechaHoraLarga(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "America/Lima" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** Respuesta HTTP con el PDF (se abre en el navegador; desde ahí se guarda o comparte). */
export function respuestaPdf(bytes: Uint8Array, archivo: string): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${archivo.replace(/[^a-zA-Z0-9._-]+/g, "-")}"`,
      "Cache-Control": "no-store",
    },
  });
}
