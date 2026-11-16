import Link from "next/link";
import { notFound } from "next/navigation";
import { Search } from "lucide-react";
import { TituloCaja } from "@/components/caja/subnav";
import { Entrada } from "@/components/ui/campo";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { Tarjeta } from "@/components/ui/tarjeta";
import { desdeSinIgv } from "@/lib/dinero";
import { formatearSoles } from "@/lib/formato";
import { cantidadTexto, sugerenciaPedido, valorStock } from "@/lib/inventario";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { listarOrdenes } from "@/lib/taller/consultas";
import { configDinero } from "@/lib/taller/dinero-consultas";
import { etiquetaOrden } from "@/lib/taller/estados";
import { listarRepuestos } from "@/lib/taller/inventario-consultas";
import { cn } from "@/lib/utils";
import { MoverStock, NuevoRepuesto } from "./controles";

export const metadata = { title: "Inventario" };

export default async function Inventario({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen"])) notFound();
  const { q = "", ver } = await searchParams;
  const mueve = tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"]);
  const verInactivos = ver === "inactivos" && mueve;
  const [todos, { tasaIgv }, ordenes] = await Promise.all([
    listarRepuestos(ctx.taller.id, { buscar: q, incluirInactivos: verInactivos }),
    configDinero(ctx.taller.id),
    mueve ? listarOrdenes(ctx.taller.id, { estados: ["en_taller", "en_proceso", "esperando_repuesto", "listo"], limite: 200, orden: "reciente" }) : Promise.resolve([]),
  ]);
  const activos = todos.filter((r) => r.activo);
  const bajos = activos.filter((r) => r.bajo);
  const lista = verInactivos ? todos.filter((r) => !r.activo) : ver === "bajo" ? bajos : activos;
  const abiertas = ordenes.map((o) => ({ id: o.id, etiqueta: etiquetaOrden(o) }));
  const filtros: [string, string, boolean][] = [
    [`Todos (${activos.length})`, "/inventario", !ver],
    [`Stock bajo (${bajos.length})`, "/inventario?ver=bajo", ver === "bajo"],
    ...(mueve ? ([["Ya no se usan", "/inventario?ver=inactivos", verInactivos]] as [string, string, boolean][]) : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Inventario"
        detalle={`${activos.length} ${activos.length === 1 ? "repuesto" : "repuestos"} · ${formatearSoles(valorStock(activos))} en stock al costo, sin IGV${bajos.length ? ` · ${bajos.length} con stock bajo` : ""}.`}
        accion={
          <div className="flex flex-wrap gap-2">
            <EnlacePdf href="/pdf/inventario/hoy" texto="Inventario PDF" boton />
            {mueve ? <NuevoRepuesto /> : null}
          </div>
        }
      />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <nav aria-label="Filtro" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
          <ul className="flex w-max gap-1 rounded-full bg-hundida p-1">
            {filtros.map(([n, href, activo]) => (
              <li key={href}>
                <Link
                  href={q ? `${href}${href.includes("?") ? "&" : "?"}q=${encodeURIComponent(q)}` : href}
                  aria-current={activo ? "page" : undefined}
                  className={cn("presionable flex h-10 items-center rounded-full px-4 text-sm whitespace-nowrap", activo ? "bg-tarjeta font-medium shadow-reposo" : "text-tinta-2 hover:text-tinta")}
                >
                  {n}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form className="relative md:w-80" role="search">
          {ver ? <input type="hidden" name="ver" value={ver} /> : null}
          <Search className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-tinta-3" aria-hidden />
          <label htmlFor="buscar-repuesto" className="sr-only">
            Buscar repuesto
          </label>
          <Entrada id="buscar-repuesto" name="q" defaultValue={q} placeholder="Código, nombre o marca" className="pl-11" />
        </form>
      </div>

      <Tarjeta aria-label="Repuestos" className="p-0 md:p-0">
        {lista.length === 0 ? (
          <p className="m-5 rounded-2xl border border-dashed border-control px-4 py-6 text-center text-[15px] text-tinta-2">
            {q ? `Nada coincide con «${q}».` : ver === "bajo" ? "Ningún repuesto está en su mínimo." : mueve ? "Todavía no hay repuestos. Crea el primero o registra una compra." : "Todavía no hay repuestos."}
          </p>
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9rem] gap-4 rounded-t-[inherit] bg-interna px-6 py-3 text-[13px] text-tinta-2 md:grid">
              <span>Repuesto</span>
              <span className="text-right">Stock</span>
              <span className="text-right">Costo prom. sin IGV</span>
              <span className="text-right">Precio con IGV</span>
              <span className="sr-only">Acciones</span>
            </div>
            <ul className="flex flex-col">
              {lista.map((r) => {
                const pedir = sugerenciaPedido(r);
                return (
                  <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-regla px-5 py-4 first:border-t-0 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_9rem] md:px-6">
                    <div className="min-w-0">
                      <Link href={`/inventario/${r.id}`} className="text-[15px] font-medium underline-offset-4 hover:underline">
                        {r.nombre}
                      </Link>
                      <p className="truncate text-[13px] text-tinta-3">
                        <span className="font-mono">{r.codigo}</span>
                        {r.marca ? ` · ${r.marca}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("num text-[17px] font-medium", r.bajo && "text-negativo")}>{cantidadTexto(r.stock, r.unidad)}</p>
                      {r.bajo ? (
                        <p className="text-[12px] text-negativo">
                          Mínimo {cantidadTexto(r.stockMinimo, r.unidad)}
                          {pedir ? ` · pedir ${pedir}` : ""}
                        </p>
                      ) : r.stockMinimo > 0 ? (
                        <p className="num text-[12px] text-tinta-3">mín. {cantidadTexto(r.stockMinimo, r.unidad)}</p>
                      ) : null}
                    </div>
                    <p className="num hidden text-right text-[15px] md:block">{r.costoPromedio ? formatearSoles(r.costoPromedio) : "—"}</p>
                    <p className="num hidden text-right text-[15px] md:block">{r.precioSinIgv !== null ? formatearSoles(desdeSinIgv(r.precioSinIgv, tasaIgv).total) : "—"}</p>
                    <div className="col-span-2 flex items-center justify-between gap-3 md:col-span-1 md:justify-end">
                      <p className="num text-[13px] leading-snug text-tinta-2 md:hidden">
                        Costo {r.costoPromedio ? formatearSoles(r.costoPromedio) : "—"}
                        <br />
                        Precio {r.precioSinIgv !== null ? formatearSoles(desdeSinIgv(r.precioSinIgv, tasaIgv).total) : "—"}
                      </p>
                      {mueve && r.activo && r.stock > 0 ? (
                        <MoverStock repuesto={{ id: r.id, nombre: r.nombre, stock: r.stock, unidad: r.unidad }} ordenes={abiertas} compacto />
                      ) : (
                        <Link href={`/inventario/${r.id}`} className="presionable flex h-10 items-center rounded-full px-4 text-sm text-tinta-2 hover:bg-interna hover:text-tinta">
                          Ver kardex
                        </Link>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Tarjeta>
      {mueve ? (
        <p className="text-sm text-tinta-3">
          El stock sube solo al registrar una compra con su línea «al inventario», y baja al entregar a una orden. Nada se borra: un movimiento equivocado se anula con motivo.
        </p>
      ) : null}
    </div>
  );
}
