import ExcelJS from "exceljs";
import { diaEnLima } from "@/lib/formato";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { limitesMes } from "@/lib/taller/dinero-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { mesesHasta, personalDelMes, reporteMensual, sumarFilas, type FilaMes } from "@/lib/taller/reportes";

const SOLES = '"S/ "#,##0.00';
const PORCENTAJE = "0.0%";

function hoja(libro: ExcelJS.Workbook, nombre: string, columnas: { titulo: string; ancho: number; formato?: string }[]) {
  const h = libro.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 1 }] });
  h.columns = columnas.map((c) => ({ header: c.titulo, width: c.ancho, style: c.formato ? { numFmt: c.formato } : {} }));
  h.getRow(1).font = { bold: true };
  h.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F1F1" } };
  return h;
}

const filaMes = (etiqueta: string, f: FilaMes) => [etiqueta, f.ventas, f.compras, f.manoObra, f.utilidad, f.margen ?? null, f.gastos, f.personal, f.utilidadNeta, f.margenNeto ?? null, f.entregados, f.ventasConIgv];
const COLUMNAS_MES = [
  { titulo: "", ancho: 22 },
  { titulo: "Ventas sin IGV", ancho: 16, formato: SOLES },
  { titulo: "Compras sin IGV", ancho: 16, formato: SOLES },
  { titulo: "Mano de obra", ancho: 15, formato: SOLES },
  { titulo: "Utilidad bruta", ancho: 15, formato: SOLES },
  { titulo: "Margen bruto", ancho: 12, formato: PORCENTAJE },
  { titulo: "Gastos del taller", ancho: 16, formato: SOLES },
  { titulo: "Personal (sueldos y comisiones)", ancho: 18, formato: SOLES },
  { titulo: "Utilidad neta", ancho: 15, formato: SOLES },
  { titulo: "Margen neto", ancho: 12, formato: PORCENTAJE },
  { titulo: "Carros entregados", ancho: 17 },
  { titulo: "Ventas con IGV", ancho: 16, formato: SOLES },
];

