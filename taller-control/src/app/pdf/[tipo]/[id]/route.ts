import { respuestaPdf } from "@/lib/pdf/documento";
import { pdfCaja, pdfCierre, pdfComprobante, pdfCompra, pdfCotizacion, pdfEstadoCuenta, pdfHistorial, pdfInventario, pdfKardex, pdfOrden, pdfPago, pdfRecibo, pdfReporte, type ModoIgv } from "@/lib/pdf/documentos";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";

/**
 * PDF de cualquier documento: /pdf/cotizacion/{id}?igv=con|sin, /pdf/orden/{id},
 * /pdf/pago/{id}, /pdf/recibo/{id}, /pdf/cuenta/{orden}, /pdf/comprobante/{id}, /pdf/compra/{id},
 * /pdf/caja/{id}, /pdf/cierre/{AAAA-MM-DD}, /pdf/reporte/{AAAA-MM}?ambito=todos,
 * /pdf/kardex/{repuesto}, /pdf/inventario/hoy, /pdf/historial/{placa}.
 * Se abre en el navegador; desde ahí se descarga, imprime o comparte.
 */
export async function GET(peticion: Request, { params }: { params: Promise<{ tipo: string; id: string }> }) {
  const ctx = await obtenerContexto();
  const { tipo, id } = await params;
  const url = new URL(peticion.url);
  const modo: ModoIgv = url.searchParams.get("igv") === "sin" ? "sin" : "con";
  const uuid = /^[0-9a-f-]{36}$/.test(id);
  const caja = tieneAlguno(ctx.roles, CAJA);
  const inventario = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen"]);

  let pdf = null;
  try {
    if (tipo === "cotizacion" && uuid && caja) pdf = await pdfCotizacion(ctx, id, modo);
    else if (tipo === "orden" && uuid) pdf = await pdfOrden(ctx, id, caja);
    else if (tipo === "pago" && uuid && caja) pdf = await pdfPago(ctx, id);
    else if (tipo === "recibo" && uuid && caja) pdf = await pdfRecibo(ctx, id);
    else if (tipo === "cuenta" && uuid && caja) pdf = await pdfEstadoCuenta(ctx, id);
    else if (tipo === "comprobante" && uuid && caja) pdf = await pdfComprobante(ctx, id);
    else if (tipo === "compra" && uuid) pdf = await pdfCompra(ctx, id, modo);
    else if (tipo === "caja" && uuid && caja) pdf = await pdfCaja(ctx, id);
    else if (tipo === "cierre" && /^\d{4}-\d{2}-\d{2}$/.test(id) && caja) pdf = await pdfCierre(ctx, id);
    else if (tipo === "kardex" && uuid && inventario) pdf = await pdfKardex(ctx, id);
    else if (tipo === "inventario" && id === "hoy" && inventario) pdf = await pdfInventario(ctx);
    else if (tipo === "historial" && /^[A-Z0-9]{6}$/.test(id) && tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "recepcion"])) pdf = await pdfHistorial(ctx, id, caja);
    else if (tipo === "reporte" && /^\d{4}-\d{2}$/.test(id)) pdf = await pdfReporte(ctx, id, url.searchParams.get("ambito") === "todos");
  } catch (e) {
    console.error("No se pudo generar el PDF", tipo, e);
    return new Response("No se pudo generar el PDF.", { status: 500 });
  }
  if (!pdf) return new Response("Documento no encontrado o sin permiso para verlo.", { status: 404 });
  return respuestaPdf(pdf.bytes, pdf.archivo);
}
