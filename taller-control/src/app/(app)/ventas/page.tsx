import Link from "next/link";
import { notFound } from "next/navigation";
import { Anular } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { MOTIVOS_NOTA } from "@/lib/dinero";
import { ConfirmarMontos } from "@/components/ia/confirmar-montos";
import { estadoIa } from "@/lib/ia/proveedor";
import { anularComprobante, anularNotaCredito, confirmarComprobante } from "./acciones";
import { AsignarOrden, RegistrarComprobante, RegistrarNota } from "./formulario";

export const metadata = { title: "Comprobantes de venta" };

export default async function Ventas({ searchParams }: { searchParams: Promise<{ nuevo?: string; ver?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { nuevo, ver } = await searchParams;
  const verPendientes = ver === "por-confirmar";
  const supabase = await clienteServidor();
  const hoy = diaEnLima(new Date());
  const [{ data }, ordenes, { data: notasCrudas }, { data: recibosCrudos }] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, orden_id, tipo, serie, numero, fecha_emision, documento_cliente, subtotal_sin_igv, igv, total, estado, origen_datos, motivo_anulacion, archivo_path")
      .eq("empresa_id", ctx.taller.id)
      .order("fecha_emision", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(60),
    listarOrdenes(ctx.taller.id, { limite: 200, orden: "reciente" }),
    supabase
      .from("notas_credito")
      .select("id, comprobante_id, serie, numero, fecha_emision, total, estado, motivo_codigo, motivo, motivo_anulacion")
      .eq("empresa_id", ctx.taller.id)
      .order("fecha_emision", { ascending: false })
      .limit(200),
    // Los recibos del taller también son ventas (cuando la orden no tiene boleta ni factura).
    supabase.from("recibos").select("id, numero, orden_id, emitido_en, total, estado, motivo_anulacion").eq("empresa_id", ctx.taller.id).order("emitido_en", { ascending: false }).limit(60),
  ]);
  const recibos = recibosCrudos ?? [];
  const recibosMes = recibos.filter((r) => r.estado !== "anulado" && diaEnLima(new Date(r.emitido_en)).slice(0, 7) === hoy.slice(0, 7));
  const notas = notasCrudas ?? [];
  const notasDe = (id: string) => notas.filter((x) => x.comprobante_id === id);
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const opciones = ordenes.map((o) => ({ id: o.id, etiqueta: `${numeroOrden(o.numero)} · ${o.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}${o.cliente ? ` · ${o.cliente}` : ""}` }));
  const todos = data ?? [];
  const pendientes = todos.filter((c) => c.estado === "por_confirmar");
  const lista = verPendientes ? pendientes : todos;
  const rutas = pendientes.map((c) => c.archivo_path).filter(Boolean) as string[];
  const { data: firmados } = rutas.length ? await supabase.storage.from("comprobantes").createSignedUrls(rutas, 1800) : { data: [] };
  const enlace = new Map((firmados ?? []).map((f) => [f.path, f.signedUrl]));
  const sinOrden = lista.filter((c) => !c.orden_id && c.estado !== "anulado");
  const delMes = lista.filter((c) => c.estado === "confirmado" && c.fecha_emision.slice(0, 7) === hoy.slice(0, 7));
  const notasMes = notas.filter((x) => x.estado === "confirmado" && x.fecha_emision.slice(0, 7) === hoy.slice(0, 7));
  const netoMes = delMes.reduce((a, c) => a + Number(c.total), 0) - notasMes.reduce((a, x) => a + Number(x.total), 0);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Comprobantes de venta"
        detalle={`${delMes.length} este mes por ${formatearSoles(netoMes)}${notasMes.length ? ` (ya restadas ${notasMes.length} ${notasMes.length === 1 ? "nota" : "notas"} de crédito)` : ""}${sinOrden.length ? ` · ${sinOrden.length} sin orden asignada` : ""}. El sistema no emite comprobantes: registra los que ya entregaste.`}
        accion={<RegistrarComprobante ordenes={opciones} hoy={hoy} abrir={nuevo === "1"} ia={estadoIa().lectura} />}
      />
      <SubnavCaja actual="/ventas" roles={ctx.roles} />
      <Tarjeta aria-labelledby="t-comp">
        <CabeceraTarjeta
          id="t-comp"
          titulo={verPendientes ? "Por confirmar" : "Últimos comprobantes"}
          detalle={verPendientes ? "Leídos por IA. No cuentan en ventas ni en el saldo hasta que alguien los revise y confirme." : undefined}
          accion={
            pendientes.length || verPendientes ? (
              <Link href={verPendientes ? "/ventas" : "/ventas?ver=por-confirmar"} className="presionable flex h-10 items-center rounded-full bg-aviso-fondo px-4 text-sm font-medium text-aviso">
                {verPendientes ? "Ver todos" : `Por confirmar (${pendientes.length})`}
              </Link>
            ) : undefined
          }
        />
        {lista.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">{verPendientes ? "No hay comprobantes por confirmar." : "Todavía no hay comprobantes registrados."}</p>
        ) : (
          <ul className="flex flex-col">
            {lista.map((c) => {
              const o = c.orden_id ? porId.get(c.orden_id) : null;
              const anulado = c.estado === "anulado";
              return (
                <li key={c.id} className="flex flex-col gap-3 border-t border-regla py-3 first:border-t-0 md:flex-row md:flex-wrap md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] font-medium ${anulado ? "text-tinta-3 line-through" : ""}`}>
                      {c.tipo === "boleta" ? "Boleta" : "Factura"} {c.serie}-{c.numero}
                      <span className="num ml-2 font-normal text-tinta-2">{formatearSoles(Number(c.total))}</span>
                    </p>
                    <p className="text-[13px] text-tinta-3">
                      {c.fecha_emision.split("-").reverse().join("/")} · sin IGV {formatearSoles(Number(c.subtotal_sin_igv))}
                      {c.origen_datos === "xml_sunat" ? " · leído del XML" : c.origen_datos === "ia" ? " · leído por IA" : ""}
                      {o ? (
                        <>
                          {" · "}
                          <Link href={`/ordenes/${o.id}`} className="underline-offset-4 hover:underline">
                            {numeroOrden(o.numero)}
                          </Link>
                        </>
                      ) : null}
                      {anulado ? ` · Anulado: ${c.motivo_anulacion}` : ""}
                    </p>
                  </div>
                  {!anulado && !c.orden_id ? (
                    <div className="w-full md:w-72">
                      <AsignarOrden id={c.id} ordenes={opciones} />
                    </div>
                  ) : null}
                  {!anulado
                    ? (() => {
                        const usadas = notasDe(c.id).filter((x) => x.estado === "confirmado").reduce((a, x) => a + Number(x.total), 0);
                        const disponible = Math.round((Number(c.total) - usadas) * 100) / 100;
                        return (
                          <div className="flex items-center gap-1">
                            {c.estado === "por_confirmar" ? (
                              <>
                                <span className="shrink-0 rounded-full bg-aviso-fondo px-2.5 py-1 text-[12px] font-medium text-aviso">Por confirmar</span>
                                <ConfirmarMontos
                                  id={c.id}
                                  titulo={`${c.tipo === "boleta" ? "Boleta" : "Factura"} ${c.serie}-${c.numero}`}
                                  archivo={c.archivo_path ? enlace.get(c.archivo_path) : null}
                                  accion={confirmarComprobante}
                                  filas={[
                                    ["Fecha", c.fecha_emision.split("-").reverse().join("/")],
                                    ["Cliente", c.documento_cliente ?? "—"],
                                    ["Orden", o ? numeroOrden(o.numero) : "Sin orden"],
                                    ["Sin IGV", formatearSoles(Number(c.subtotal_sin_igv))],
                                    ["IGV", formatearSoles(Number(c.igv))],
                                    ["Total", formatearSoles(Number(c.total))],
                                  ]}
                                />
                              </>
                            ) : (
                              <EnlacePdf href={`/pdf/comprobante/${c.id}`} />
                            )}
                            {disponible > 0.009 && c.estado === "confirmado" ? <RegistrarNota comprobante={c.id} etiqueta={`${c.serie}-${c.numero}`} disponible={disponible} hoy={hoy} /> : null}
                            <Anular id={c.id} accion={anularComprobante} que="comprobante" />
                          </div>
                        );
                      })()
                    : null}
                  {notasDe(c.id).length ? (
                    <ul className="w-full basis-full md:pl-0">
                      {notasDe(c.id).map((x) => (
                        <li key={x.id} className="mt-1 flex items-center gap-3 rounded-2xl bg-interna px-4 py-2">
                          <p className={`min-w-0 flex-1 text-[14px] ${x.estado === "anulado" ? "text-tinta-3 line-through" : ""}`}>
                            Nota de crédito {x.serie}-{x.numero}
                            <span className="num ml-2 text-negativo">−{formatearSoles(Number(x.total))}</span>
                            <span className="block text-[13px] text-tinta-3">
                              {x.fecha_emision.split("-").reverse().join("/")} · {MOTIVOS_NOTA[x.motivo_codigo]}
                              {x.motivo ? ` · ${x.motivo}` : ""}
                              {x.estado === "anulado" ? ` · Anulada: ${x.motivo_anulacion}` : ""}
                            </span>
                          </p>
                          {x.estado !== "anulado" ? <Anular id={x.id} accion={anularNotaCredito} que="nota de crédito" /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>

      {!verPendientes ? (
        <Tarjeta aria-labelledby="t-recibos">
          <CabeceraTarjeta
            id="t-recibos"
            titulo="Recibos de venta"
            detalle={`${recibosMes.length} este mes por ${formatearSoles(recibosMes.reduce((a, r) => a + Number(r.total), 0))}. Cuentan como venta cuando la orden no tiene boleta ni factura. Se emiten desde la orden.`}
          />
          {recibos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Todavía no hay recibos. Se emiten en cada orden: Dinero → Recibo de venta.</p>
          ) : (
            <ul className="flex flex-col">
              {recibos.map((r) => {
                const o = porId.get(r.orden_id);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-regla py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className={`text-[15px] font-medium ${r.estado === "anulado" ? "text-tinta-3 line-through" : ""}`}>
                        Recibo N° {r.numero}
                        <span className="num ml-2 font-normal">{formatearSoles(Number(r.total))}</span>
                      </p>
                      <p className="text-[13px] text-tinta-3">
                        {diaEnLima(new Date(r.emitido_en)).split("-").reverse().join("/")}
                        {o ? (
                          <>
                            {" · "}
                            <Link href={`/ordenes/${r.orden_id}`} className="underline-offset-2 hover:underline">
                              {numeroOrden(o.numero)} · {o.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}
                              {o.cliente ? ` · ${o.cliente}` : ""}
                            </Link>
                          </>
                        ) : null}
                        {r.estado === "anulado" ? ` · Anulado: ${r.motivo_anulacion}` : ""}
                      </p>
                    </div>
                    <EnlacePdf href={`/pdf/recibo/${r.id}`} texto="Recibo" />
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
      ) : null}
    </div>
  );
}
