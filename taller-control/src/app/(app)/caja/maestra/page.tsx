import Link from "next/link";
import { notFound } from "next/navigation";
import { AlarmClock, ChevronLeft, ChevronRight } from "lucide-react";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { cajaMaestra, diasConMaestra, NOMBRE_AREA, type CajaDelDia } from "@/lib/taller/caja-consultas";
import { nombresPersonal } from "@/lib/taller/consultas";
import { cn } from "@/lib/utils";
import { RegistrarArqueo } from "../controles";

export const metadata = { title: "Caja Maestra" };

const hora = (iso: string) => new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" }).format(new Date(iso));
const diaLargo = (fecha: string) => {
  const t = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${fecha}T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function Diferencia({ valor }: { valor: number | null }) {
  if (valor == null) return <span className="rounded-full bg-aviso-fondo px-2.5 py-1 text-[13px] font-medium text-aviso">Falta contar</span>;
  return (
    <span className={cn("num rounded-full px-2.5 py-1 text-[13px] font-medium", valor === 0 ? "bg-positivo-fondo text-positivo" : valor > 0 ? "bg-aviso-fondo text-aviso" : "bg-negativo-fondo text-negativo")}>
      {valor === 0 ? "Cuadró" : valor > 0 ? `Sobró ${formatearSoles(valor)}` : `Faltó ${formatearSoles(-valor)}`}
    </span>
  );
}

export default async function CajaMaestra({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const ctx = await obtenerContexto();
  // Solo el dueño y administración: la base tampoco deja leerla a nadie más.
  if (!esGestor(ctx.roles)) notFound();
  const [dias, nombres] = await Promise.all([diasConMaestra(ctx.taller.id), nombresPersonal(ctx.taller.id)]);
  const pedida = (await searchParams).fecha;
  const fecha = pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : dias[0]?.fecha;
  const m = fecha ? await cajaMaestra(ctx.taller.id, fecha) : null;
  const i = dias.findIndex((d) => d.fecha === fecha);
  const anterior = i >= 0 ? dias[i + 1]?.fecha : undefined;
  const siguiente = i > 0 ? dias[i - 1]?.fecha : undefined;
  const pendientesOtrosDias = dias.filter((d) => d.requiereArqueo && d.fecha !== fecha);
  const quien = (id: string | null) => (id ? (nombres.get(id) ?? "alguien del taller") : "—");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja titulo="Caja Maestra" detalle="Las cajas de Recepción y Almacén juntas, día por día. Se arma sola a las 00:00. Solo la ven gerencia y administración." />
      <SubnavCaja actual="/caja/maestra" roles={ctx.roles} />

      {!m ? (
        <Tarjeta className="flex flex-col items-start gap-2">
          <p className="text-[15px] font-medium">Todavía no hay Caja Maestra{fecha ? ` del ${diaLargo(fecha).toLowerCase()}` : ""}.</p>
          <p className="max-w-[60ch] text-sm text-tinta-2">
            Se arma sola pasada la medianoche con las cajas de Recepción y Almacén del día. Si alguna quedó abierta, se cierra con el saldo del sistema y queda marcada para contar.
          </p>
        </Tarjeta>
      ) : (
        <>
          <nav aria-label="Día" className="flex flex-wrap items-center gap-2">
            {anterior ? (
              <Link href={`/caja/maestra?fecha=${anterior}`} aria-label="Día anterior" className="grid size-10 place-items-center rounded-full bg-hundida text-tinta hover:bg-control/70">
                <ChevronLeft className="size-5" />
              </Link>
            ) : (
              <span className="size-10" aria-hidden />
            )}
            <p className="min-w-52 text-center text-[17px] font-semibold">{diaLargo(m.fecha)}</p>
            {siguiente ? (
              <Link href={`/caja/maestra?fecha=${siguiente}`} aria-label="Día siguiente" className="grid size-10 place-items-center rounded-full bg-hundida text-tinta hover:bg-control/70">
                <ChevronRight className="size-5" />
              </Link>
            ) : (
              <span className="size-10" aria-hidden />
            )}
            <p className="ml-auto text-[13px] text-tinta-3">
              {m.generadaPor === "automatico_00h" ? "Armada sola" : "Actualizada"} el {diaLargo(diaEnLima(new Date(m.generadaEn))).toLowerCase()} a las {hora(m.generadaEn)}
            </p>
          </nav>

          {m.requiereArqueo ? (
            <div role="alert" className="flex items-start gap-3 rounded-[24px] bg-aviso-fondo px-5 py-4 text-aviso">
              <AlarmClock className="mt-0.5 size-5 shrink-0" aria-hidden />
              <div className="text-[15px]">
                <p className="font-semibold">
                  {m.cajas.filter((c) => c.requiereArqueo).map((c) => `Caja de ${NOMBRE_AREA[c.area]}`).join(" y ")} se cerró sola a las 00:00.
                </p>
                <p className="mt-0.5">Quedó con el saldo del sistema. Cuenta el efectivo y registra el arqueo abajo: el total del día se corrige solo.</p>
              </div>
            </div>
          ) : null}
          {pendientesOtrosDias.length ? (
            <p className="text-sm text-tinta-2">
              También falta el arqueo de:{" "}
              {pendientesOtrosDias.slice(0, 5).map((d, k) => (
                <span key={d.fecha}>
                  {k ? ", " : ""}
                  <Link href={`/caja/maestra?fecha=${d.fecha}`} className="font-medium text-tinta underline-offset-4 hover:underline">
                    {diaLargo(d.fecha).toLowerCase()}
                  </Link>
                </span>
              ))}
              .
            </p>
          ) : null}

          {/* 1. Resumen del taller */}
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12 [&>*]:min-w-0">
            <Tarjeta aria-labelledby="t-efectivo" className="xl:col-span-5">
              <CabeceraTarjeta id="t-efectivo" titulo="Efectivo del taller" detalle={m.requiereArqueo ? "Con el saldo del sistema donde falta contar" : "Lo contado en las cajas"} />
              <p className="num text-[38px] leading-none font-semibold tracking-[-0.03em]">{formatearSoles(m.efectivoNeto)}</p>
              <dl className="num mt-4 flex flex-col text-[15px]">
                <div className="flex justify-between border-t border-regla py-2 first:border-t-0">
                  <dt className="text-tinta-2">Esperado por el sistema</dt>
                  <dd>{formatearSoles(m.efectivoEsperado)}</dd>
                </div>
                <div className="flex justify-between border-t border-regla py-2">
                  <dt className="text-tinta-2">Diferencia de los conteos</dt>
                  <dd className={cn(m.diferencia < 0 && "text-negativo", m.diferencia > 0 && "text-aviso")}>
                    {m.diferencia === 0 ? "S/ 0.00" : `${m.diferencia > 0 ? "+" : "−"}${formatearSoles(Math.abs(m.diferencia))}`}
                  </dd>
                </div>
              </dl>
            </Tarjeta>
            <Tarjeta aria-labelledby="t-digital" className="xl:col-span-4">
              <CabeceraTarjeta id="t-digital" titulo="Digital" detalle="Entró por estos medios (neto)" />
              <dl className="num flex flex-col text-[15px]">
                {(
                  [
                    ["Yape / Plin", m.yapePlin],
                    ["POS / Tarjeta", m.tarjeta],
                    ["Transferencia", m.transferencia],
                  ] as const
                ).map(([t, v]) => (
                  <div key={t} className={cn("flex justify-between border-t border-regla py-2 first:border-t-0", v === 0 && "text-tinta-3")}>
                    <dt>{t}</dt>
                    <dd>{formatearSoles(v)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-regla pt-2.5 text-[17px] font-semibold">
                  <dt>Total digital</dt>
                  <dd>{formatearSoles(m.yapePlin + m.tarjeta + m.transferencia)}</dd>
                </div>
              </dl>
            </Tarjeta>
            <Tarjeta aria-labelledby="t-egresos" className="md:col-span-2 xl:col-span-3">
              <CabeceraTarjeta id="t-egresos" titulo="Salidas del día" />
              <dl className="num flex flex-col text-[15px]">
                <div className="flex justify-between gap-3 border-t border-regla py-2 first:border-t-0">
                  <dt>
                    Gastos del taller
                    <Link href="/gastos" className="block text-[12px] text-tinta-3 underline-offset-4 hover:underline">
                      Ya están en Gastos, una vez
                    </Link>
                  </dt>
                  <dd>{formatearSoles(m.egresosGastos)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-regla py-2">
                  <dt>
                    Compras de repuestos
                    <span className="block text-[12px] text-tinta-3">Costo de las órdenes, no gasto</span>
                  </dt>
                  <dd>{formatearSoles(m.egresosCompras)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t border-regla py-2">
                  <dt>Retiros y otros</dt>
                  <dd>{formatearSoles(m.egresosOtros)}</dd>
                </div>
              </dl>
            </Tarjeta>
          </div>

          {/* 2. Desglose por caja */}
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {m.cajas.map((c: CajaDelDia) => {
              const egresos = Object.values(c.porMedio).reduce((a, x) => a + x.egresos, 0);
              const cobros = Object.values(c.porMedio).reduce((a, x) => a + x.cobros, 0);
              const ingresos = Object.values(c.porMedio).reduce((a, x) => a + x.ingresos, 0);
              return (
                <Tarjeta key={c.id} aria-labelledby={`t-${c.id}`} className={cn(c.requiereArqueo && "ring-1 ring-aviso/40")}>
                  <CabeceraTarjeta
                    id={`t-${c.id}`}
                    titulo={`Caja de ${NOMBRE_AREA[c.area]}`}
                    detalle={
                      c.tipoCierre === "automatico_00h"
                        ? `Abrió ${quien(c.abiertaPor)} a las ${hora(c.abiertaEn)} · se cerró sola a las 00:00`
                        : `Abrió ${quien(c.abiertaPor)} a las ${hora(c.abiertaEn)} · cerró ${quien(c.cerradaPor)}${c.cerradaEn ? ` a las ${hora(c.cerradaEn)}` : ""}`
                    }
                    accion={c.requiereArqueo ? <RegistrarArqueo caja={c.id} area={NOMBRE_AREA[c.area]} esperado={c.esperado} /> : <Diferencia valor={c.diferencia} />}
                  />
                  <dl className="num grid grid-cols-2 gap-x-6 text-[15px] sm:grid-cols-3">
                    {(
                      [
                        ["Sencillo inicial", c.montoInicial],
                        ["Esperado", c.esperado],
                        ["Contado", c.contado],
                        ["Cobros", cobros],
                        ["Otros ingresos", ingresos],
                        ["Salidas", egresos],
                      ] as const
                    ).map(([t, v]) => (
                      <div key={t} className="border-t border-regla py-2">
                        <dt className="text-[13px] text-tinta-2">{t}</dt>
                        <dd className={cn("font-medium", v == null && "text-aviso")}>{v == null ? "Falta contar" : formatearSoles(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </Tarjeta>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
