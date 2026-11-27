/**
 * Lee el XML de una factura, boleta o nota de crédito electrónica de SUNAT (UBL 2.1).
 * No usa IA: los datos vienen tal cual del comprobante. Funciona en el
 * navegador y en el servidor (no depende de DOMParser).
 */

export type ComprobanteXml = {
  tipo: "factura" | "boleta" | "nota_credito" | "otro";
  serie: string;
  numero: string;
  fecha: string;
  moneda: "PEN" | "USD";
  emisor: { ruc: string; nombre: string };
  cliente: { documento: string; nombre: string };
  sinIgv: number;
  igv: number;
  total: number;
  lineas: { descripcion: string; cantidad: number; precioUnitarioSinIgv: number; sinIgv: number }[];
  /** Solo en notas de crédito: el comprobante que rebaja y el motivo (catálogo 09). */
  referencia?: { serie: string; numero: string };
  motivoCodigo?: string;
  motivo?: string;
};

const etiqueta = (nombre: string) => new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`);
const etiquetas = (nombre: string) => new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, "g");

function texto(xml: string, ...ruta: string[]): string {
  let actual = xml;
  for (const nombre of ruta) {
    const m = etiqueta(nombre).exec(actual);
    if (!m) return "";
    actual = m[1];
  }
  return decodificar(actual.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim());
}

function decodificar(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const numero = (s: string) => (s ? Number(s.replace(",", ".")) : 0);

export function leerXmlSunat(xml: string): ComprobanteXml {
  const esNota = /<(?:[\w-]+:)?CreditNote[\s>]/.test(xml);
  if (!esNota && !/<(?:[\w-]+:)?Invoice[\s>]/.test(xml)) throw new Error("Este archivo no es una factura, boleta o nota de crédito electrónica de SUNAT.");
  const [serie = "", correlativo = ""] = texto(xml, "ID").split("-");
  const codigo = texto(xml, "InvoiceTypeCode");
  const proveedor = etiqueta("AccountingSupplierParty").exec(xml)?.[1] ?? "";
  const cliente = etiqueta("AccountingCustomerParty").exec(xml)?.[1] ?? "";
  const totales = etiqueta("LegalMonetaryTotal").exec(xml)?.[1] ?? "";
  const impuestos = etiqueta("TaxTotal").exec(xml)?.[1] ?? "";
  const lineas = [...xml.matchAll(etiquetas(esNota ? "CreditNoteLine" : "InvoiceLine"))].map((m) => {
    const l = m[1];
    const cantidad = numero(texto(l, esNota ? "CreditedQuantity" : "InvoicedQuantity"));
    const sinIgv = numero(texto(l, "LineExtensionAmount"));
    return {
      descripcion: texto(l, "Item", "Description") || texto(l, "Description"),
      cantidad: cantidad || 1,
      precioUnitarioSinIgv: numero(texto(l, "Price", "PriceAmount")) || (cantidad ? sinIgv / cantidad : sinIgv),
      sinIgv,
    };
  });
  const total = numero(texto(totales, "PayableAmount"));
  const igv = numero(texto(impuestos, "TaxAmount"));
  const sinIgv = numero(texto(totales, "LineExtensionAmount")) || Math.round((total - igv) * 100) / 100;
  const [refSerie = "", refNumero = ""] = esNota ? texto(xml, "BillingReference", "InvoiceDocumentReference", "ID").split("-") : [];
  const respuesta = esNota ? etiqueta("DiscrepancyResponse").exec(xml)?.[1] ?? "" : "";
  return {
    ...(esNota
      ? {
          referencia: { serie: refSerie.trim().toUpperCase(), numero: String(Number(refNumero.trim()) || refNumero.trim()) },
          motivoCodigo: texto(respuesta, "ResponseCode"),
          motivo: texto(respuesta, "Description"),
        }
      : {}),
    tipo: esNota ? "nota_credito" : codigo === "01" ? "factura" : codigo === "03" ? "boleta" : "otro",
    serie: serie.trim().toUpperCase(),
    numero: String(Number(correlativo.trim()) || correlativo.trim()),
    fecha: texto(xml, "IssueDate"),
    moneda: texto(xml, "DocumentCurrencyCode") === "USD" ? "USD" : "PEN",
    emisor: { ruc: texto(proveedor, "PartyIdentification", "ID") || texto(proveedor, "CustomerAssignedAccountID"), nombre: texto(proveedor, "RegistrationName") },
    cliente: { documento: texto(cliente, "PartyIdentification", "ID") || texto(cliente, "CustomerAssignedAccountID"), nombre: texto(cliente, "RegistrationName") },
    sinIgv,
    igv,
    total,
    lineas,
  };
}
