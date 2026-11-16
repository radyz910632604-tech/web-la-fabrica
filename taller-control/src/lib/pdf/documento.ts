import "server-only";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Documentos PDF del taller (cotización, orden, recibos, cierres, reportes).
 * A4, Helvetica (viene dentro del PDF, no hay que instalar fuentes) y los
 * colores de la app. Todo se dibuja con coordenadas: este archivo se encarga
 * de los saltos de línea y de página.
 */

export type DatosTaller = { nombre: string; razonSocial?: string | null; ruc?: string | null; direccion?: string | null; telefono?: string | null };

export type Columna = { titulo: string; ancho: number; alinear?: "izq" | "der" };

const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 40;
const UTIL = ANCHO - MARGEN * 2;

const TINTA = rgb(0.102, 0.102, 0.102);
const TINTA_2 = rgb(0.36, 0.36, 0.36);
const TINTA_3 = rgb(0.55, 0.55, 0.55);
const REGLA = rgb(0.9, 0.9, 0.9);
const FONDO = rgb(0.96, 0.96, 0.96);
const ACENTO = rgb(0.949, 0.329, 0.176);

// Helvetica solo trae los caracteres de Windows-1252: se cambian los demás.
const CAMBIOS: Record<string, string> = { "−": "-", "→": "->", " ": " ", " ": " ", " ": " ", "≤": "<=", "≥": ">=", "≈": "~", "✓": "x" };
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

export class Documento {
  private constructor(
    private pdf: PDFDocument,
    private normal: PDFFont,
    private negrita: PDFFont,
    private taller: DatosTaller,
    private titulo: string,
    private numero: string,
    private pie: string,
  ) {}

  private pagina!: PDFPage;
  private y = 0;

  static async crear(taller: DatosTaller, titulo: string, numero: string, pie: string): Promise<Documento> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(limpiar(`${titulo} ${numero}`.trim()));
    pdf.setAuthor(limpiar(taller.nombre));
    pdf.setCreator("Taller Control");
    pdf.setProducer("Taller Control");
    const d = new Documento(pdf, await pdf.embedFont(StandardFonts.Helvetica), await pdf.embedFont(StandardFonts.HelveticaBold), taller, titulo, numero, pie);
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
          // Una palabra más larga que la columna se corta a la fuerza.
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

  private escribir(texto: string, x: number, y: number, tam: number, opciones: { fuerte?: boolean; color?: ReturnType<typeof rgb>; alinear?: "izq" | "der"; ancho?: number } = {}) {
    const t = limpiar(texto);
    const w = this.ancho(t, tam, opciones.fuerte);
    const xx = opciones.alinear === "der" ? x + (opciones.ancho ?? 0) - w : x;
    this.pagina.drawText(t, { x: xx, y, size: tam, font: opciones.fuerte ? this.negrita : this.normal, color: opciones.color ?? TINTA });
  }

