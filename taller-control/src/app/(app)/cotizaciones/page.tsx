import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FilePlus2, Search } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { Boton } from "@/components/ui/boton";
import { Estado } from "@/components/ui/estado";
import { Tarjeta } from "@/components/ui/tarjeta";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { ESTADO_COTIZACION, listarCotizaciones } from "@/lib/taller/cotizaciones-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

export const metadata = { title: "Cotizaciones" };

const FILTROS = [
  ["vigentes", "Vigentes"],
  ["aprobada", "Aprobadas"],
  ["", "Todas"],
] as const;

export default async function Cotizaciones({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { ver = "vigentes", q = "" } = await searchParams;
  const lista = await listarCotizaciones(ctx.taller.id, { estado: ver, texto: q });
  const ahora = new Date();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Cotizaciones</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">Productos y servicios con o sin IGV, descuento si lo piden, y su PDF para el cliente.</p>
        </div>
        <Boton asChild>
          <Link href="/cotizaciones/nueva">
            <FilePlus2 />
            Nueva cotización
          </Link>
        </Boton>
      </header>
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Ver" className="flex w-fit gap-1 rounded-full bg-hundida p-1">
          {FILTROS.map(([v, t]) => (
            <Link
              key={v}
              href={`/cotizaciones?ver=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
              aria-current={ver === v ? "page" : undefined}
              className={cn("flex h-10 items-center rounded-full px-4 text-sm font-medium", ver === v ? "bg-tarjeta text-tinta shadow-sm" : "text-tinta-2 hover:text-tinta")}
            >
              {t}
            </Link>
          ))}
        </nav>
        <form className="relative min-w-0 flex-1 sm:max-w-xs">
          <input type="hidden" name="ver" value={ver} />
          <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-tinta-3" aria-hidden />
          <input name="q" defaultValue={q} placeholder="Cliente, placa o número" aria-label="Buscar" className="h-11 w-full rounded-full border border-borde bg-tarjeta pr-4 pl-10 text-[15px] outline-none focus-visible:border-tinta" />
        </form>
      </div>
      <Tarjeta aria-label="Lista" className="p-2 md:p-3">
        {lista.length === 0 ? (
          <p className="px-3 py-6 text-center text-[15px] text-tinta-2">No hay cotizaciones {q ? "con esa búsqueda" : "aquí todavía"}.</p>
        ) : (
          <ul className="flex flex-col">
            {lista.map((c) => (
              <li key={c.id} className="border-t border-regla first:border-t-0">
                <Link href={`/cotizaciones/${c.id}`} className="group flex items-center gap-3 px-2 py-3 hover:bg-interna/60 md:px-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="num text-[15px] font-semibold">N° {String(c.numero ?? 0).padStart(6, "0")}</span>
                      {c.placa ? <Placa placa={c.placa} /> : null}
                      <Estado color={ESTADO_COTIZACION[c.estado]?.color ?? "gris"} texto={ESTADO_COTIZACION[c.estado]?.texto ?? c.estado} className="text-[13px] text-tinta-2" />
                    </p>
                    <p className="mt-0.5 truncate text-[13px] text-tinta-2">
                      {c.cliente} · {c.ordenNumero ? numeroOrden(c.ordenNumero) : "Sin orden"} · {formatearMomento(new Date(c.fecha), ahora)}
                      {c.descuento ? ` · descuento ${formatearSoles(c.descuento)}` : ""}
                      {c.conIgv ? "" : " · sin IGV"}
                    </p>
                  </div>
                  <span className={cn("num shrink-0 text-[15px] font-semibold", c.estado === "anulada" && "text-tinta-3 line-through")}>{formatearSoles(c.total)}</span>
                  <ChevronRight className="size-5 shrink-0 text-tinta-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
