import Link from "next/link";
import { notFound } from "next/navigation";
import { Banknote, CircleCheck, CreditCard, FileSpreadsheet, FileText, History, Landmark, Printer, Search, Smartphone, TriangleExclamationPoint, Undo2 } from "lucide-react";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { filtrarIngresos, GRUPOS, ingresosEntre, resumirIngresos, type GrupoMedio } from "@/lib/caja/ingresos";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { detalleCaja } from "@/lib/taller/caja-consultas";
import { cierreDelDia } from "@/lib/taller/cierre-consultas";
import { nombresPersonal } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";
import { CerrarCajaDelDia, ElegirDia } from "./controles";

export const metadata = { title: "Cierre de caja" };

function Fila({ nombre, valor, fuerte, tenue }: { nombre: string; valor: number; fuerte?: boolean; tenue?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1.5", fuerte && "border-t border-regla pt-2.5 text-[17px] font-semibold", tenue && "text-tinta-2")}>
      <dt>{nombre}</dt>
      <dd className="num">{formatearSoles(valor)}</dd>
    </div>
  );
}

const ICONO: Record<GrupoMedio, typeof Banknote> = { efectivo: Banknote, yape_plin: Smartphone, transferencia: Landmark, tarjeta: CreditCard };

/**
 * Cierre de caja diario: resumen del día a la izquierda (ingresos por forma de pago, operaciones,
 * devoluciones y arqueo del efectivo) y el detalle de cada ingreso a la derecha.
 * Los ingresos son los pagos confirmados (la fuente de verdad); los abonos van uno por uno.
 */
