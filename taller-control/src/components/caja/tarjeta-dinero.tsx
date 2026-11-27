import Link from "next/link";
import { FilePlus2, PackagePlus, Pencil } from "lucide-react";
import { anularPago } from "@/app/(app)/cobros/acciones";
import { anularComprobante, anularRecibo } from "@/app/(app)/ventas/acciones";
import { RegistrarComprobante } from "@/app/(app)/ventas/formulario";
import { Anular, EmitirRecibo, RegistrarPago } from "@/components/caja/controles";
import { RespuestaCotizacion } from "@/components/caja/cotizaciones";
import { Boton } from "@/components/ui/boton";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, MOTIVOS_NOTA, TIPO_PAGO_CORTO, type MedioPago } from "@/lib/dinero";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import type { DineroOrden } from "@/lib/taller/dinero-consultas";
import { estadoIa } from "@/lib/ia/proveedor";
import { cn } from "@/lib/utils";

const ESTADO_COT: Record<string, { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "bg-hundida text-tinta-2" },
  enviada: { texto: "Enviada", clase: "bg-aviso-fondo text-aviso" },
  aprobada: { texto: "Aprobada", clase: "bg-positivo-fondo text-positivo" },
  rechazada: { texto: "Rechazada", clase: "bg-negativo-fondo text-negativo" },
  anulada: { texto: "Anulada", clase: "bg-hundida text-tinta-3" },
};
const MEDIO_APROBACION: Record<string, string> = { whatsapp: "por WhatsApp", presencial: "en persona", llamada: "por llamada" };

