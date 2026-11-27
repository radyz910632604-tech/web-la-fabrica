/**
 * Documento Word (.docx) sencillo: títulos, párrafos y tablas. Arma el XML de Word a mano
 * y lo empaqueta con jszip (sin plantillas ni servicios externos).
 */
import JSZip from "jszip";

export type Bloque =
  | { tipo: "titulo"; texto: string }
  | { tipo: "subtitulo"; texto: string }
  | { tipo: "parrafo"; texto: string; tenue?: boolean; negrita?: boolean }
  | { tipo: "tabla"; columnas: { titulo: string; ancho: number; derecha?: boolean }[]; filas: string[][]; total?: string[] };

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (texto: string, o: { negrita?: boolean; tam?: number; color?: string } = {}) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${o.negrita ? "<w:b/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${o.tam ?? 20}"/></w:rPr><w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
const parrafo = (contenido: string, o: { antes?: number; despues?: number; derecha?: boolean } = {}) =>
  `<w:p><w:pPr><w:spacing w:before="${o.antes ?? 0}" w:after="${o.despues ?? 80}"/>${o.derecha ? '<w:jc w:val="right"/>' : ""}</w:pPr>${contenido}</w:p>`;

function celda(texto: string, ancho: number, o: { fondo?: string; negrita?: boolean; blanco?: boolean; derecha?: boolean }) {
  return `<w:tc><w:tcPr><w:tcW w:w="${ancho}" w:type="dxa"/>${o.fondo ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fondo}"/>` : ""}<w:tcMar><w:top w:w="50" w:type="dxa"/><w:bottom w:w="50" w:type="dxa"/></w:tcMar></w:tcPr>${parrafo(run(texto, { negrita: o.negrita, tam: 17, color: o.blanco ? "FFFFFF" : undefined }), { despues: 0, derecha: o.derecha })}</w:tc>`;
}

function tabla(b: Extract<Bloque, { tipo: "tabla" }>) {
  const total = b.columnas.reduce((a, c) => a + c.ancho, 0);
  const borde = '<w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="E6E6E6"/>';
  const cab = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${b.columnas.map((c) => celda(c.titulo, c.ancho, { fondo: "1C1C1C", negrita: true, blanco: true, derecha: c.derecha })).join("")}</w:tr>`;
  const filas = b.filas.map((f) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${f.map((t, k) => celda(t, b.columnas[k].ancho, { derecha: b.columnas[k].derecha })).join("")}</w:tr>`).join("");
  const pie = b.total ? `<w:tr>${b.total.map((t, k) => celda(t, b.columnas[k].ancho, { fondo: "F3F3F1", negrita: true, derecha: b.columnas[k].derecha })).join("")}</w:tr>` : "";
  return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:tblBorders>${borde}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${b.columnas.map((c) => `<w:gridCol w:w="${c.ancho}"/>`).join("")}</w:tblGrid>${cab}${filas}${pie}</w:tbl>${parrafo("", { despues: 120 })}`;
}

export async function documentoWord(bloques: Bloque[], opciones: { horizontal?: boolean } = {}): Promise<Uint8Array> {
  const cuerpo = bloques
    .map((b) =>
      b.tipo === "titulo"
        ? parrafo(run(b.texto, { negrita: true, tam: 32 }), { despues: 60 })
        : b.tipo === "subtitulo"
          ? parrafo(run(b.texto, { negrita: true, tam: 24 }), { antes: 220, despues: 100 })
          : b.tipo === "parrafo"
            ? parrafo(run(b.texto, { negrita: b.negrita, color: b.tenue ? "666666" : undefined }))
            : tabla(b),
    )
    .join("");
  const [ancho, alto] = opciones.horizontal ? [16838, 11906] : [11906, 16838];
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="${ancho}" w:h="${alto}"${opciones.horizontal ? ' w:orient="landscape"' : ""}/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", documento);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