export default async function Cierre({ searchParams }: { searchParams: Promise<{ dia?: string; q?: string; medio?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const hoy = diaEnLima(new Date());
  const { dia: pedido, q: qCrudo, medio: medioCrudo } = await searchParams;
  const dia = pedido && /^\d{4}-\d{2}-\d{2}$/.test(pedido) && pedido <= hoy ? pedido : hoy;
  const q = (qCrudo ?? "").slice(0, 60);
  const medio = GRUPOS.some(([g]) => g === medioCrudo) ? (medioCrudo as GrupoMedio) : null;
  const verUtilidad = ctx.roles.includes("gerencia");
  const supabase = await clienteServidor();
  const [c, { data: cerrado }, nombres, ingresos, { data: cajasDia }] = await Promise.all([
    cierreDelDia(ctx.taller.id, dia, verUtilidad),
    supabase.from("cierres_diarios").select("cerrado_por, cerrado_en, observaciones").eq("empresa_id", ctx.taller.id).eq("fecha", dia).maybeSingle(),
    nombresPersonal(ctx.taller.id),
    ingresosEntre(ctx.taller.id, dia, dia),
    supabase.from("cajas").select("id, estado").eq("empresa_id", ctx.taller.id).eq("tipo_caja", "recepcion").eq("fecha", dia).order("abierta_en"),
  ]);
  const vendido = c.boletas.total + c.facturas.total - c.notas.total;
  const resumen = resumirIngresos(ingresos);
  const filas = filtrarIngresos(ingresos, q, medio);
  const totalFilas = filas.reduce((a, i) => a + i.monto, 0);
  // Arqueo del efectivo: las cajas de Recepción de ese día.
  const detalles = (await Promise.all((cajasDia ?? []).map((x) => detalleCaja(ctx.taller.id, x.id)))).filter((x) => x !== null);
  const abierta = detalles.find((x) => x.caja.estado === "abierta") ?? null;
  const esperado = detalles.reduce((a, x) => a + (x.caja.estado === "abierta" ? x.efectivo.esperado : (x.caja.esperado ?? x.efectivo.esperado)), 0);
  const cerradas = detalles.filter((x) => x.caja.estado === "cerrada");
  const contado = cerradas.length && !abierta ? cerradas.reduce((a, x) => a + (x.caja.contado ?? 0), 0) : null;
  const diferencia = contado != null ? Math.round((contado - esperado) * 100) / 100 : null;
  const observacionCaja = cerradas.map((x) => x.caja.observaciones).filter(Boolean).join(" · ");
  const fecha = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`));
  const fechaCorta = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`));
  const enlace = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ dia: dia !== hoy ? dia : undefined, q: q || undefined, medio: medio ?? undefined, ...cambios })) if (v) p.set(k, v);
    const s = p.toString();
    return `/cierre${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Cierre de caja – Diario"
        detalle={`${fecha.charAt(0).toUpperCase()}${fecha.slice(1)} · resumen de ingresos y movimientos del día`}
        accion={<ElegirDia dia={dia} hoy={hoy} />}
      />
      <SubnavCaja actual="/cierre" roles={ctx.roles} />
      {cerrado ? (
        <p className="flex items-start gap-2 rounded-2xl bg-positivo-fondo px-4 py-3 text-[15px] text-positivo">
          <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            Día cerrado por {nombres.get(cerrado.cerrado_por ?? "") ?? "alguien del taller"} a las{" "}
            {new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(cerrado.cerrado_en)).replace(/\.$/, "")}.
            {cerrado.observaciones ? ` «${cerrado.observaciones}»` : ""}
          </span>
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        {/* Resumen del día */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <Tarjeta aria-labelledby="t-resumen" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="t-resumen" className="text-[17px] font-semibold">Resumen del día</h2>
              <span className="num rounded-full bg-positivo-fondo px-3 py-1 text-[13px] font-medium text-positivo">{fechaCorta}</span>
            </div>
            <div className="rounded-2xl bg-positivo-fondo px-4 py-3">
              <p className="text-[14px] text-positivo">Total de ingresos</p>
              <p className="num text-[32px] leading-tight font-semibold tracking-[-0.02em]">{formatearSoles(resumen.total)}</p>
            </div>
            <dl className="flex flex-col text-[15px]">
              {GRUPOS.map(([g, t]) => {
                const Icono = ICONO[g];
                return (
                  <div key={g} className="flex items-center justify-between gap-3 border-b border-regla py-2.5">
                    <dt className="flex items-center gap-2.5">
                      <Icono className="size-4.5 text-tinta-2" aria-hidden />
                      {t}
                    </dt>
                    <dd className={cn("num font-semibold", resumen.porGrupo[g] === 0 && "text-tinta-3")}>{formatearSoles(resumen.porGrupo[g])}</dd>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-3 border-b border-regla py-2.5">
                <dt>Total de operaciones</dt>
                <dd className="num rounded-full bg-interna px-3 py-0.5 font-semibold">{resumen.operaciones}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="flex items-center gap-2.5">
                  <Undo2 className="size-4.5 text-tinta-2" aria-hidden />
                  Devoluciones
                </dt>
                <dd className={cn("num font-semibold", resumen.devoluciones > 0 && "text-negativo")}>{resumen.devoluciones > 0 ? "−" : ""}{formatearSoles(resumen.devoluciones)}</dd>
              </div>
            </dl>
          </Tarjeta>

          <Tarjeta aria-labelledby="t-arqueo" className="flex flex-col gap-2">
            <h2 id="t-arqueo" className="text-[17px] font-semibold">Arqueo de caja (efectivo)</h2>
            {detalles.length === 0 ? (
              <p className="text-[15px] text-tinta-2">Ese día no se abrió la caja de Recepción.</p>
            ) : (
              <dl className="num flex flex-col text-[15px]">
                <div className="flex justify-between gap-3 border-b border-regla py-2.5"><dt>Saldo esperado (sistema)</dt><dd className="font-semibold">{formatearSoles(esperado)}</dd></div>
                <div className="flex justify-between gap-3 border-b border-regla py-2.5"><dt>Saldo contado (físico)</dt><dd className="font-semibold">{contado != null ? formatearSoles(contado) : abierta ? "Al cerrar" : "—"}</dd></div>
                <div className={cn("flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 font-semibold", diferencia == null ? "" : diferencia === 0 ? "bg-positivo-fondo text-positivo" : "bg-negativo-fondo text-negativo")}>
                  <dt>Diferencia</dt>
                  <dd className="flex items-center gap-1.5">
                    {diferencia == null ? "—" : formatearSoles(diferencia)}
                    {diferencia === 0 ? <CircleCheck className="size-4.5" aria-label="Cuadra" /> : null}
                  </dd>
                </div>
                <div className="pt-2.5">
                  <dt className="text-[14px] text-tinta-2">Observación</dt>
                  <dd className="text-[15px]">{observacionCaja || "Sin observaciones"}</dd>
                </div>
              </dl>
            )}
          </Tarjeta>
        </div>

        {/* Detalle de ingresos del día */}
        <Tarjeta aria-labelledby="t-detalle" className="flex min-w-0 flex-col gap-3 xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="t-detalle" className="text-[17px] font-semibold">Detalle de ingresos del día</h2>
            <form action="/cierre" className="flex w-full gap-2 sm:w-auto">
              {dia !== hoy ? <input type="hidden" name="dia" value={dia} /> : null}
              {medio ? <input type="hidden" name="medio" value={medio} /> : null}
              <span className="relative min-w-0 flex-1 sm:w-72">
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-tinta-3" aria-hidden />
                <Entrada name="q" defaultValue={q} placeholder="Buscar por cliente, DNI, placa u orden" aria-label="Buscar ingreso" className="h-11 pl-10" />
              </span>
              <Boton type="submit" variante="secundario" className="h-11">Buscar</Boton>
            </form>
          </div>
          <nav aria-label="Forma de pago" className="flex flex-wrap gap-1.5">
            <Link href={enlace({ medio: undefined })} aria-current={!medio ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-[13px]", !medio ? "border-primario bg-primario font-medium text-primario-tinta" : "border-borde hover:bg-interna")}>Todas</Link>
            {GRUPOS.map(([g, t]) => (
              <Link key={g} href={enlace({ medio: g })} aria-current={medio === g ? "page" : undefined} className={cn("inline-flex min-h-9 items-center rounded-full border px-3 text-[13px]", medio === g ? "border-primario bg-primario font-medium text-primario-tinta" : "border-borde hover:bg-interna")}>{t}</Link>
            ))}
          </nav>
          {filas.length === 0 ? (
            <p className="rounded-2xl bg-interna px-4 py-6 text-center text-[15px] text-tinta-2">{ingresos.length ? "Nada coincide con la búsqueda." : "No hubo ingresos este día."}</p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="num w-full min-w-[720px] text-left text-[14px]">
                <thead>
                  <tr className="border-b border-regla text-[12px] tracking-wide text-tinta-3 uppercase">
                    <th className="py-2 pr-2 font-medium">N.° orden</th>
                    <th className="py-2 pr-2 font-medium">Hora</th>
                    <th className="py-2 pr-2 font-medium">Cliente</th>
                    <th className="py-2 pr-2 font-medium">DNI / RUC</th>
                    <th className="py-2 pr-2 font-medium">Placa</th>
                    <th className="py-2 pr-2 font-medium">Servicio / concepto</th>
                    <th className="py-2 pr-2 font-medium">Forma de pago</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((i) => (
                    <tr key={i.id} className="border-b border-regla last:border-0">
                      <td className="py-2.5 pr-2 whitespace-nowrap"><Link href={`/caja/cobro?orden=${i.ordenId}`} className="rounded-md bg-interna px-2 py-0.5 font-medium hover:underline">{i.orden ? numeroOrden(i.orden) : "—"}</Link></td>
                      <td className="py-2.5 pr-2 whitespace-nowrap">{i.hora}</td>
                      <td className="max-w-40 truncate py-2.5 pr-2">{i.cliente ?? "—"}</td>
                      <td className="py-2.5 pr-2">{i.documento ?? "—"}</td>
                      <td className="py-2.5 pr-2 whitespace-nowrap">{i.placa ? i.placa.replace(/^([A-Z0-9]{3})([A-Z0-9]{3})$/, "$1-$2") : "—"}</td>
                      <td className="max-w-52 truncate py-2.5 pr-2" title={i.concepto}>{i.concepto}</td>
                      <td className="py-2.5 pr-2">
                        <span className="rounded-full bg-interna px-2.5 py-0.5 text-[13px] whitespace-nowrap">{MEDIOS[i.medio as MedioPago]}</span>
                      </td>
                      <td className={cn("py-2.5 text-right font-semibold", i.monto < 0 && "text-negativo")}>{formatearSoles(i.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="num mt-auto flex items-baseline justify-between gap-3 rounded-2xl bg-positivo-fondo px-4 py-3">
            <span className="text-[15px] font-medium">Total de ingresos ({filas.filter((i) => i.monto >= 0).length} {filas.filter((i) => i.monto >= 0).length === 1 ? "operación" : "operaciones"})</span>
            <span className="text-[24px] font-semibold tracking-[-0.02em]">{formatearSoles(totalFilas)}</span>
          </p>
        </Tarjeta>
      </div>

      {/* Acciones del cierre */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {!cerrado || abierta ? <CerrarCajaDelDia dia={dia} cajaId={abierta?.caja.id ?? null} esperado={abierta ? abierta.efectivo.esperado : null} /> : <span className="grid h-12 place-items-center rounded-full bg-positivo-fondo text-[15px] font-medium text-positivo">Caja cerrada</span>}
        <Boton asChild variante="secundario" className="h-12">
          <a href={`/pdf/cierre/${dia}`} target="_blank" rel="noreferrer"><Printer />Imprimir cierre</a>
        </Boton>
        <Boton asChild variante="secundario" className="h-12">
          <a href={`/cierre/word/${dia}`}><FileText />Reporte en Word</a>
        </Boton>
        <Boton asChild variante="secundario" className="h-12">
          <a href={`/cierre/excel?mes=${dia.slice(0, 7)}`}><FileSpreadsheet />Excel del mes</a>
        </Boton>
        <Boton asChild variante="secundario" className="h-12">
          <Link href="/cierre/historial"><History />Historial de cierres</Link>
        </Boton>
      </div>

      <details className="rounded-3xl bg-tarjeta px-5 py-4 shadow-reposo">
        <summary className="cursor-pointer text-[15px] font-medium">Ventas, comprobantes y cuadre del día · vendido {formatearSoles(vendido)}</summary>
        <div className="mt-4 flex flex-col gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
          <Tarjeta aria-labelledby="t-ventas">
            <CabeceraTarjeta id="t-ventas" titulo="Ventas" detalle="Comprobantes emitidos este día" />
            <dl className="text-[15px]">
              <Fila nombre={`Boletas (${c.boletas.cantidad})`} valor={c.boletas.total} />
              <Fila nombre="  sin IGV" valor={c.boletas.sinIgv} tenue />
              <Fila nombre={`Facturas (${c.facturas.cantidad})`} valor={c.facturas.total} />
              <Fila nombre="  sin IGV" valor={c.facturas.sinIgv} tenue />
              {c.notas.cantidad ? <Fila nombre={`Notas de crédito (${c.notas.cantidad})`} valor={-c.notas.total} /> : null}
              <Fila nombre="IGV de ventas" valor={c.boletas.igv + c.facturas.igv - c.notas.igv} tenue />
              <Fila nombre="Total vendido" valor={vendido} fuerte />
            </dl>
          </Tarjeta>
          <Tarjeta aria-labelledby="t-compras-dia" className="md:col-span-2 xl:col-span-1">
            <CabeceraTarjeta id="t-compras-dia" titulo={verUtilidad ? "Compras y utilidad" : "Compras"} detalle={verUtilidad ? "Sin IGV, estimada" : `${c.compras.cantidad} ${c.compras.cantidad === 1 ? "compra" : "compras"}`} />
            <dl className="text-[15px]">
              <Fila nombre={`Compras (${c.compras.cantidad})`} valor={c.compras.total} />
              <Fila nombre="  sin IGV" valor={c.compras.sinIgv} tenue />
              {verUtilidad ? (
                <>
                  <Fila nombre="Ventas sin IGV" valor={c.boletas.sinIgv + c.facturas.sinIgv - c.notas.sinIgv} />
                  <Fila nombre="Mano de obra del día" valor={-c.manoObra} tenue />
                  <Fila nombre="Utilidad estimada" valor={c.utilidadEstimada} fuerte />
                </>
              ) : null}
            </dl>
          </Tarjeta>
        </div>
  
        <Tarjeta aria-labelledby="t-cuadre">
          <CabeceraTarjeta id="t-cuadre" titulo="Lo que no cuadra" />
          {c.descuadres.length === 0 ? (
            <p className="flex items-center gap-2 text-[15px] text-positivo">
              <CircleCheck className="size-5" aria-hidden />
              Todo cuadra: lo vendido es lo cobrado y cada entrega tiene su comprobante.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {c.descuadres.map((d) => (
                <li key={d} className="flex items-start gap-2.5 rounded-2xl bg-aviso-fondo px-4 py-3 text-[15px]">
                  <TriangleExclamationPoint className="mt-0.5 size-5 shrink-0 text-aviso" aria-hidden />
                  {d}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
        </div>
      </details>
    </div>
  );
}
