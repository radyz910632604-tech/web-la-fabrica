import ExcelJS from "exceljs";
import { filtrarIngresos, GRUPOS, ingresosEntre, resumirIngresos, type GrupoMedio } from "@/lib/caja/ingresos";
import { porCliente, porDia, porSemana } from "@/lib/caja/ingresos-calculo";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { diaEnLima } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { numeroOrden } from "@/lib/taller/estados";

const SOLES = '"S/ "#,##0.00';
const OSCURO = "FF1C1C1C";
const SUAVE = "FFF3F3F1";
const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fechaPe = (d: string) => d.split("-").reverse().join("/");

/** Hoja con título del taller, subtítulo y cabecera fija. */
function hoja(libro: ExcelJS.Workbook, nombre: string, titulo: string, subtitulo: string, columnas: { titulo: string; ancho: number; formato?: string }[]) {
  const h = libro.addWorksheet(nombre, { views: [{ state: "frozen", ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  h.columns = columnas.map((c) => ({ width: c.ancho, style: c.formato ? { numFmt: c.formato } : {} }));
  h.mergeCells(1, 1, 1, columnas.length);
  h.getCell(1, 1).value = titulo;
  h.getCell(1, 1).font = { bold: true, size: 14 };
  h.mergeCells(2, 1, 2, columnas.length);
  h.getCell(2, 1).value = subtitulo;
  h.getCell(2, 1).font = { color: { argb: "FF666666" } };
  const cab = h.getRow(4);
  columnas.forEach((c, k) => (cab.getCell(k + 1).value = c.titulo));
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: OSCURO } }));
  cab.alignment = { vertical: "middle", wrapText: true };
  cab.height = 28;
  return h;
}

function filaTotal(h: ExcelJS.Worksheet, valores: (string | number | null)[]) {
  const f = h.addRow(valores);
  f.font = { bold: true };
  f.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUAVE } }));
  return f;
}

/**
 * Libro de ingresos del mes, armado cada vez desde los pagos confirmados de la base:
 * cada pago es una fila con su fecha y hora reales, los días se van sumando debajo
 * y exportar de nuevo no duplica ni borra nada. Cuatro hojas: Registro diario,
 * Resumen mensual, Métodos de pago y Detalle por cliente.
 * Filtros opcionales: desde, hasta (días del mes), q (cliente, DNI/RUC, placa u orden) y medio.
 */
