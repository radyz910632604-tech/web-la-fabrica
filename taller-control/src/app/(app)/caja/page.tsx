import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { Anular, RegistrarPago } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { Boton } from "@/components/ui/boton";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { diaEnLima, formatearMomento, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { cajaAbierta, detalleCaja, historialCajas, pagosSinCaja } from "@/lib/taller/caja-consultas";
import { limitesDiaLima, listarOrdenes, nombresPersonal } from "@/lib/taller/consultas";
import { cuentasDeOrdenes } from "@/lib/taller/dinero-consultas";
import { etiquetaOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";
import { anularMovimiento } from "./acciones";
import { AbrirCaja, CerrarCaja, Movimiento } from "./controles";

export const metadata = { title: "Caja del día" };

const hora = (iso: string) => new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(iso));

export default async function CajaDelDia() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const ahora = new Date();
  const [abierta, historial, nombres] = await Promise.all([cajaAbierta(ctx.taller.id), historialCajas(ctx.taller.id, 8), nombresPersonal(ctx.taller.id)]);
  const quien = (id: string | null) => nombres.get(id ?? "") ?? "alguien del taller";

  const historialTarjeta = (
    <Tarjeta aria-labelledby="t-historial-caja">
      <CabeceraTarjeta id="t-historial-caja" titulo="Cajas cerradas" detalle="Últimos cierres con su arqueo" />
      {historial.length === 0 ? (
        <p className="text-sm text-tinta-2">Todavía no hay cierres.</p>
      ) : (
        <ul className="flex flex-col">
          {historial.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 border-t border-regla py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium">{formatearMomento(new Date(c.abiertaEn), ahora)} → {c.cerradaEn ? hora(c.cerradaEn) : ""}</p>
                <p className="num text-[13px] text-tinta-3">
                  Esperado {formatearSoles(c.esperado ?? 0)} · contado {formatearSoles(c.contado ?? 0)} · cerró {quien(c.cerradaPor)}
                </p>
              </div>
              <span className={cn("num rounded-full px-2.5 py-1 text-[13px] font-medium", !c.diferencia ? "bg-positivo-fondo text-positivo" : c.diferencia > 0 ? "bg-aviso-fondo text-aviso" : "bg-negativo-fondo text-negativo")}>
                {!c.diferencia ? "Cuadró" : c.diferencia > 0 ? `Sobró ${formatearSoles(c.diferencia)}` : `Faltó ${formatearSoles(-c.diferencia)}`}
              </span>
              <Boton asChild variante="fantasma" tamano="chico">
                <a href={`/pdf/caja/${c.id}`} target="_blank" rel="noreferrer">
                  <FileDown />
                  PDF
                </a>
              </Boton>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );

  if (!abierta) {
    const sinCaja = await pagosSinCaja(ctx.taller.id, limitesDiaLima(diaEnLima(ahora)).desde);
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <TituloCaja titulo="Caja del día" detalle="La caja está cerrada. Ábrela al empezar el día: cada pago que registres entrará a ella." />
        <SubnavCaja actual="/caja" roles={ctx.roles} />
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12 [&>*]:min-w-0">
          <Tarjeta aria-labelledby="t-abrir" className="xl:col-span-5">
            <CabeceraTarjeta id="t-abrir" titulo="Abrir caja" />
            {sinCaja ? (
              <p className="mb-4 rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
                Hoy se registraron {sinCaja} {sinCaja === 1 ? "pago" : "pagos"} sin caja abierta: no entran en ningún arqueo.
              </p>
            ) : null}
            <AbrirCaja />
          </Tarjeta>
          <div className="xl:col-span-7">{historialTarjeta}</div>
        </div>
      </div>
    );
  }

  const [d, ordenes] = await Promise.all([detalleCaja(ctx.taller.id, abierta.id), listarOrdenes(ctx.taller.id, { limite: 300, orden: "reciente" })]);
  if (!d) notFound();
  const cuentas = await cuentasDeOrdenes(ctx.taller.id, ordenes.map((o) => ({ id: o.id, numero: o.numero, placa: o.placa, cliente: o.cliente, estado: o.estado })));
  const opciones = cuentas
    .filter((c) => c.estado !== "entregado" || Math.abs(c.saldo) > 0.009)
    .map((c) => ({ id: c.id, etiqueta: `${etiquetaOrden(c)}${c.saldo > 0.009 ? ` · debe S/ ${c.saldo.toFixed(2)}` : c.saldo < -0.009 ? ` · a favor S/ ${(-c.saldo).toFixed(2)}` : ""}`, saldo: c.saldo, entregada: c.estado === "entregado" }));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Caja del día"
        detalle={`Abierta por ${quien(abierta.abiertaPor)} ${formatearMomento(new Date(abierta.abiertaEn), ahora).toLowerCase()} con ${formatearSoles(abierta.montoInicial)} de sencillo.`}
        accion={
          <div className="flex flex-wrap gap-2">
            <RegistrarPago ordenes={opciones} />
            <Movimiento caja={abierta.id} />
            <CerrarCaja caja={abierta.id} esperado={d.efectivo.esperado} />
          </div>
        }
      />
      <SubnavCaja actual="/caja" roles={ctx.roles} />

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12 [&>*]:min-w-0">
        <Tarjeta aria-labelledby="t-efectivo" className="xl:col-span-4">
          <CabeceraTarjeta id="t-efectivo" titulo="Efectivo en caja" detalle="Lo que debería haber ahora" />
          <p className="num text-[34px] leading-none font-semibold tracking-[-0.03em]">{formatearSoles(d.efectivo.esperado)}</p>
          <dl className="num mt-4 flex flex-col text-[15px]">
            {[
              ["Sencillo inicial", abierta.montoInicial],
              ["Cobros en efectivo", d.efectivo.cobros],
              ["Otros ingresos", d.efectivo.ingresos],
              ["Gastos y retiros", -d.efectivo.egresos],
            ].map(([t, v]) => (
              <div key={String(t)} className="flex justify-between border-t border-regla py-2 first:border-t-0">
                <dt className="text-tinta-2">{t}</dt>
                <dd>{formatearSoles(Number(v))}</dd>
              </div>
            ))}
          </dl>
        </Tarjeta>
        <Tarjeta aria-labelledby="t-medios" className="xl:col-span-3">
          <CabeceraTarjeta id="t-medios" titulo="Cobrado hoy" detalle="Por medio de pago" />
          <dl className="num flex flex-col text-[15px]">
            {(Object.keys(MEDIOS) as MedioPago[]).map((m) => (
              <div key={m} className={cn("flex justify-between border-t border-regla py-2 first:border-t-0", d.porMedio[m] === 0 && "text-tinta-3")}>
                <dt>{MEDIOS[m]}</dt>
                <dd>{formatearSoles(d.porMedio[m])}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-regla pt-2.5 text-[17px] font-semibold">
              <dt>Total</dt>
              <dd>{formatearSoles(d.totalCobrado)}</dd>
            </div>
          </dl>
        </Tarjeta>
        <Tarjeta aria-labelledby="t-movs" className="md:col-span-2 xl:col-span-5">
          <CabeceraTarjeta id="t-movs" titulo="Movimientos" detalle={`${d.movimientos.length} en esta caja`} accion={<EnlacePdf href={`/pdf/caja/${abierta.id}`} />} />
          {d.movimientos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Todavía no hay movimientos. Los pagos que registres aparecen aquí.</p>
          ) : (
            <ul className="flex flex-col">
              {d.movimientos.map((m) => {
                const anulado = m.estado === "anulado";
                return (
                  <li key={`${m.clase}-${m.id}`} className="flex items-center gap-3 border-t border-regla py-2.5 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-[15px]", anulado && "text-tinta-3 line-through")}>
                        {m.ordenId ? (
                          <Link href={`/ordenes/${m.ordenId}`} className="underline-offset-4 hover:underline">
                            {m.concepto}
                          </Link>
                        ) : (
                          m.concepto
                        )}
                      </p>
                      <p className="text-[13px] text-tinta-3">
                        {hora(m.momento)} · {MEDIOS[m.medio]}
                        {anulado ? ` · Anulado: ${m.motivoAnulacion}` : ""}
                      </p>
                    </div>
                    <span className={cn("num text-[15px] font-medium", m.efecto < 0 && "text-negativo", anulado && "text-tinta-3")}>
                      {m.efecto < 0 ? "−" : "+"}
                      {formatearSoles(Math.abs(m.efecto))}
                    </span>
                    {m.clase === "movimiento" && !anulado ? <Anular id={m.id} accion={anularMovimiento} que="movimiento" /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
      </div>
      {historialTarjeta}
    </div>
  );
}