function Seccion({ titulo, accion, children }: { titulo: string; accion?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-regla pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">{titulo}</h3>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Cotizaciones, comprobantes, pagos y saldo de una orden (gerencia, administración, asesor y recepción). */
export function TarjetaDinero({
  d,
  ordenId,
  etiqueta,
  entregada,
  hoy,
  puedeCotizar = true,
}: {
  puedeCotizar?: boolean;
  d: DineroOrden;
  ordenId: string;
  etiqueta: string;
  entregada: boolean;
  servicios?: string[];
  hoy: string;
}) {
  const ahora = new Date();
  const opcion = [{ id: ordenId, etiqueta, saldo: d.saldo, entregada }];
  // Con recibo, boleta o factura vigente, los precios ya no se cambian (primero se anula).
  const documentada = d.recibos.some((r) => r.estado !== "anulado") || d.comprobantes.some((c) => c.estado === "confirmado");
  return (
    <Tarjeta aria-labelledby="t-dinero">
      <CabeceraTarjeta id="t-dinero" titulo="Dinero" detalle="Cotización, comprobante y pagos" accion={<EnlacePdf href={`/pdf/cuenta/${ordenId}`} texto="Estado de cuenta" />} />
      <dl className="num grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          ["A cobrar", d.aCobrar, ""],
          ["Pagado", d.pagado, ""],
          [d.saldo < -0.009 ? "A favor" : "Saldo", Math.abs(d.saldo), d.saldo > 0.009 ? (entregada ? "text-negativo" : "") : "text-positivo"],
        ].map(([n, v, clase]) => (
          <div key={String(n)} className="flex min-w-0 items-baseline justify-between gap-3 rounded-2xl bg-interna px-4 py-2.5 sm:block sm:px-3 sm:py-3">
            <dt className="text-[13px] text-tinta-2">{n}</dt>
            <dd className={cn("text-[17px] font-semibold tracking-[-0.01em] sm:mt-0.5 sm:truncate", String(clase))}>{formatearSoles(Number(v))}</dd>
          </div>
        ))}
      </dl>
      {d.aCobrar === 0 ? <p className="mt-2 text-sm text-tinta-3">El monto a cobrar sale del comprobante o, si aún no hay, de la cotización aprobada.</p> : null}

      <div className="mt-4 flex flex-col gap-4">
        <Seccion titulo="Cotizaciones" accion={
            !entregada && puedeCotizar ? (
              <Boton asChild variante="secundario" tamano="chico">
                <Link href={`/cotizaciones/nueva?orden=${ordenId}`}>
                  <FilePlus2 />
                  Nueva cotización
                </Link>
              </Boton>
            ) : undefined
          }
        >
          {d.cotizaciones.length === 0 ? (
            <p className="text-sm text-tinta-2">Sin cotización todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d.cotizaciones.map((c) => (
                <li key={c.id} className={cn("rounded-2xl bg-interna px-4 py-3", c.estado === "anulada" && "opacity-70")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium">Versión {c.version}</span>
                    {c.adicional ? <span className="rounded-full bg-tarjeta px-2.5 py-0.5 text-[12px] text-tinta-2">Adicional</span> : null}
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px]", ESTADO_COT[c.estado]?.clase)}>
                      {ESTADO_COT[c.estado]?.texto}
                      {c.estado === "aprobada" && c.medio ? ` ${MEDIO_APROBACION[c.medio]}` : ""}
                    </span>
                    <span className={cn("num ml-auto text-[15px] font-semibold", c.estado === "anulada" && "text-tinta-3 line-through")}>{formatearSoles(c.total)}</span>
                  </div>
                  {c.nota && (c.nota.startsWith("Editada") || c.nota.startsWith("Reemplazada")) ? <p className="mt-0.5 text-[13px] text-tinta-3">{c.nota}</p> : null}
                  <details className="mt-1 text-sm text-tinta-2" open={c.estado !== "anulada" && c.estado !== "rechazada"}>
                    <summary className="cursor-pointer text-[13px] text-tinta-3">
                      {c.items.length} {c.items.length === 1 ? "línea" : "líneas"} · {c.conIgv ? "precios con IGV" : "sin IGV"}
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1">
                      {c.items.map((i, k) => (
                        <li key={k} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            <span className="text-tinta">{i.descripcion}</span>
                            <span className="num block text-[13px] text-tinta-3">
                              {i.tipo === "repuesto" ? "Repuesto" : "Servicio"} · {i.cantidad} × {formatearSoles(i.precio)}
                            </span>
                          </span>
                          <span className="num shrink-0 text-tinta">{formatearSoles(i.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <EnlacePdf href={`/pdf/cotizacion/${c.id}?igv=con`} texto="PDF con IGV" />
                    <EnlacePdf href={`/pdf/cotizacion/${c.id}?igv=sin`} texto="PDF sin IGV" />
                    {puedeCotizar && !entregada && !documentada && c.estado !== "anulada" && c.estado !== "rechazada" ? (
                      <Boton asChild variante="fantasma" tamano="chico">
                        <Link href={`/cotizaciones/${c.id}/editar`}>
                          <Pencil />
                          Editar
                        </Link>
                      </Boton>
                    ) : null}
                  </div>
                  {puedeCotizar ? (
                    <div className="mt-2">
                      <RespuestaCotizacion id={c.id} ordenId={ordenId} estado={c.estado} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Seccion>

        <Seccion
          titulo="Recibo de venta"
          accion={
            !d.recibos.some((r) => r.estado !== "anulado") && d.cotizaciones.some((c) => c.estado === "aprobada") ? (
              <EmitirRecibo ordenId={ordenId} total={formatearSoles(d.cotizaciones.filter((c) => c.estado === "aprobada").reduce((a, c) => a + c.total, 0))} />
            ) : undefined
          }
        >
          {d.recibos.length === 0 ? (
            <p className="text-sm text-tinta-2">{d.cotizaciones.some((c) => c.estado === "aprobada") ? "Al cobrar, emite el recibo para el cliente." : "Se emite cuando haya una cotización aprobada."}</p>
          ) : (
            <ul className="flex flex-col">
              {d.recibos.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-1.5">
                  <p className={cn("min-w-0 flex-1 text-[15px]", r.estado === "anulado" && "text-tinta-3 line-through")}>
                    Recibo N° {r.numero}
                    <span className="text-[13px] text-tinta-3"> · {formatearMomento(new Date(r.emitidoEn), ahora)}</span>
                  </p>
                  <span className="num text-[15px]">{formatearSoles(r.total)}</span>
                  <EnlacePdf href={`/pdf/recibo/${r.id}`} texto="Recibo" />
                  {r.estado !== "anulado" ? <Anular id={r.id} accion={anularRecibo} que="recibo" /> : null}
                </li>
              ))}
            </ul>
          )}
        </Seccion>

        <Seccion titulo="Comprobantes" accion={<RegistrarComprobante ordenes={[]} hoy={hoy} ordenFija={ordenId} variante="secundario" tamano="chico" ia={estadoIa().lectura} />}>
          {d.comprobantes.length === 0 ? (
            <p className="text-sm text-tinta-2">Sin boleta ni factura registrada.</p>
          ) : (
            <ul className="flex flex-col">
              {d.comprobantes.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-1.5">
                  <p className={cn("min-w-0 flex-1 text-[15px]", c.estado === "anulado" && "text-tinta-3 line-through")}>
                    {c.tipo === "boleta" ? "Boleta" : "Factura"} {c.serie}-{c.numero}
                    <span className="text-[13px] text-tinta-3"> · {c.fecha.split("-").reverse().join("/")}</span>
                  </p>
                  <span className="num text-[15px]">{formatearSoles(c.total)}</span>
                  <EnlacePdf href={`/pdf/comprobante/${c.id}`} />
                  {c.estado !== "anulado" ? <Anular id={c.id} accion={anularComprobante} que="comprobante" /> : null}
                </li>
              ))}
              {d.notas.map((x) => (
                <li key={x.id} className="flex items-center gap-3 py-1.5">
                  <p className={cn("min-w-0 flex-1 text-[15px]", x.estado === "anulado" && "text-tinta-3 line-through")}>
                    Nota de crédito {x.serie}-{x.numero}
                    <span className="text-[13px] text-tinta-3"> · {MOTIVOS_NOTA[x.motivoCodigo]}</span>
                  </p>
                  <span className="num text-[15px] text-negativo">−{formatearSoles(x.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>

        <Seccion titulo="Pagos" accion={<RegistrarPago ordenes={opcion} ordenFija={ordenId} variante="secundario" tamano="chico" />}>
          {d.pagos.length === 0 ? (
            <p className="text-sm text-tinta-2">Sin pagos todavía.</p>
          ) : (
            <ul className="flex flex-col">
              {d.pagos.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-1.5">
                  <p className={cn("min-w-0 flex-1 text-[15px]", p.estado === "anulado" && "text-tinta-3 line-through")}>
                    {TIPO_PAGO_CORTO[p.tipo]} · {MEDIOS[p.medio as MedioPago]}
                    <span className="text-[13px] text-tinta-3"> · {formatearMomento(new Date(p.pagadoEn), ahora)}</span>
                  </p>
                  <span className={cn("num text-[15px]", p.tipo === "devolucion" && "text-negativo")}>{formatearSoles(p.tipo === "devolucion" ? -p.monto : p.monto)}</span>
                  <EnlacePdf href={`/pdf/pago/${p.id}`} texto="Constancia" />
                  {p.estado !== "anulado" ? <Anular id={p.id} accion={anularPago} que="pago" /> : null}
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>
    </Tarjeta>
  );
}

/** Repuestos comprados para la orden (gestores y almacén). */
export function TarjetaRepuestos({ d, ordenId, registra, delInventario }: { d: Pick<DineroOrden, "repuestos" | "comprasSinIgv">; ordenId: string; registra: boolean; delInventario?: React.ReactNode }) {
  return (
    <Tarjeta aria-labelledby="t-repuestos">
      <CabeceraTarjeta
        id="t-repuestos"
        titulo="Repuestos"
        detalle={d.repuestos.length ? `${formatearSoles(d.comprasSinIgv)} de costo, sin IGV` : undefined}
        accion={
          registra ? (
            <div className="flex flex-wrap justify-end gap-2">
              {delInventario}
              <Boton asChild variante="secundario" tamano="chico">
                <Link href={`/compras/nueva?orden=${ordenId}`}>
                  <PackagePlus />
                  Compra
                </Link>
              </Boton>
            </div>
          ) : undefined
        }
      />
      {d.repuestos.length === 0 ? (
        <p className="text-sm text-tinta-2">Todavía no hay repuestos comprados ni sacados del inventario para esta orden.</p>
      ) : (
        <ul className="flex flex-col">
          {d.repuestos.map((r, i) => (
            <li key={i} className="flex justify-between gap-3 border-t border-regla py-2 text-[15px] first:border-t-0">
              <span className="min-w-0">
                {r.cantidad !== 1 ? `${r.cantidad} × ` : ""}
                {r.descripcion}
                {r.deInventario ? <span className="ml-2 text-[13px] text-tinta-3">del inventario</span> : null}
              </span>
              <span className="num shrink-0 text-tinta-2">{formatearSoles(r.sinIgv)}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

/** Utilidad y margen de la orden (solo gerencia). Todo sin IGV. */
export function TarjetaUtilidad({ d, margenMinimo }: { d: DineroOrden; margenMinimo: number }) {
  if (d.utilidad === null) return null;
  const bajo = d.margen !== null && d.margen * 100 < margenMinimo;
  return (
    <Tarjeta aria-labelledby="t-utilidad">
      <CabeceraTarjeta id="t-utilidad" titulo="Utilidad" detalle="Sin IGV · solo la ve gerencia" />
      <dl className="num flex flex-col gap-1.5 text-[15px]">
        {[
          ["Venta", d.ventaSinIgv],
          ["Repuestos", -d.comprasSinIgv],
          ["Mano de obra", -(d.manoObra ?? 0)],
        ].map(([n, v]) => (
          <div key={String(n)} className="flex justify-between">
            <dt className="text-tinta-2">{n}</dt>
            <dd>{formatearSoles(Number(v))}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t border-regla pt-2">
          <dt className="font-semibold">Utilidad</dt>
          <dd className={cn("text-xl font-semibold tracking-[-0.01em]", d.utilidad < 0 && "text-negativo")}>{formatearSoles(d.utilidad)}</dd>
        </div>
        <div className="flex justify-between text-sm">
          <dt className="text-tinta-2">Margen</dt>
          <dd className={cn(bajo && "font-medium text-negativo")}>
            {d.margen === null ? "Sin venta registrada" : `${(d.margen * 100).toFixed(1)} %`}
            {bajo ? ` (mínimo ${margenMinimo} %)` : ""}
          </dd>
        </div>
      </dl>
    </Tarjeta>
  );
}