export async function GET(peticion: Request) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return new Response("Tu rol no descarga reportes de caja.", { status: 403 });
  const url = new URL(peticion.url);
  const hoy = diaEnLima(new Date());
  const pedido = url.searchParams.get("mes") ?? "";
  const mes = /^\d{4}-\d{2}$/.test(pedido) && pedido <= hoy.slice(0, 7) ? pedido : hoy.slice(0, 7);
  const [anio, numMes] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  const ultimoDia = new Date(Date.UTC(anio, numMes, 0)).toISOString().slice(0, 10);
  const enMes = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= primerDia && d <= ultimoDia ? d : null);
  const desde = enMes(url.searchParams.get("desde")) ?? primerDia;
  const hasta = enMes(url.searchParams.get("hasta")) ?? ultimoDia;
  const q = (url.searchParams.get("q") ?? "").slice(0, 60);
  const medioPedido = url.searchParams.get("medio");
  const medio = GRUPOS.some(([g]) => g === medioPedido) ? (medioPedido as GrupoMedio) : null;

  const delMes = await ingresosEntre(ctx.taller.id, primerDia, ultimoDia);
  const filtrados = filtrarIngresos(delMes.filter((i) => i.dia >= desde && i.dia <= hasta), q, medio);
  const conFiltro = desde !== primerDia || hasta !== ultimoDia || q || medio;
  const periodo = `${MESES[numMes - 1]} ${anio}`;
  const filtroTexto = conFiltro
    ? `Filtro: ${desde === hasta ? fechaPe(desde) : `${fechaPe(desde)} al ${fechaPe(hasta)}`}${q ? ` · «${q}»` : ""}${medio ? ` · ${GRUPOS.find(([g]) => g === medio)?.[1]}` : ""}`
    : "Todos los pagos confirmados del mes";
  const empresa = ctx.taller.nombre.toUpperCase();

  const libro = new ExcelJS.Workbook();
  libro.creator = "Taller Control";
  libro.created = new Date();

  // 1. Registro diario (acumulativo)
  const r = hoja(libro, "Registro diario", `${empresa} · REGISTRO DE INGRESOS – ${periodo.toUpperCase()}`, `${filtroTexto}. Se agrega una fila por cada pago confirmado; los abonos van uno por uno y las devoluciones en negativo.`, [
    { titulo: "N.°", ancho: 6 },
    { titulo: "Fecha", ancho: 11 },
    { titulo: "Día", ancho: 6 },
    { titulo: "Hora", ancho: 7 },
    { titulo: "Orden", ancho: 11 },
    { titulo: "Cliente", ancho: 24 },
    { titulo: "DNI / RUC", ancho: 13 },
    { titulo: "Placa", ancho: 10 },
    { titulo: "Servicio / concepto", ancho: 34 },
    { titulo: "Método de pago", ancho: 15 },
    { titulo: "Subtotal", ancho: 12, formato: SOLES },
    { titulo: "IGV", ancho: 11, formato: SOLES },
    { titulo: "Total recibido", ancho: 14, formato: SOLES },
    { titulo: "Comprobante", ancho: 16 },
    { titulo: "Usuario", ancho: 18 },
  ]);
  filtrados.forEach((i, k) => {
    r.addRow([
      k + 1,
      fechaPe(i.dia),
      DIAS[new Date(`${i.dia}T12:00:00Z`).getUTCDay()],
      i.hora,
      i.orden ? numeroOrden(i.orden) : "",
      i.cliente ?? "",
      i.documento ?? "",
      i.placa ?? "",
      i.concepto,
      MEDIOS[i.medio as MedioPago] + (i.operacion ? ` · ${i.operacion}` : ""),
      i.subtotal,
      i.igv,
      i.monto,
      i.comprobante,
      i.usuario,
    ]);
  });
  const resF = resumirIngresos(filtrados);
  filaTotal(r, ["", "", "", "", "", `${resF.operaciones} operaciones`, "", "", resF.devoluciones ? `Devoluciones: S/ ${resF.devoluciones.toFixed(2)}` : "", "Total", filtrados.reduce((a, i) => a + i.subtotal, 0), filtrados.reduce((a, i) => a + i.igv, 0), resF.total, "", ""]);
  r.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 15 } };

  // 2. Resumen mensual (siempre del mes completo)
  const resMes = resumirIngresos(delMes);
  const s = hoja(libro, "Resumen mensual", `${empresa} · RESUMEN MENSUAL DE INGRESOS`, `Periodo: ${periodo}. Ingresos = dinero efectivamente recibido (no el valor de las órdenes).`, [
    { titulo: "Concepto", ancho: 30 },
    { titulo: "Monto (S/)", ancho: 16, formato: SOLES },
    { titulo: "Participación", ancho: 14, formato: "0.0%" },
  ]);
  s.addRow(["Total de ingresos del mes", resMes.entradas, null]);
  s.addRow(["Total de operaciones", resMes.operaciones, null]).getCell(2).numFmt = "0";
  s.addRow(["Devoluciones", -resMes.devoluciones, null]);
  filaTotal(s, ["Ingreso neto", resMes.total, null]);
  s.addRow([]);
  const cabM = s.addRow(["Método de pago", "Total (S/)", "Participación"]);
  cabM.font = { bold: true };
  for (const [g, t] of GRUPOS) s.addRow([t, resMes.porGrupo[g], resMes.total ? resMes.porGrupo[g] / resMes.total : 0]);
  filaTotal(s, ["Total del mes", resMes.total, resMes.total ? 1 : 0]);
  s.addRow([]);
  const cabS = s.addRow(["Ingresos por semana (lun–dom)", "Monto (S/)", ""]);
  cabS.font = { bold: true };
  for (const w of porSemana(delMes)) s.addRow([`Semana ${w.semana} (${fechaPe(w.desde).slice(0, 5)} – ${fechaPe(w.hasta).slice(0, 5)})`, w.total, null]);
  filaTotal(s, ["Total", resMes.total, null]);

  // 3. Métodos de pago (total diario y mensual)
  const m = hoja(libro, "Métodos de pago", `${empresa} · INGRESOS POR MÉTODO DE PAGO – ${periodo.toUpperCase()}`, "Efectivo físico separado de los pagos electrónicos. Un día por fila.", [
    { titulo: "Fecha", ancho: 12 },
    { titulo: "Efectivo (S/)", ancho: 15, formato: SOLES },
    { titulo: "Yape / Plin (S/)", ancho: 15, formato: SOLES },
    { titulo: "Transferencias (S/)", ancho: 17, formato: SOLES },
    { titulo: "Tarjetas (S/)", ancho: 14, formato: SOLES },
    { titulo: "Total diario (S/)", ancho: 16, formato: SOLES },
  ]);
  for (const d of porDia(delMes)) m.addRow([fechaPe(d.dia), d.efectivo, d.yape_plin, d.transferencia, d.tarjeta, d.total]);
  filaTotal(m, ["TOTAL DEL MES", resMes.porGrupo.efectivo, resMes.porGrupo.yape_plin, resMes.porGrupo.transferencia, resMes.porGrupo.tarjeta, resMes.total]);

  // 4. Detalle por cliente
  const c = hoja(libro, "Detalle por cliente", `${empresa} · INGRESOS POR CLIENTE – ${periodo.toUpperCase()}`, `${filtroTexto}.`, [
    { titulo: "Cliente", ancho: 26 },
    { titulo: "DNI / RUC", ancho: 13 },
    { titulo: "N.° de orden", ancho: 16 },
    { titulo: "Placa", ancho: 12 },
    { titulo: "Servicios", ancho: 40 },
    { titulo: "Fechas", ancho: 22 },
    { titulo: "Pagos", ancho: 8 },
    { titulo: "Total (S/)", ancho: 14, formato: SOLES },
  ]);
  for (const x of porCliente(filtrados)) {
    const fila = c.addRow([x.cliente, x.documento ?? "", x.ordenes.map(numeroOrden).join(", "), x.placas.join(", "), x.servicios.join(" · "), x.fechas.map((d) => fechaPe(d).slice(0, 5)).join(", "), x.pagos, x.total]);
    fila.alignment = { wrapText: true, vertical: "top" };
  }
  filaTotal(c, ["Total", "", "", "", "", "", resF.operaciones, resF.total]);

  const bytes = await libro.xlsx.writeBuffer();
  return new Response(bytes as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="ingresos-${mes}${conFiltro ? "-filtrado" : ""}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
