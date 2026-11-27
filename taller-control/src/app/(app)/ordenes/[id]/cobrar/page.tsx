import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { FormCobro } from "@/components/caja/cobro";
import { EmitirRecibo } from "@/components/caja/controles";
import { Boton } from "@/components/ui/boton";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { estadoPago, MEDIOS, NOMBRE_ESTADO_PAGO, TIPO_PAGO_CORTO, type MedioPago } from "@/lib/dinero";
import { formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { nombresPersonal } from "@/lib/taller/consultas";
import { dineroDeOrden } from "@/lib/taller/dinero-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

export const metadata = { title: "Cobrar orden" };

const DOC: Record<string, string> = { dni: "DNI", ruc: "RUC", ce: "C.E." };
const COLOR_PAGO: Record<string, string> = {
  sin_precio: "bg-hundida text-tinta-2",
  pendiente: "bg-aviso-fondo text-aviso",
  parcial: "bg-aviso-fondo text-aviso",
  pagada: "bg-positivo-fondo text-positivo",
  a_favor: "bg-positivo-fondo text-positivo",
};
const hora = (f: string) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" }).format(new Date(f));

type LineaCobro = { descripcion: string; tipo: string; cantidad: number; precio: number; total: number };

function Lista({ titulo, items }: { titulo: string; items: LineaCobro[] }) {
  return items.length ? (
      <section className="flex flex-col gap-1">
        <h3 className="text-[13px] font-medium tracking-wide text-tinta-3 uppercase">{titulo}</h3>
        <ul className="flex flex-col">
          {items.map((i, k) => (
            <li key={k} className="flex items-baseline justify-between gap-3 border-b border-regla py-2 last:border-0">
              <span className="min-w-0">
                <span className="text-[15px]">{i.descripcion}</span>
                <span className="num block text-[13px] text-tinta-3">
                  {i.cantidad} × {formatearSoles(i.precio)}
                </span>
              </span>
              <span className="num shrink-0 text-[15px] font-medium">{formatearSoles(i.total)}</span>
            </li>
          ))}
        </ul>
      </section>
    ) : null;
}

/** Todo lo que el cajero necesita para cobrar una orden, sin volver a escribir importes. */
export default async function CobrarOrden({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { id } = await params;
  const supabase = await clienteServidor();
  const { data: o } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, estado, anulada, tecnico_id, entregado_en, vehiculos (placa, marca, modelo), clientes (nombre, celular, tipo_documento, numero_documento)")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!o) notFound();
  const v = Array.isArray(o.vehiculos) ? o.vehiculos[0] : o.vehiculos;
  const cl = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;

  const [d, nombres, { data: cotsAprobadas }, { data: pagosQuien }, { data: caja }] = await Promise.all([
    dineroDeOrden(ctx.taller.id, o.id, { verVentas: true, verUtilidad: false }, { tecnicoId: o.tecnico_id, entregadoEn: o.entregado_en }),
    nombresPersonal(ctx.taller.id),
    supabase.from("cotizaciones").select("id, descuento, descuento_motivo, total_lineas").eq("orden_id", o.id).eq("estado", "aprobada"),
    supabase.from("pagos").select("id, creado_por").eq("orden_id", o.id),
    supabase.from("cajas").select("id").eq("empresa_id", ctx.taller.id).eq("tipo_caja", "recepcion").eq("estado", "abierta").maybeSingle(),
  ]);
  const quien = new Map((pagosQuien ?? []).map((p) => [p.id, p.creado_por as string | null]));
  const aprobadas = d.cotizaciones.filter((c) => c.estado === "aprobada");
  const lineas = aprobadas.flatMap((c) => c.items);
  const servicios = lineas.filter((l) => l.tipo !== "repuesto");
  const repuestos = lineas.filter((l) => l.tipo === "repuesto");
  const descuento = (cotsAprobadas ?? []).reduce((a, c) => a + Number(c.descuento ?? 0), 0);
  const motivos = (cotsAprobadas ?? []).map((c) => c.descuento_motivo).filter(Boolean);
  const conComprobante = d.comprobantes.some((c) => c.estado === "confirmado");
  const estado = estadoPago(d);
  const reciboVigente = d.recibos.find((r) => r.estado !== "anulado");
  const pagosVigentes = d.pagos.filter((p) => p.estado !== "anulado");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={`/ordenes/${o.id}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Volver a la orden
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Placa placa={v?.placa ?? ""} />
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Cobrar {numeroOrden(o.numero)}</h1>
          <span className={cn("rounded-full px-3 py-1 text-[14px] font-medium", COLOR_PAGO[estado])}>{NOMBRE_ESTADO_PAGO[estado]}</span>
        </div>
        <p className="text-[15px] text-tinta-2">
          {cl?.nombre ?? "Sin cliente"}
          {cl?.numero_documento ? ` · ${DOC[cl.tipo_documento ?? ""] ?? "Doc."} ${cl.numero_documento}` : " · Sin DNI ni RUC"}
          {cl?.celular ? ` · ${formatearCelular(cl.celular)}` : ""}
          {v?.marca || v?.modelo ? ` · ${[v?.marca, v?.modelo].filter(Boolean).join(" ")}` : ""}
        </p>
      </header>

      {o.anulada ? <p className="rounded-2xl bg-negativo-fondo px-4 py-3 text-[15px] text-negativo">Esta orden está anulada: no se cobra.</p> : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          <Tarjeta aria-labelledby="t-detalle">
            <CabeceraTarjeta
              id="t-detalle"
              titulo="Detalle de la orden"
              detalle={conComprobante ? "Manda la boleta o factura registrada" : "De la cotización aprobada"}
              accion={
                !o.anulada && o.estado !== "entregado" ? (
                  <Boton asChild variante="secundario" tamano="chico">
                    <Link href={`/cotizaciones/nueva?orden=${o.id}`}>
                      <FilePlus2 />
                      {lineas.length ? "Agregar precios" : "Poner precios"}
                    </Link>
                  </Boton>
                ) : undefined
              }
            />
            {lineas.length === 0 ? (
              <p className="rounded-2xl bg-interna px-4 py-3 text-[15px] text-tinta-2">
                Esta orden aún no tiene precios aprobados. Pon los precios (servicios y repuestos) y márcalos como aprobados por el cliente; mientras tanto, lo que cobres queda como adelanto.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <Lista titulo="Servicios" items={servicios} />
                <Lista titulo="Repuestos" items={repuestos} />
                {descuento > 0 ? (
                  <p className="num flex justify-between gap-3 text-[15px] text-positivo">
                    <span>Descuento{motivos.length ? ` · ${motivos.join(", ")}` : ""}</span>
                    <span>−{formatearSoles(descuento)}</span>
                  </p>
                ) : null}
              </div>
            )}
            <dl className="num mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                ["Total", d.aCobrar, ""],
                ["Pagado", d.pagado, "text-positivo"],
                [d.saldo < -0.009 ? "A favor" : "Saldo", Math.abs(d.saldo), d.saldo > 0.009 ? "text-aviso" : "text-positivo"],
              ].map(([n, val, clase]) => (
                <div key={String(n)} className="flex items-baseline justify-between gap-3 rounded-2xl bg-interna px-4 py-2.5 sm:block sm:px-3 sm:py-3">
                  <dt className="text-[14px] text-tinta-2 sm:text-[13px]">{n}</dt>
                  <dd className={cn("text-[19px] font-semibold tracking-[-0.01em] sm:mt-0.5 sm:text-[20px]", String(clase))}>{formatearSoles(Number(val))}</dd>
                </div>
              ))}
            </dl>
          </Tarjeta>

          <Tarjeta aria-labelledby="t-pagos">
            <CabeceraTarjeta id="t-pagos" titulo="Pagos recibidos" detalle={`${pagosVigentes.length} ${pagosVigentes.length === 1 ? "pago" : "pagos"}`} accion={<EnlacePdf href={`/pdf/cuenta/${o.id}`} texto="Estado de cuenta" />} />
            {d.pagos.length === 0 ? (
              <p className="text-[15px] text-tinta-2">Todavía no hay pagos.</p>
            ) : (
              <ul className="flex flex-col">
                {d.pagos.map((p) => (
                  <li key={p.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-regla py-2.5 last:border-0", p.estado === "anulado" && "opacity-60")}>
                    <span className="min-w-0 flex-1">
                      <span className={cn("text-[15px] font-medium", p.estado === "anulado" && "line-through")}>
                        {MEDIOS[p.medio as MedioPago]} · {TIPO_PAGO_CORTO[p.tipo]}
                      </span>
                      <span className="num block text-[13px] text-tinta-3">
                        {hora(p.pagadoEn)} · {nombres.get(quien.get(p.id) ?? "") ?? "—"}
                        {p.operacion ? ` · Op. ${p.operacion}` : ""}
                        {p.estado === "anulado" ? " · anulado" : p.estado === "por_confirmar" ? " · por confirmar" : ""}
                      </span>
                    </span>
                    <span className={cn("num text-[16px] font-semibold", p.tipo === "devolucion" && "text-negativo")}>{formatearSoles(p.tipo === "devolucion" ? -p.monto : p.monto)}</span>
                    <EnlacePdf href={`/pdf/pago/${p.id}`} texto="Constancia" />
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          {!o.anulada && (d.saldo > 0.009 || d.aCobrar <= 0.009) ? (
            <Tarjeta aria-labelledby="t-cobrar">
              <CabeceraTarjeta id="t-cobrar" titulo="Registrar cobro" detalle="Uno o varios medios a la vez" />
              {!caja ? (
                <p className="mb-4 rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
                  La caja de Recepción está cerrada. El cobro se guarda en la orden, pero no entra al cuadre del día.{" "}
                  <Link href="/caja?area=recepcion" className="font-medium underline underline-offset-4">
                    Abrir caja
                  </Link>
                </p>
              ) : null}
              <FormCobro ordenId={o.id} saldo={Math.max(d.saldo, 0)} conPrecio={d.aCobrar > 0.009} />
            </Tarjeta>
          ) : null}

          <Tarjeta aria-labelledby="t-recibo">
            <CabeceraTarjeta id="t-recibo" titulo="Comprobante interno" detalle="Recibo del taller. No es boleta ni factura electrónica." />
            {reciboVigente ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="flex-1 text-[15px]">
                  Recibo N° {reciboVigente.numero} · <span className="num">{formatearSoles(reciboVigente.total)}</span>
                </p>
                <EnlacePdf href={`/pdf/recibo/${reciboVigente.id}`} texto="Ver o imprimir" boton />
              </div>
            ) : aprobadas.length ? (
              <div className="flex flex-col gap-3">
                <p className="text-[15px] text-tinta-2">Emítelo al cobrar: muestra servicios, repuestos, descuento, lo pagado, el saldo y los medios de pago.</p>
                <EmitirRecibo ordenId={o.id} total={formatearSoles(aprobadas.reduce((a, c) => a + c.total, 0))} />
              </div>
            ) : (
              <p className="text-[15px] text-tinta-2">Se emite cuando la orden tenga precios aprobados.</p>
            )}
            <p className="mt-3 text-[13px] text-tinta-3">La boleta o factura electrónica se emite en el sistema de la SUNAT y luego se registra en la orden.</p>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
