import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, Settings2 } from "lucide-react";
import { Estado, type ColorEstado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { comisionesDelMes, type EstadoComision } from "@/lib/taller/comisiones";
import { personalConRol } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";
import { AccionesComision, BotonAprobarTodas, BotonCalcular, NuevaComision } from "./controles";

export const metadata = { title: "Comisiones" };

const ESTADO: Record<EstadoComision, { texto: string; color: ColorEstado }> = {
  pendiente: { texto: "Pendiente", color: "amarillo" },
  aprobada: { texto: "Aprobada", color: "verde" },
  pagada: { texto: "Pagada", color: "verde" },
  anulada: { texto: "Anulada", color: "gris" },
};

const nombreMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const t = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(a, m - 1, 15)));
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const moverMes = (mes: string, d: number) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + d, 1)).toISOString().slice(0, 7);
};

export default async function Comisiones({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const ctx = await obtenerContexto();
  // Solo gerencia y administración: el resto ni ve que existe (la base tampoco les deja leer).
  if (!esGestor(ctx.roles)) notFound();
  const actual = diaEnLima(new Date()).slice(0, 7);
  const pedido = (await searchParams).mes;
  const mes = pedido && /^\d{4}-\d{2}$/.test(pedido) && pedido <= actual ? pedido : actual;
  const [lista, asesores] = await Promise.all([comisionesDelMes(ctx.taller.id, mes), personalConRol(ctx.taller.id, "asesor")]);

  const vivas = lista.filter((c) => c.estado !== "anulada");
  const anuladas = lista.filter((c) => c.estado === "anulada");
  const total = (e: EstadoComision) => vivas.filter((c) => c.estado === e).reduce((a, c) => a + c.monto, 0);
  const porAsesor = [...new Set(vivas.map((c) => c.asesorId))].map((id) => {
    const suyas = vivas.filter((c) => c.asesorId === id);
    return {
      id,
      nombre: suyas[0].asesor,
      ordenes: suyas.filter((c) => c.ordenId).length,
      porPagar: suyas.filter((c) => c.estado !== "pagada").reduce((a, c) => a + c.monto, 0),
      pagado: suyas.filter((c) => c.estado === "pagada").reduce((a, c) => a + c.monto, 0),
    };
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Comisiones del asesor</h1>
          <p className="mt-1.5 max-w-[64ch] text-[15px] text-tinta-2 md:text-base">
            Solo las ven gerencia y administración. Se calculan sobre las órdenes entregadas y cobradas por completo; el mecánico no comisiona por órdenes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NuevaComision asesores={asesores} mes={mes} />
          <BotonCalcular mes={mes} />
        </div>
      </header>

      <nav aria-label="Mes" className="flex items-center gap-2">
        <Link href={`/comisiones?mes=${moverMes(mes, -1)}`} aria-label="Mes anterior" className="grid size-10 place-items-center rounded-full bg-hundida text-tinta hover:bg-control/70">
          <ChevronLeft className="size-5" />
        </Link>
        <p className="min-w-40 text-center text-[17px] font-semibold">{nombreMes(mes)}</p>
        {mes < actual ? (
          <Link href={`/comisiones?mes=${moverMes(mes, 1)}`} aria-label="Mes siguiente" className="grid size-10 place-items-center rounded-full bg-hundida text-tinta hover:bg-control/70">
            <ChevronRight className="size-5" />
          </Link>
        ) : (
          <span className="size-10" aria-hidden />
        )}
        <Link href="/configuracion#comisiones" className="ml-auto inline-flex items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <Settings2 className="size-4" aria-hidden />
          Reglas de comisión
        </Link>
      </nav>

      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ["Por aprobar", total("pendiente")],
            ["Aprobado, por pagar", total("aprobada")],
            ["Pagado (en Gastos)", total("pagada")],
          ] as const
        ).map(([t, v]) => (
          <Tarjeta key={t} className="flex flex-col gap-1">
            <p className="text-sm text-tinta-2">{t}</p>
            <p className="num text-[26px] font-semibold tracking-[-0.02em]">{formatearSoles(v)}</p>
          </Tarjeta>
        ))}
      </div>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-12">
        <Tarjeta aria-labelledby="t-lista" className="min-w-0 xl:col-span-8">
          <CabeceraTarjeta
            id="t-lista"
            titulo="Comisiones del mes"
            detalle={vivas.length ? `${vivas.length} en ${nombreMes(mes).toLowerCase()}` : undefined}
            accion={<BotonAprobarTodas mes={mes} cuantas={vivas.filter((c) => c.estado === "pendiente").length} />}
          />
          {vivas.length === 0 ? (
            <p className="text-[15px] text-tinta-2">
              No hay comisiones en este mes. Toca «Calcular del mes» para traer las órdenes entregadas y cobradas, o agrega una a mano.
            </p>
          ) : (
            <ul className="flex flex-col">
              {vivas.map((c) => (
                <li key={c.id} className="flex flex-col gap-2 border-t border-regla py-3.5 first:border-t-0 md:flex-row md:items-center md:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="text-[15px] font-medium">{c.asesor}</span>
                      <Estado color={ESTADO[c.estado].color} texto={ESTADO[c.estado].texto + (c.estado === "pagada" && c.medio ? ` · ${MEDIOS[c.medio as MedioPago] ?? c.medio}` : "")} className="text-[13px] text-tinta-2" />
                    </p>
                    <p className="truncate text-[13px] text-tinta-2">
                      {c.ordenId ? (
                        <Link href={`/ordenes/${c.ordenId}`} className="font-medium text-tinta underline-offset-4 hover:underline">
                          {c.ordenNumero ? numeroOrden(c.ordenNumero) : "Orden"}
                        </Link>
                      ) : null}
                      {c.ordenId ? " · " : ""}
                      {c.concepto}
                      {c.base != null ? ` · sobre ${formatearSoles(c.base)} sin IGV` : ""}
                    </p>
                  </div>
                  <p className={cn("num shrink-0 text-[17px] font-semibold md:w-28 md:text-right")}>{formatearSoles(c.monto)}</p>
                  <AccionesComision comision={{ id: c.id, estado: c.estado, concepto: c.concepto, monto: c.monto, asesor: c.asesor }} />
                </li>
              ))}
            </ul>
          )}
          {anuladas.length ? (
            <details className="mt-3 border-t border-regla pt-3 text-sm text-tinta-2">
              <summary className="cursor-pointer text-[13px] text-tinta-3">{anuladas.length} {anuladas.length === 1 ? "anulada" : "anuladas"}</summary>
              <ul className="mt-2 flex flex-col gap-1.5">
                {anuladas.map((c) => (
                  <li key={c.id} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      {c.asesor} · {c.concepto}
                      <span className="block text-[13px] text-tinta-3">Motivo: {c.motivo}</span>
                    </span>
                    <span className="num shrink-0 text-tinta-3 line-through">{formatearSoles(c.monto)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Tarjeta>

        <Tarjeta aria-labelledby="t-asesores" className="min-w-0 xl:col-span-4">
          <CabeceraTarjeta id="t-asesores" titulo="Por asesor" detalle={nombreMes(mes)} />
          {porAsesor.length === 0 ? (
            <p className="text-sm text-tinta-2">{asesores.length ? "Sin comisiones este mes." : "No hay personas con rol de asesor. Agrégalas en Personal."}</p>
          ) : (
            <dl className="flex flex-col">
              {porAsesor.map((a) => (
                <div key={a.id} className="border-t border-regla py-3 first:border-t-0">
                  <dt className="text-[15px] font-medium">{a.nombre}</dt>
                  <dd className="num mt-1 grid grid-cols-2 gap-2 text-[13px] text-tinta-2">
                    <span>
                      Por pagar
                      <span className="block text-[15px] font-semibold text-tinta">{formatearSoles(a.porPagar)}</span>
                    </span>
                    <span>
                      Pagado
                      <span className="block text-[15px] font-semibold text-tinta">{formatearSoles(a.pagado)}</span>
                    </span>
                  </dd>
                  <p className="mt-1 text-[13px] text-tinta-3">{a.ordenes} {a.ordenes === 1 ? "orden" : "órdenes"}</p>
                </div>
              ))}
            </dl>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
