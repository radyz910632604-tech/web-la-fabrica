import Link from "next/link";
import { PackagePlus } from "lucide-react";
import { anularPago } from "@/app/(app)/cobros/acciones";
import { anularComprobante } from "@/app/(app)/ventas/acciones";
import { RegistrarComprobante } from "@/app/(app)/ventas/formulario";
import { Anular, RegistrarPago } from "@/components/caja/controles";
import { NuevaCotizacion, RespuestaCotizacion } from "@/components/caja/cotizaciones";
import { Boton } from "@/components/ui/boton";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import type { DineroOrden } from "@/lib/taller/dinero-consultas";
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

/** Cotizaciones, comprobantes, pagos y saldo de una orden (gerencia, administración y asesor). */
export function TarjetaDinero({
  d,
  ordenId,
  etiqueta,
  entregada,
  servicios,
  hoy,
}: {
  d: DineroOrden;
  ordenId: string;
  etiqueta: string;
  entregada: boolean;
  servicios: string[];
  hoy: string;
}) {
  const ahora = new Date();
  const opcion = [{ id: ordenId, etiqueta, saldo: d.saldo, entregada }];
  return (
    <Tarjeta aria-labelledby="t-dinero">
      <CabeceraTarjeta id="t-dinero" titulo="Dinero" detalle="Cotización, comprobante y pagos" />
      <dl className="num grid grid-cols-3 gap-2">
        {[
          ["A cobrar", d.aCobrar, ""],
          ["Pagado", d.pagado, ""],
          [d.saldo < -0.009 ? "A favor" : "Saldo", Math.abs(d.saldo), d.saldo > 0.009 ? (entregada ? "text-negativo" : "") : "text-positivo"],
        ].map(([n, v, clase]) => (
          <div key={String(n)} className="min-w-0 rounded-2xl bg-interna px-3 py-3">
            <dt className="text-[13px] text-tinta-2">{n}</dt>
            <dd className={cn("mt-0.5 truncate text-[17px] font-semibold tracking-[-0.01em]", String(clase))}>{formatearSoles(Number(v))}</dd>
          </div>
        ))}
      </dl>
      {d.aCobrar === 0 ? <p className="mt-2 text-sm text-tinta-3">El monto a cobrar sale del comprobante o, si aún no hay, de la cotización aprobada.</p> : null}

      <div className="mt-4 flex flex-col gap-4">
        <Seccion titulo="Cotizaciones" accion={!entregada ? <NuevaCotizacion ordenId={ordenId} servicios={servicios} hayAprobada={d.cotizaciones.some((c) => c.estado === "aprobada")} /> : undefined}>
          {d.cotizaciones.length === 0 ? (
            <p className="text-sm text-tinta-2">Sin cotización todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d.cotizaciones.map((c) => (
                <li key={c.id} className="rounded-2xl bg-interna px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium">Versión {c.version}</span>
                    {c.adicional ? <span className="rounded-full bg-tarjeta px-2.5 py-0.5 text-[12px] text-tinta-2">Adicional</span> : null}
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px]", ESTADO_COT[c.estado]?.clase)}>
                      {ESTADO_COT[c.estado]?.texto}
                      {c.estado === "aprobada" && c.medio ? ` ${MEDIO_APROBACION[c.medio]}` : ""}
                    </span>
                    <span className="num ml-auto text-[15px] font-semibold">{formatearSoles(c.total)}</span>
                  </div>
                  <details className="mt-1 text-sm text-tinta-2">
                    <summary className="cursor-pointer text-[13px] text-tinta-3">
                      {c.items.length} {c.items.length === 1 ? "línea" : "líneas"}
                    </summary>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {c.items.map((i, k) => (
                        <li key={k} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            {i.cantidad !== 1 ? `${i.cantidad} × ` : ""}
                            {i.descripcion}
                            <span className="text-tinta-3"> · {i.tipo}</span>
                          </span>
                          <span className="num shrink-0">{formatearSoles(i.total)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="mt-2">
                    <RespuestaCotizacion id={c.id} ordenId={ordenId} estado={c.estado} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Seccion>

        <Seccion titulo="Comprobantes" accion={<RegistrarComprobante ordenes={[]} hoy={hoy} ordenFija={ordenId} variante="secundario" tamano="chico" />}>
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
                  {c.estado !== "anulado" ? <Anular id={c.id} accion={anularComprobante} que="comprobante" /> : null}
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
                    {p.tipo === "adelanto" ? "Adelanto" : "Saldo"} · {MEDIOS[p.medio as MedioPago]}
                    <span className="text-[13px] text-tinta-3"> · {formatearMomento(new Date(p.pagadoEn), ahora)}</span>
                  </p>
                  <span className="num text-[15px]">{formatearSoles(p.monto)}</span>
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
export function TarjetaRepuestos({ d, ordenId, registra }: { d: Pick<DineroOrden, "repuestos" | "comprasSinIgv">; ordenId: string; registra: boolean }) {
  return (
    <Tarjeta aria-labelledby="t-repuestos">
      <CabeceraTarjeta
        id="t-repuestos"
        titulo="Repuestos comprados"
        detalle={d.repuestos.length ? `${formatearSoles(d.comprasSinIgv)} sin IGV` : undefined}
        accion={
          registra ? (
            <Boton asChild variante="secundario" tamano="chico">
              <Link href={`/compras/nueva?orden=${ordenId}`}>
                <PackagePlus />
                Compra
              </Link>
            </Boton>
          ) : undefined
        }
      />
      {d.repuestos.length === 0 ? (
        <p className="text-sm text-tinta-2">No hay compras asignadas a esta orden.</p>
      ) : (
        <ul className="flex flex-col">
          {d.repuestos.map((r, i) => (
            <li key={i} className="flex justify-between gap-3 border-t border-regla py-2 text-[15px] first:border-t-0">
              <span className="min-w-0">
                {r.cantidad !== 1 ? `${r.cantidad} × ` : ""}
                {r.descripcion}
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
