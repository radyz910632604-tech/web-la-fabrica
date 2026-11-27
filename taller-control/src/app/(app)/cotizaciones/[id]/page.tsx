import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { RespuestaCotizacion } from "@/components/caja/cotizaciones";
import { Placa } from "@/components/marca/placa";
import { Boton } from "@/components/ui/boton";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { Estado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { listarOrdenes } from "@/lib/taller/consultas";
import { detalleCotizacion, ESTADO_COTIZACION } from "@/lib/taller/cotizaciones-consultas";
import { ESTADOS_ABIERTOS, etiquetaOrden, numeroOrden } from "@/lib/taller/estados";
import { PasarAOrden } from "./controles";

export const metadata = { title: "Cotización" };

export default async function Cotizacion({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { id } = await params;
  const c = await detalleCotizacion(ctx.taller.id, id);
  if (!c) notFound();
  const editable = c.estado !== "anulada" && c.estado !== "rechazada" && !c.bloqueada;
  const abiertas = !c.ordenId && c.estado !== "anulada" ? await listarOrdenes(ctx.taller.id, { estados: [...ESTADOS_ABIERTOS], orden: "reciente", limite: 200 }) : [];
  const numero = `N° ${String(c.numero ?? 0).padStart(6, "0")}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href="/cotizaciones" className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Cotizaciones
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Cotización {numero}</h1>
          <Estado color={ESTADO_COTIZACION[c.estado]?.color ?? "gris"} texto={ESTADO_COTIZACION[c.estado]?.texto ?? c.estado} className="text-[15px]" />
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <Boton asChild>
              <Link href={`/cotizaciones/${c.id}/editar`}>
                <Pencil />
                Editar
              </Link>
            </Boton>
          ) : null}
          <EnlacePdf href={`/pdf/cotizacion/${c.id}?igv=con`} texto="PDF con IGV" boton />
          <EnlacePdf href={`/pdf/cotizacion/${c.id}?igv=sin`} texto="PDF sin IGV" boton />
        </div>
        {c.bloqueada ? <p className="text-sm text-tinta-2">La orden ya tiene recibo, boleta o factura: para cambiar precios, primero se anula ese documento.</p> : null}
        {c.nota && /^(Editada|Reemplazada)/.test(c.nota) ? <p className="text-sm text-tinta-3">{c.nota}</p> : null}
      </header>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          <Tarjeta aria-labelledby="t-cliente">
            <CabeceraTarjeta id="t-cliente" titulo="Cliente" detalle={c.ordenNumero ? `De la orden ${numeroOrden(c.ordenNumero)}` : "Sin orden todavía"} />
            <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-2">
              <div>
                <dt className="text-[13px] text-tinta-2">Nombre</dt>
                <dd className="font-medium">{c.cliente}</dd>
              </div>
              {c.placa ? (
                <div>
                  <dt className="text-[13px] text-tinta-2">Placa</dt>
                  <dd>
                    <Placa placa={c.placa} />
                  </dd>
                </div>
              ) : null}
              {c.celular ? (
                <div>
                  <dt className="text-[13px] text-tinta-2">Celular</dt>
                  <dd className="num">{formatearCelular(c.celular)}</dd>
                </div>
              ) : null}
              {c.vehiculo ? (
                <div>
                  <dt className="text-[13px] text-tinta-2">Carro</dt>
                  <dd>{c.vehiculo}</dd>
                </div>
              ) : null}
            </dl>
            {c.ordenId ? (
              <Link href={`/ordenes/${c.ordenId}`} className="mt-3 inline-block text-sm font-medium underline-offset-4 hover:underline">
                Ver la orden
              </Link>
            ) : c.estado !== "anulada" ? (
              <PasarAOrden cotizacionId={c.id} ordenes={abiertas.map((o) => ({ id: o.id, etiqueta: etiquetaOrden({ numero: o.numero, placa: o.placa, cliente: o.cliente }) }))} />
            ) : null}
          </Tarjeta>
          <Tarjeta aria-labelledby="t-lineas">
            <CabeceraTarjeta id="t-lineas" titulo="Productos y servicios" detalle={c.conIgv ? "Precios con IGV" : "Sin IGV"} />
            <ul className="flex flex-col">
              {c.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3 border-t border-regla py-2.5 first:border-t-0">
                  <span className="min-w-0">
                    <span className="block text-[15px]">{i.descripcion}</span>
                    <span className="num block text-[13px] text-tinta-3">
                      {i.tipo === "repuesto" ? "Producto" : "Servicio"} · {i.cantidad} × {formatearSoles(i.precio)}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[15px]">{formatearSoles(i.total)}</span>
                </li>
              ))}
            </ul>
          </Tarjeta>
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <Tarjeta aria-labelledby="t-total">
            <CabeceraTarjeta id="t-total" titulo="Total" />
            <dl className="num flex flex-col gap-1 text-[15px]">
              <div className="flex justify-between text-tinta-2">
                <dt>Subtotal</dt>
                <dd>{formatearSoles(c.totalLineas)}</dd>
              </div>
              {c.descuento ? (
                <div className="flex justify-between text-positivo">
                  <dt>
                    Descuento{c.descuentoTipo === "porcentaje" ? ` ${c.descuentoValor} %` : ""}
                    {c.descuentoMotivo ? <span className="block text-[12px] text-tinta-3">{c.descuentoMotivo}</span> : null}
                  </dt>
                  <dd>−{formatearSoles(c.descuento)}</dd>
                </div>
              ) : null}
              {c.conIgv ? (
                <>
                  <div className="flex justify-between text-tinta-2">
                    <dt>Sin IGV</dt>
                    <dd>{formatearSoles(c.sinIgv)}</dd>
                  </div>
                  <div className="flex justify-between text-tinta-2">
                    <dt>IGV 18 %</dt>
                    <dd>{formatearSoles(c.igv)}</dd>
                  </div>
                </>
              ) : null}
              <div className="mt-1 flex justify-between border-t border-regla pt-2 text-[22px] font-semibold tracking-[-0.02em]">
                <dt>Total</dt>
                <dd>{formatearSoles(c.total)}</dd>
              </div>
            </dl>
          </Tarjeta>
          {c.estado === "borrador" || c.estado === "enviada" ? (
            <Tarjeta aria-labelledby="t-respuesta">
              <CabeceraTarjeta id="t-respuesta" titulo="Respuesta del cliente" />
              <RespuestaCotizacion id={c.id} ordenId={c.ordenId} estado={c.estado} />
            </Tarjeta>
          ) : null}
        </div>
      </div>
    </div>
  );
}