  private nuevaPagina() {
    this.pagina = this.pdf.addPage([ANCHO, ALTO]);
    const p = this.pagina;
    // Franja de color arriba, como la tarjeta destacada de la app.
    p.drawRectangle({ x: 0, y: ALTO - 6, width: ANCHO, height: 6, color: ACENTO });
    let y = ALTO - MARGEN - 8;
    const t = this.taller;
    this.escribir(t.nombre, MARGEN, y, 15, { fuerte: true });
    y -= 15;
    for (const linea of [t.razonSocial && t.razonSocial !== t.nombre ? t.razonSocial : null, t.ruc ? `RUC ${t.ruc}` : null, t.direccion, t.telefono ? `Teléfono ${t.telefono}` : null].filter(Boolean) as string[]) {
      this.escribir(linea, MARGEN, y, 8.5, { color: TINTA_2 });
      y -= 11;
    }
    // Recuadro con el tipo y número de documento (a la derecha, como en Perú).
    const caja = { w: 190, h: 54 };
    const cx = ANCHO - MARGEN - caja.w;
    const cy = ALTO - MARGEN - caja.h + 6;
    p.drawRectangle({ x: cx, y: cy, width: caja.w, height: caja.h, borderColor: TINTA, borderWidth: 1, color: rgb(1, 1, 1) });
    const lineasTitulo = this.partir(this.titulo.toUpperCase(), 11, caja.w - 16, true);
    let ty = cy + caja.h - 18;
    for (const l of lineasTitulo.slice(0, 2)) {
      this.escribir(l, cx + 8, ty, 11, { fuerte: true, alinear: "der", ancho: caja.w - 16 });
      ty -= 13;
    }
    if (this.numero) this.escribir(this.numero, cx + 8, cy + 9, 10, { alinear: "der", ancho: caja.w - 16, color: TINTA_2 });
    this.y = Math.min(y, cy) - 18;
    p.drawLine({ start: { x: MARGEN, y: this.y + 8 }, end: { x: ANCHO - MARGEN, y: this.y + 8 }, thickness: 0.75, color: REGLA });
    this.y -= 6;
  }

  /** Asegura `alto` puntos libres; si no, pasa a una página nueva. */
  private espacio(alto: number) {
    if (this.y - alto < MARGEN + 30) this.nuevaPagina();
  }

  // ---- Bloques -------------------------------------------------------------

  /** Pares etiqueta / valor en dos columnas (cliente, carro, fecha…). */
  datos(pares: [string, string | null | undefined][], columnas = 2) {
    const lista = pares.filter(([, v]) => v !== null && v !== undefined && v !== "") as [string, string][];
    const anchoCol = UTIL / columnas;
    for (let i = 0; i < lista.length; i += columnas) {
      const fila = lista.slice(i, i + columnas);
      const alturas = fila.map(([, v]) => this.partir(v, 9.5, anchoCol - 12).length);
      const alto = 11 + Math.max(...alturas) * 12 + 6;
      this.espacio(alto);
      fila.forEach(([etiqueta, valor], k) => {
        const x = MARGEN + k * anchoCol;
        this.escribir(etiqueta, x, this.y, 7.5, { color: TINTA_3 });
        this.partir(valor, 9.5, anchoCol - 12).forEach((l, j) => this.escribir(l, x, this.y - 12 - j * 12, 9.5));
      });
      this.y -= alto;
    }
  }

  seccion(titulo: string, detalle?: string) {
    this.espacio(40);
    this.y -= 6;
    this.escribir(titulo, MARGEN, this.y, 11, { fuerte: true });
    if (detalle) this.escribir(detalle, MARGEN + this.ancho(titulo, 11, true) + 8, this.y, 8.5, { color: TINTA_3 });
    this.y -= 14;
  }

  parrafo(texto: string, opciones: { tam?: number; color?: "normal" | "tenue" | "acento"; fuerte?: boolean } = {}) {
    const tam = opciones.tam ?? 9.5;
    const color = opciones.color === "tenue" ? TINTA_2 : opciones.color === "acento" ? ACENTO : TINTA;
    for (const l of this.partir(texto, tam, UTIL, opciones.fuerte)) {
      this.espacio(tam + 4);
      this.escribir(l, MARGEN, this.y, tam, { color, fuerte: opciones.fuerte });
      this.y -= tam + 3.5;
    }
    this.y -= 4;
  }

  /** Recuadro gris con un aviso (por ejemplo: «documento interno»). */
  nota(texto: string) {
    const lineas = this.partir(texto, 8.5, UTIL - 20);
    const alto = lineas.length * 11 + 12;
    this.espacio(alto + 6);
    this.pagina.drawRectangle({ x: MARGEN, y: this.y - alto + 10, width: UTIL, height: alto, color: FONDO });
    lineas.forEach((l, i) => this.escribir(l, MARGEN + 10, this.y - 2 - i * 11, 8.5, { color: TINTA_2 }));
    this.y -= alto + 8;
  }