/** Descarga el reporte del mes en Excel (solo gerencia). */
export async function GET(peticion: Request) {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("gerencia")) return new Response("Solo gerencia descarga reportes.", { status: 403 });
  const url = new URL(peticion.url);
  const hoy = diaEnLima(new Date());
  const ultimos = mesesHasta(hoy.slice(0, 7), 12);
  const pedido = url.searchParams.get("mes") ?? "";
  const mes = ultimos.includes(pedido) ? pedido : hoy.slice(0, 7);
  const talleres = ctx.talleres.filter((t) => t.roles.includes("gerencia"));
  const alcance = url.searchParams.get("ambito") === "todos" && talleres.length > 1 ? talleres : [ctx.taller];
  const supabase = await clienteServidor();
  const { desdeDia, hastaDia } = limitesMes(mes);

  const datos = await Promise.all(
    alcance.map(async (t) => {
      const [filas, personal, { data: comps }, { data: compras }, { data: ordenes }] = await Promise.all([
        reporteMensual(t.id, ultimos, hoy, true),
        personalDelMes(t.id, mes),
        supabase.from("comprobantes_venta").select("fecha_emision, tipo, serie, numero, orden_id, documento_cliente, subtotal_sin_igv, igv, total, estado, motivo_anulacion").eq("empresa_id", t.id).gte("fecha_emision", desdeDia).lt("fecha_emision", hastaDia).order("fecha_emision"),
        supabase.from("compras").select("fecha_emision, tipo_comprobante, serie, numero, moneda, tipo_cambio, subtotal_sin_igv, igv, total, estado, proveedores (razon_social, ruc)").eq("empresa_id", t.id).gte("fecha_emision", desdeDia).lt("fecha_emision", hastaDia).order("fecha_emision"),
        supabase.from("ordenes_trabajo").select("id, numero").eq("empresa_id", t.id),
      ]);
      return { taller: t, filas, personal, comps: comps ?? [], compras: compras ?? [], numeros: new Map((ordenes ?? []).map((o) => [o.id, o.numero as number])) };
    }),
  );

  const libro = new ExcelJS.Workbook();
  libro.creator = "Taller Control";
  libro.created = new Date();

  const i = ultimos.indexOf(mes);
  const resumen = hoja(libro, "Resumen", COLUMNAS_MES);
  for (const d of datos) resumen.addRow(filaMes(d.taller.nombre, d.filas[i]));
  if (datos.length > 1) resumen.addRow(filaMes("Total", sumarFilas(datos.map((d) => d.filas[i]), mes))).font = { bold: true };
  resumen.addRow([]);
  resumen.addRow([`Mes: ${mes}${datos[0].filas[i].parcial ? " (hasta hoy)" : ""}. Montos en soles; la utilidad es sin IGV.`]);

  const meses = hoja(libro, "Mes a mes", COLUMNAS_MES);
  ultimos.forEach((m, k) => meses.addRow(filaMes(m, sumarFilas(datos.map((d) => d.filas[k]), m))));

  const ventas = hoja(libro, "Comprobantes", [
    { titulo: "Taller", ancho: 16 },
    { titulo: "Fecha", ancho: 12 },
    { titulo: "Tipo", ancho: 10 },
    { titulo: "Número", ancho: 14 },
    { titulo: "Orden", ancho: 12 },
    { titulo: "DNI o RUC", ancho: 14 },
    { titulo: "Sin IGV", ancho: 14, formato: SOLES },
    { titulo: "IGV", ancho: 12, formato: SOLES },
    { titulo: "Total", ancho: 14, formato: SOLES },
    { titulo: "Estado", ancho: 12 },
    { titulo: "Motivo de anulación", ancho: 30 },
  ]);
  for (const d of datos)
    for (const c of d.comps)
      ventas.addRow([
        d.taller.nombre,
        c.fecha_emision,
        c.tipo === "boleta" ? "Boleta" : "Factura",
        `${c.serie}-${c.numero}`,
        c.orden_id ? numeroOrden(d.numeros.get(c.orden_id) ?? 0) : "Sin orden",
        c.documento_cliente ?? "",
        Number(c.subtotal_sin_igv),
        Number(c.igv),
        Number(c.total),
        c.estado,
        c.motivo_anulacion ?? "",
      ]);

  const comprasHoja = hoja(libro, "Compras", [
    { titulo: "Taller", ancho: 16 },
    { titulo: "Fecha", ancho: 12 },
    { titulo: "Proveedor", ancho: 34 },
    { titulo: "RUC", ancho: 14 },
    { titulo: "Comprobante", ancho: 18 },
    { titulo: "Moneda", ancho: 9 },
    { titulo: "Sin IGV", ancho: 14, formato: "#,##0.00" },
    { titulo: "IGV", ancho: 12, formato: "#,##0.00" },
    { titulo: "Total", ancho: 14, formato: "#,##0.00" },
    { titulo: "Tipo de cambio", ancho: 14 },
    { titulo: "Estado", ancho: 12 },
  ]);
  for (const d of datos)
    for (const c of d.compras) {
      const p = Array.isArray(c.proveedores) ? c.proveedores[0] : c.proveedores;
      comprasHoja.addRow([
        d.taller.nombre,
        c.fecha_emision,
        p?.razon_social ?? "",
        p?.ruc ?? "",
        `${c.tipo_comprobante}${c.serie ? ` ${c.serie}-${c.numero}` : ""}`,
        c.moneda,
        Number(c.subtotal_sin_igv),
        Number(c.igv),
        Number(c.total),
        Number(c.tipo_cambio),
        c.estado,
      ]);
    }

  const personal = hoja(libro, "Personal", [
    { titulo: "Taller", ancho: 16 },
    { titulo: "Persona", ancho: 24 },
    { titulo: "Rol", ancho: 26 },
    { titulo: "Costo mensual", ancho: 15, formato: SOLES },
    { titulo: "Comisiones", ancho: 14, formato: SOLES },
    { titulo: "Total", ancho: 14, formato: SOLES },
    { titulo: "Trabajos o citas con comisión", ancho: 28 },
  ]);
  for (const d of datos) for (const p of d.personal) personal.addRow([d.taller.nombre, p.nombre, p.roles, p.costo, p.comision, p.costo + p.comision, p.trabajos]);

  const buffer = await libro.xlsx.writeBuffer();
  const nombre = `reporte-${alcance.length > 1 ? "talleres" : ctx.taller.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${mes}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "no-store",
    },
  });
}
