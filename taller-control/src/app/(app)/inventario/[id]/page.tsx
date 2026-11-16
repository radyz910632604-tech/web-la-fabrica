import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Anular } from "@/components/caja/controles";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Interna, Tarjeta } from "@/components/ui/tarjeta";
import { desdeSinIgv } from "@/lib/dinero";
import { formatearSoles } from "@/lib/formato";
import { cantidadTexto, UNIDADES } from "@/lib/inventario";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { listarOrdenes } from "@/lib/taller/consultas";
import { configDinero } from "@/lib/taller/dinero-consultas";
import { etiquetaOrden, numeroOrden } from "@/lib/taller/estados";
import { kardex, repuesto } from "@/lib/taller/inventario-consultas";
import { cn } from "@/lib/utils";
import { anularMovimiento } from "../acciones";
import { EditarRepuesto, MoverStock } from "../controles";

export const metadata = { title: "Repuesto" };

const fechaHora = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

export default async function FichaRepuesto({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen"])) notFound();
  const [{ id }, { nuevo }] = await Promise.all([params, searchParams]);
  const r = await repuesto(ctx.taller.id, id);
  if (!r) notFound();
  const mueve = tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"]);
  const [movs, { tasaIgv }, ordenes] = await Promise.all([
    kardex(ctx.taller.id, id),
    configDinero(ctx.taller.id),
    mueve ? listarOrdenes(ctx.taller.id, { estados: ["en_taller", "en_proceso", "esperando_repuesto", "listo"], limite: 200, orden: "reciente" }) : Promise.resolve([]),
  ]);
  const precioConIgv = r.precioSinIgv === null ? null : desdeSinIgv(r.precioSinIgv, tasaIgv).total;
  const datos = [
    ["Stock", cantidadTexto(r.stock, r.unidad), r.bajo ? "Llegó al mínimo" : r.stockMinimo ? `Mínimo ${cantidadTexto(r.stockMinimo, r.unidad)}` : "Sin mínimo"],
    ["Costo promedio", r.costoPromedio ? formatearSoles(r.costoPromedio) : "—", "Sin IGV, c/u"],
    ["Último costo", r.ultimoCosto !== null ? formatearSoles(r.ultimoCosto) : "—", "Sin IGV, última compra"],
    ["Precio al cliente", precioConIgv !== null ? formatearSoles(precioConIgv) : "—", "Con IGV"],
  ] as const;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link href="/inventario" className="presionable -ml-2 flex h-10 items-center gap-2 self-start rounded-full px-2 text-[15px] text-tinta-2 hover:text-tinta">
        <ArrowLeft className="size-[18px]" aria-hidden />
        Inventario
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[13px] text-tinta-3">{r.codigo}</p>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">{r.nombre}</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2">
            {[r.marca, `se cuenta por ${UNIDADES[r.unidad]?.nombre.toLowerCase() ?? "unidad"}`, r.activo ? null : "ya no se usa"].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex gap-2">
          <EnlacePdf href={`/pdf/kardex/${r.id}`} texto="Kardex PDF" boton />
          {mueve && r.activo ? <MoverStock repuesto={{ id: r.id, nombre: r.nombre, stock: r.stock, unidad: r.unidad }} ordenes={ordenes.map((o) => ({ id: o.id, etiqueta: etiquetaOrden(o) }))} /> : null}
        </div>
      </header>
      {nuevo ? <p className="rounded-2xl bg-positivo-fondo px-4 py-3 text-[15px] text-positivo">Repuesto creado. Para cargar el stock que ya tienes, usa «Mover stock» → «Entrada».</p> : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {datos.map(([t, v, d]) => (
          <Interna key={t} className={cn("flex flex-col gap-1 px-5 py-4", t === "Stock" && r.bajo && "bg-negativo-fondo")}>
            <dt className="text-[13px] text-tinta-2">{t}</dt>
            <dd className={cn("num text-[22px] font-medium tracking-[-0.01em]", t === "Stock" && r.bajo && "text-negativo")}>{v}</dd>
            <dd className="text-[12px] text-tinta-3">{d}</dd>
          </Interna>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Tarjeta aria-labelledby="t-kardex">
          <CabeceraTarjeta id="t-kardex" titulo="Kardex" detalle="Cada entrada y salida, con el saldo que quedó." />
          {movs.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Sin movimientos todavía.</p>
          ) : (
            <ul className="flex flex-col">
              {movs.map((m) => {
                const anulado = m.estado === "anulado";
                const titulo =
                  m.tipo === "entrada" ? `Entrada por compra${m.compra ? ` · ${m.compra}` : ""}` : m.tipo === "salida" ? "Salida a la orden" : m.cantidad > 0 ? "Ajuste: entra" : "Ajuste: sale";
                return (
                  <li key={m.id} className="flex items-start gap-3 border-t border-regla py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-[15px] font-medium", anulado && "text-tinta-3 line-through")}>
                        {titulo}
                        {m.tipo === "salida" && m.ordenId ? (
                          <>
                            {" "}
                            <Link href={`/ordenes/${m.ordenId}`} className="underline-offset-4 hover:underline">
                              {numeroOrden(m.ordenNumero ?? 0)}
                            </Link>
                          </>
                        ) : null}
                      </p>
                      <p className="text-[13px] text-tinta-3">
                        {fechaHora(m.creadoEn)}
                        {m.quien ? ` · ${m.quien}` : ""}
                        {m.nota && m.tipo !== "entrada" ? ` · ${m.nota}` : ""}
                        {anulado ? ` · Anulado: ${m.motivoAnulacion}` : ""}
                      </p>
                    </div>
                    <div className="num text-right">
                      <p className={cn("text-[15px] font-medium", m.cantidad > 0 ? "text-positivo" : "text-tinta", anulado && "text-tinta-3 line-through")}>
                        {m.cantidad > 0 ? "+" : "−"}
                        {cantidadTexto(Math.abs(m.cantidad), r.unidad)}
                      </p>
                      <p className="text-[12px] text-tinta-3">
                        {formatearSoles(m.costo)} c/u{m.stockDespues !== null ? ` · quedó ${m.stockDespues}` : ""}
                      </p>
                    </div>
                    {mueve && !anulado && m.tipo !== "entrada" ? <Anular id={m.id} accion={anularMovimiento} que="movimiento" /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
        {mueve ? (
          <Tarjeta aria-labelledby="t-ficha" className="self-start">
            <CabeceraTarjeta id="t-ficha" titulo="Ficha" detalle="El stock no se escribe aquí: se mueve con entradas, salidas y ajustes." />
            <EditarRepuesto d={{ id: r.id, codigo: r.codigo, nombre: r.nombre, marca: r.marca, unidad: r.unidad, stockMinimo: r.stockMinimo, precioConIgv, activo: r.activo }} />
          </Tarjeta>
        ) : null}
      </div>
    </div>
  );
}