  /** Tabla con cabecera gris; las columnas se reparten por fracciones de `ancho`. */
  tabla(columnas: Columna[], filas: string[][], opciones: { resaltarUltima?: boolean } = {}) {
    const total = columnas.reduce((a, c) => a + c.ancho, 0);
    const anchos = columnas.map((c) => (c.ancho / total) * UTIL);
    const xs = anchos.map((_, i) => MARGEN + anchos.slice(0, i).reduce((a, b) => a + b, 0));
    const cabecera = () => {
      this.espacio(22);
      this.pagina.drawRectangle({ x: MARGEN, y: this.y - 6, width: UTIL, height: 18, color: FONDO });
      columnas.forEach((c, i) => this.escribir(c.titulo, xs[i] + 5, this.y, 7.5, { fuerte: true, color: TINTA_2, alinear: c.alinear, ancho: anchos[i] - 10 }));
      this.y -= 20;
    };
    cabecera();
    filas.forEach((fila, f) => {
      const partes = fila.map((v, i) => this.partir(v ?? "", 9, anchos[i] - 10, opciones.resaltarUltima && f === filas.length - 1));
      const alto = Math.max(...partes.map((p) => p.length)) * 11 + 6;
      if (this.y - alto < MARGEN + 30) {
        this.nuevaPagina();
        cabecera();
      }
      partes.forEach((lineas, i) =>
        lineas.forEach((l, j) => this.escribir(l, xs[i] + 5, this.y - j * 11, 9, { alinear: columnas[i].alinear, ancho: anchos[i] - 10, fuerte: opciones.resaltarUltima && f === filas.length - 1 })),
      );
      this.y -= alto;
      // La línea va a media altura entre esta fila y la siguiente.
      this.pagina.drawLine({ start: { x: MARGEN, y: this.y + 11 }, end: { x: ANCHO - MARGEN, y: this.y + 11 }, thickness: 0.5, color: REGLA });
    });
    this.y -= 6;
  }

  /** Totales alineados a la derecha (Op. gravada, IGV 18 %, Total…). */
  totales(filas: [string, string, boolean?][]) {
    const w = 230;
    const x = ANCHO - MARGEN - w;
    this.espacio(filas.length * 16 + 10);
    for (const [etiqueta, valor, fuerte] of filas) {
      if (fuerte) {
        this.pagina.drawRectangle({ x, y: this.y - 5, width: w, height: 19, color: FONDO });
      }
      this.escribir(etiqueta, x + 8, this.y, fuerte ? 10.5 : 9, { fuerte, color: fuerte ? TINTA : TINTA_2 });
      this.escribir(valor, x + 8, this.y, fuerte ? 10.5 : 9, { fuerte, alinear: "der", ancho: w - 16 });
      this.y -= fuerte ? 21 : 15;
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
      this.escribir(n, x, this.y, 8.5, { color: TINTA_2 });
    });
    this.y -= 18;
  }

  async bytes(): Promise<Uint8Array> {
    const paginas = this.pdf.getPages();
    paginas.forEach((p, i) => {
      this.pagina = p;
      p.drawLine({ start: { x: MARGEN, y: MARGEN + 6 }, end: { x: ANCHO - MARGEN, y: MARGEN + 6 }, thickness: 0.5, color: REGLA });
      this.escribir(this.pie, MARGEN, MARGEN - 6, 7.5, { color: TINTA_3 });
      this.escribir(`Página ${i + 1} de ${paginas.length}`, MARGEN, MARGEN - 6, 7.5, { color: TINTA_3, alinear: "der", ancho: UTIL });
    });
    return this.pdf.save();
  }
}

/** S/ 1,234.56 (o -S/ 12.00) para el PDF. */
export function soles(n: number): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return `${v < 0 ? "-" : ""}S/ ${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fechaCorta(iso: string): string {
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: iso.length === 10 ? "UTC" : "America/Lima" }).format(d);
}

export function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(iso));
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
