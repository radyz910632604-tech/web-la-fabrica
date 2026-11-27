import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Anular } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { diaEnLima, formatearSoles, nombreMes } from "@/lib/formato";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { limitesMes } from "@/lib/taller/dinero-consultas";
import { mesesHasta } from "@/lib/taller/reportes";
import { cn } from "@/lib/utils";
import { anularGasto } from "./acciones";
import { CATEGORIAS_GASTO, type CategoriaGasto } from "./categorias";
import { CompletarComprobante, RegistrarGasto } from "./formulario";

export const metadata = { title: "Gastos del taller" };

const etiquetaMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const nombre = nombreMes(new Date(Date.UTC(a, m - 1, 15, 12)));
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`;
};

const TIPO_COMP: Record<string, string> = { factura: "Factura", boleta: "Boleta", recibo: "Recibo", otro: "Comprobante" };

export default async function Gastos({ searchParams }: { searchParams: Promise<{ mes?: string; ver?: string }> }) {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();
  const hoy = diaEnLima(new Date());
  const { mes: pedido, ver } = await searchParams;
  const soloPendientes = ver === "pendientes";
  const mes = pedido && /^\d{4}-\d{2}$/.test(pedido) && pedido <= hoy.slice(0, 7) ? pedido : hoy.slice(0, 7);
  const [anterior] = mesesHasta(mes, 2);
  const siguiente = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 1)).toISOString().slice(0, 7);
  const { desdeDia, hastaDia } = limitesMes(mes);
  const supabase = await clienteServidor();
  let consulta = supabase
    .from("gastos")
    .select("id, fecha, categoria, descripcion, monto, medio, comprobante, tipo_comprobante, comprobante_pendiente, estado, motivo_anulacion, origen, movimiento_caja_id")
    .eq("empresa_id", ctx.taller.id);
  consulta = soloPendientes ? consulta.eq("comprobante_pendiente", true).neq("estado", "anulado") : consulta.gte("fecha", desdeDia).lt("fecha", hastaDia);
  const [{ data }, { count: pendientes }] = await Promise.all([
    consulta.order("fecha", { ascending: false }).order("creado_en", { ascending: false }),
    supabase.from("gastos").select("id", { count: "exact", head: true }).eq("empresa_id", ctx.taller.id).eq("comprobante_pendiente", true).neq("estado", "anulado"),
  ]);
  const gastos = data ?? [];
  const vigentes = gastos.filter((g) => g.estado !== "anulado");
  const total = vigentes.reduce((a, g) => a + Number(g.monto), 0);
  const porCategoria = Object.entries(
    vigentes.reduce<Record<string, number>>((a, g) => ({ ...a, [g.categoria]: (a[g.categoria] ?? 0) + Number(g.monto) }), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Gastos del taller"
        detalle="Alquiler, luz, agua, internet… lo que cuesta tener el taller abierto. Se restan de la utilidad para saber la ganancia real."
        accion={<RegistrarGasto hoy={hoy} />}
      />
      <SubnavCaja actual="/gastos" roles={ctx.roles} />

      {pendientes ? (
        <Link
          href={soloPendientes ? "/gastos" : "/gastos?ver=pendientes"}
          className="flex w-fit items-center gap-2 rounded-full bg-aviso-fondo px-4 py-2 text-sm font-medium text-aviso hover:bg-aviso-fondo/70"
        >
          {soloPendientes ? "← Ver todos los gastos" : `${pendientes} ${pendientes === 1 ? "gasto con comprobante pendiente" : "gastos con comprobante pendiente"} · completarlos`}
        </Link>
      ) : null}
      <div className="flex items-center gap-2">
        <Link href={`/gastos?mes=${anterior}`} className="presionable grid size-11 place-items-center rounded-full bg-tarjeta shadow-reposo hover:bg-interna" aria-label="Mes anterior">
          <ChevronLeft className="size-5" />
        </Link>
        <p className="min-w-40 text-center text-[17px] font-semibold">{etiquetaMes(mes)}</p>
        {siguiente <= hoy.slice(0, 7) ? (
          <Link href={`/gastos?mes=${siguiente}`} className="presionable grid size-11 place-items-center rounded-full bg-tarjeta shadow-reposo hover:bg-interna" aria-label="Mes siguiente">
            <ChevronRight className="size-5" />
          </Link>
        ) : (
          <span className="size-11" />
        )}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <Tarjeta aria-labelledby="t-resumen" className="xl:col-span-4">
          <CabeceraTarjeta id="t-resumen" titulo="Total del mes" detalle={`${vigentes.length} ${vigentes.length === 1 ? "gasto" : "gastos"}`} />
          <p className="num text-[32px] leading-none font-semibold tracking-[-0.025em]">{formatearSoles(total)}</p>
          {porCategoria.length ? (
            <ul className="mt-5 flex flex-col">
              {porCategoria.map(([c, m]) => (
                <li key={c} className="flex items-center gap-3 border-t border-regla py-2.5 text-[15px] first:border-t-0">
                  <span className="min-w-0 flex-1">{CATEGORIAS_GASTO[c as CategoriaGasto] ?? c}</span>
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-hundida" aria-hidden>
                    <span className="block h-full rounded-full bg-tinta" style={{ width: `${Math.max(6, (m / total) * 100)}%` }} />
                  </span>
                  <span className="num w-28 text-right">{formatearSoles(m)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-sm text-tinta-3">
            La utilidad neta del mes está en{" "}
            <Link href={`/reportes?mes=${mes}`} className="font-medium text-tinta underline-offset-4 hover:underline">
              Reportes
            </Link>
            .
          </p>
        </Tarjeta>

        <Tarjeta aria-labelledby="t-lista" className="min-w-0 xl:col-span-8">
          <CabeceraTarjeta id="t-lista" titulo="Detalle" detalle="Un gasto equivocado se anula con motivo; no se borra." />
          {gastos.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-6 text-center text-[15px] text-tinta-2">
              Todavía no hay gastos en {etiquetaMes(mes).toLowerCase()}. Registra el alquiler, la luz, el agua y lo demás para ver la ganancia real.
            </p>
          ) : (
            <ul className="flex flex-col">
              {gastos.map((g) => (
                <li key={g.id} className="flex items-center gap-3 border-t border-regla py-3 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[15px] font-medium", g.estado === "anulado" && "text-tinta-3 line-through")}>{g.descripcion}</p>
                    <p className="truncate text-[13px] text-tinta-3">
                      {g.fecha.split("-").reverse().join("/")} · {CATEGORIAS_GASTO[g.categoria as CategoriaGasto] ?? g.categoria}
                      {g.medio ? ` · ${MEDIOS[g.medio as MedioPago]}` : ""}
                      {g.comprobante ? ` · ${TIPO_COMP[g.tipo_comprobante] ?? "Comprobante"} ${g.comprobante}` : ""}
                      {g.movimiento_caja_id ? " · desde la caja" : ""}
                      {g.estado === "anulado" ? ` · Anulado: ${g.motivo_anulacion}` : ""}
                    </p>
                    {g.comprobante_pendiente && g.estado !== "anulado" ? <CompletarComprobante id={g.id} /> : null}
                  </div>
                  <span className={cn("num shrink-0 text-[15px] font-medium", g.estado === "anulado" && "text-tinta-3 line-through")}>{formatearSoles(Number(g.monto))}</span>
                  {g.origen === "comision" ? (
                    <Link href="/comisiones" className="w-[58px] shrink-0 text-right text-[12px] leading-tight text-tinta-3 hover:text-tinta" title="Se cambia o anula desde Comisiones">
                      Desde Comisiones
                    </Link>
                  ) : g.estado !== "anulado" ? (
                    <Anular id={g.id} accion={anularGasto} que="gasto" />
                  ) : (
                    <span className="w-[58px]" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
