import { GRUPOS, ingresosEntre, resumirIngresos } from "@/lib/caja/ingresos";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { diaEnLima } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { detalleCaja } from "@/lib/taller/caja-consultas";
import { nombresPersonal } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { documentoWord, type Bloque } from "@/lib/word/docx";

const s = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hora = (f: string | null) => (f ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(f)) : "—");

/** Reporte del cierre diario en Word (uno por día): se puede volver a descargar cuando se quiera. */
export async function GET(_peticion: Request, { params }: { params: Promise<{ dia: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) return new Response("Tu rol no descarga reportes de caja.", { status: 403 });
  const { dia } = await params;
  const hoy = diaEnLima(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia > hoy) return new Response("Fecha no válida.", { status: 400 });
  const supabase = await clienteServidor();
  const [ingresos, nombres, { data: cierre }, { data: cajas }] = await Promise.all([
    ingresosEntre(ctx.taller.id, dia, dia),
    nombresPersonal(ctx.taller.id),
    supabase.from("cierres_diarios").select("cerrado_por, cerrado_en, observaciones").eq("empresa_id", ctx.taller.id).eq("fecha", dia).maybeSingle(),
    supabase.from("cajas").select("id").eq("empresa_id", ctx.taller.id).eq("tipo_caja", "recepcion").eq("fecha", dia).order("abierta_en"),
  ]);
  const detalles = (await Promise.all((cajas ?? []).map((c) => detalleCaja(ctx.taller.id, c.id)))).filter((x) => x !== null);
  const r = resumirIngresos(ingresos);
  const fecha = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`));
  const responsable = cierre ? (nombres.get(cierre.cerrado_por ?? "") ?? "—") : detalles.map((d) => nombres.get(d.caja.cerradaPor ?? d.caja.abiertaPor ?? "") ?? "").filter(Boolean).join(", ") || "Sin cerrar";

  const bloques: Bloque[] = [
    { tipo: "titulo", texto: `${ctx.taller.nombre.toUpperCase()} · CIERRE DE CAJA DIARIO` },
    { tipo: "parrafo", texto: `Fecha: ${fecha.charAt(0).toUpperCase()}${fecha.slice(1)}` },
    { tipo: "parrafo", texto: `Responsable: ${responsable}${cierre ? ` · cerrado a las ${hora(cierre.cerrado_en)}` : " · el día aún no se cierra"}` },
    { tipo: "parrafo", texto: "Ingresos = pagos confirmados (dinero efectivamente recibido). Cada abono figura por separado; las devoluciones se descuentan aparte.", tenue: true },
    { tipo: "subtitulo", texto: "Resumen de ingresos por método de pago" },
    {
      tipo: "tabla",
      columnas: [{ titulo: "Método de pago", ancho: 4200 }, { titulo: "Total", ancho: 2400, derecha: true }],
      filas: [...GRUPOS.map(([g, t]) => [t, s(r.porGrupo[g])]), ["Total de operaciones", String(r.operaciones)], ["Devoluciones", r.devoluciones ? `−${s(r.devoluciones)}` : s(0)]],
      total: ["Total de ingresos del día", s(r.total)],
    },
    { tipo: "subtitulo", texto: "Detalle de operaciones" },
    ingresos.length
      ? {
          tipo: "tabla",
          columnas: [
            { titulo: "Orden", ancho: 1150 },
            { titulo: "Hora", ancho: 750 },
            { titulo: "Cliente", ancho: 2400 },
            { titulo: "DNI / RUC", ancho: 1300 },
            { titulo: "Placa", ancho: 1000 },
            { titulo: "Servicio / concepto", ancho: 3700 },
            { titulo: "Forma de pago", ancho: 1900 },
            { titulo: "Usuario", ancho: 1600 },
            { titulo: "Total", ancho: 1300, derecha: true },
          ],
          filas: ingresos.map((i) => [
            i.orden ? numeroOrden(i.orden) : "—",
            i.hora,
            i.cliente ?? "—",
            i.documento ?? "—",
            i.placa ?? "—",
            i.concepto,
            MEDIOS[i.medio as MedioPago] + (i.operacion ? ` · ${i.operacion}` : ""),
            i.usuario,
            s(i.monto),
          ]),
          total: ["", "", `${r.operaciones} operaciones`, "", "", "", "", "Total", s(r.total)],
        }
      : { tipo: "parrafo", texto: "No hubo ingresos este día." },
    { tipo: "subtitulo", texto: "Devoluciones" },
    r.devoluciones
      ? {
          tipo: "tabla",
          columnas: [{ titulo: "Orden", ancho: 1400 }, { titulo: "Hora", ancho: 900 }, { titulo: "Cliente", ancho: 3000 }, { titulo: "Motivo", ancho: 4200 }, { titulo: "Monto", ancho: 1500, derecha: true }],
          filas: ingresos.filter((i) => i.monto < 0).map((i) => [i.orden ? numeroOrden(i.orden) : "—", i.hora, i.cliente ?? "—", i.concepto, s(i.monto)]),
        }
      : { tipo: "parrafo", texto: "Sin devoluciones." },
    { tipo: "subtitulo", texto: "Arqueo de efectivo" },
    detalles.length
      ? {
          tipo: "tabla",
          columnas: [{ titulo: "Caja de Recepción", ancho: 2600 }, { titulo: "Esperado (sistema)", ancho: 2200, derecha: true }, { titulo: "Contado (físico)", ancho: 2200, derecha: true }, { titulo: "Diferencia", ancho: 2000, derecha: true }, { titulo: "Observación", ancho: 4200 }],
          filas: detalles.map((d) => [
            `${hora(d.caja.abiertaEn)} – ${d.caja.cerradaEn ? hora(d.caja.cerradaEn) : "abierta"}`,
            s(d.caja.esperado ?? d.efectivo.esperado),
            d.caja.contado != null ? s(d.caja.contado) : "—",
            d.caja.diferencia != null ? s(d.caja.diferencia) : "—",
            d.caja.observaciones ?? "Sin observaciones",
          ]),
        }
      : { tipo: "parrafo", texto: "Ese día no se abrió la caja de Recepción." },
    { tipo: "subtitulo", texto: "Observaciones del cierre" },
    { tipo: "parrafo", texto: cierre?.observaciones || "Sin observaciones." },
    { tipo: "parrafo", texto: " " },
    { tipo: "parrafo", texto: "______________________________          ______________________________" },
    { tipo: "parrafo", texto: "Responsable de caja                                         Administración" , tenue: true },
  ];
  const bytes = await documentoWord(bloques, { horizontal: true });
  return new Response(bytes as unknown as ArrayBuffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="cierre-${dia}.docx"`,
      "cache-control": "no-store",
    },
  });
}
