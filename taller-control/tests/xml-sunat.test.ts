import { describe, expect, it } from "vitest";
import { leerXmlSunat } from "@/lib/xml-sunat";

// Factura electrónica de ejemplo (formato UBL 2.1 de SUNAT), con datos ficticios.
const FACTURA = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>F001-00000123</cbc:ID>
  <cbc:IssueDate>2026-11-14</cbc:IssueDate>
  <cbc:InvoiceTypeCode listID="0101">01</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">20123456789</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName><![CDATA[REPUESTOS LIMA S.A.C.]]></cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="6">20987654321</cbc:ID></cac:PartyIdentification>
    <cac:PartyLegalEntity><cbc:RegistrationName>TALLER NORTE E.I.R.L.</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">36.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">200.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="PEN">236.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="NIU">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">160.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>PASTILLAS DE FRENO DELANTERAS</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">80.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="NIU">1</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">40.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Description>LIQUIDO DE FRENOS DOT4 &amp; LIMPIADOR</cbc:Description></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="PEN">40.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

describe("XML de SUNAT", () => {
  it("lee tipo, serie, número, fecha, emisor, cliente y montos", () => {
    const c = leerXmlSunat(FACTURA);
    expect(c).toMatchObject({
      tipo: "factura",
      serie: "F001",
      numero: "123",
      fecha: "2026-11-14",
      moneda: "PEN",
      emisor: { ruc: "20123456789", nombre: "REPUESTOS LIMA S.A.C." },
      cliente: { documento: "20987654321", nombre: "TALLER NORTE E.I.R.L." },
      sinIgv: 200,
      igv: 36,
      total: 236,
    });
  });
  it("lee cada línea con cantidad y precio sin IGV", () => {
    expect(leerXmlSunat(FACTURA).lineas).toEqual([
      { descripcion: "PASTILLAS DE FRENO DELANTERAS", cantidad: 2, precioUnitarioSinIgv: 80, sinIgv: 160 },
      { descripcion: "LIQUIDO DE FRENOS DOT4 & LIMPIADOR", cantidad: 1, precioUnitarioSinIgv: 40, sinIgv: 40 },
    ]);
  });
  it("reconoce una boleta", () => {
    expect(leerXmlSunat(FACTURA.replace(">01</cbc:InvoiceTypeCode>", ">03</cbc:InvoiceTypeCode>").replace("F001-", "B001-")).tipo).toBe("boleta");
  });
  it("rechaza un archivo que no es comprobante", () => {
    expect(() => leerXmlSunat("<html></html>")).toThrow("no es una factura");
  });
});

const NOTA = `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>BC01-00000007</cbc:ID>
  <cbc:IssueDate>2026-11-16</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:DiscrepancyResponse><cbc:ReferenceID>B001-00000050</cbc:ReferenceID><cbc:ResponseCode>04</cbc:ResponseCode><cbc:Description>DESCUENTO POR DEMORA</cbc:Description></cac:DiscrepancyResponse>
  <cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>B001-00000050</cbc:ID><cbc:DocumentTypeCode>03</cbc:DocumentTypeCode></cac:InvoiceDocumentReference></cac:BillingReference>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20000000099</cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>TALLER DE PRUEBA S.A.C.</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">7.63</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="PEN">42.37</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="PEN">50.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
  <cac:CreditNoteLine><cbc:ID>1</cbc:ID><cbc:CreditedQuantity unitCode="NIU">1</cbc:CreditedQuantity><cbc:LineExtensionAmount currencyID="PEN">42.37</cbc:LineExtensionAmount><cac:Item><cbc:Description>DESCUENTO</cbc:Description></cac:Item><cac:Price><cbc:PriceAmount currencyID="PEN">42.37</cbc:PriceAmount></cac:Price></cac:CreditNoteLine>
</CreditNote>`;

describe("nota de crédito de SUNAT", () => {
  it("lee la nota, el comprobante que rebaja y el motivo", () => {
    expect(leerXmlSunat(NOTA)).toMatchObject({
      tipo: "nota_credito",
      serie: "BC01",
      numero: "7",
      referencia: { serie: "B001", numero: "50" },
      motivoCodigo: "04",
      motivo: "DESCUENTO POR DEMORA",
      sinIgv: 42.37,
      igv: 7.63,
      total: 50,
      lineas: [{ descripcion: "DESCUENTO", cantidad: 1, precioUnitarioSinIgv: 42.37, sinIgv: 42.37 }],
    });
  });
});
