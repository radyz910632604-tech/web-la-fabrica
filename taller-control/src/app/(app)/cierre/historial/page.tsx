import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSpreadsheet, FileText, Printer } from "lucide-react";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { Boton } from "@/components/ui/boton";
import { Entrada, Selector } from "@/components/ui/campo";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { GRUPOS, ingresosEntre, resumirIngresos } from "@/lib/caja/ingresos";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { nombresPersonal } from "@/lib/taller/consultas";
import { cn } from "@/lib/utils";

export const metadata = { title: "Historial de cierres" };

const sumarDias = (dia: string, n: number) => {
  const f = new Date(`${dia}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + n);
  return f.toISOString().slice(0, 10);
};
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Cierres anteriores (60 días): ingresos, arqueo y quién cerró, con su Word y PDF; y el Excel de cualquier mes. */
export default async function HistorialCierres() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const hoy = diaEnLima(new Date());
  const desde = sumarDias(hoy, -59);
  const supabase = await clienteServidor();
  const [ingresos, nombres, { data: cierres }, { data: cajas }] = await Promise.all([
    ingresosEntre(ctx.taller.id, desde, hoy),
    nombresPersonal(ctx.taller.id),
    supabase.from("cierres_diarios").select("fecha, cerrado_por, cerrado_en, observaciones").eq("empresa_id", ctx.taller.id).gte("fecha", desde).order("fecha", { ascending: false }),
    supabase.from("cajas").select("fecha, estado, efectivo_esperado, efectivo_contado, diferencia, cerrada_por, tipo_cierre").eq("empresa_id", ctx.taller.id).eq("tipo_caja", "recepcion").gte("fecha", desde),
  ]);
  const dias = new Set<string>([...ingresos.map((i) => i.dia), ...(cierres ?? []).map((c) => c.fecha), ...(cajas ?? []).map((c) => c.fecha)]);
  const filas = [...dias]
    .sort((a, b) => b.localeCompare(a))
    .map((dia) => {
      const r = resumirIngresos(ingresos.filter((i) => i.dia === dia));
      const cs = (cajas ?? []).filter((c) => c.fecha === dia);
      const cierre = (cierres ?? []).find((c) => c.fecha === dia);
      const diferencia = cs.some((c) => c.diferencia != null) ? cs.reduce((a, c) => a + Number(c.diferencia ?? 0), 0) : null;
      const quien = cierre ? nombres.get(cierre.cerrado_por ?? "") : cs.map((c) => (c.tipo_cierre === "automatico_00h" ? "Cierre automático 00:00" : nombres.get(c.cerrada_por ?? ""))).find(Boolean);
      return { dia, r, diferencia, abierta: cs.some((c) => c.estado === "abierta"), cerrado: Boolean(cierre), quien: quien ?? "—" };
    });
  const meses = Array.from({ length: 12 }, (_, k) => {
    const f = new Date(`${hoy.slice(0, 7)}-15T12:00:00Z`);
    f.setUTCMonth(f.getUTCMonth() - k);
    const m = f.toISOString().slice(0, 7);
    return [m, `${MESES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`] as const;
  });

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja titulo="Historial de cierres" detalle="Los últimos 60 días. Cada cierre queda guardado y se vuelve a descargar cuando quieras." />
      <SubnavCaja actual="/cierre" roles={ctx.roles} />

      <Tarjeta aria-labelledby="t-excel">
        <CabeceraTarjeta id="t-excel" titulo="Excel acumulativo" detalle="Registro diario, resumen mensual, métodos de pago y detalle por cliente" />
        <form action="/cierre/excel" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1.4fr_1fr_auto] xl:items-end">
          <label className="flex flex-col gap-1.5 text-sm">
            Mes
            <Selector name="mes" defaultValue={hoy.slice(0, 7)} className="h-11">
              {meses.map(([m, t]) => (
                <option key={m} value={m}>
                  {t}
                </option>
              ))}
            </Selector>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Desde (opcional)
            <Entrada type="date" name="desde" className="num h-11" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Hasta (opcional)
            <Entrada type="date" name="hasta" className="num h-11" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Cliente, DNI/RUC, placa u orden
            <Entrada name="q" placeholder="Opcional" className="h-11" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Forma de pago
            <Selector name="medio" defaultValue="" className="h-11">
              <option value="">Todas</option>
              {GRUPOS.map(([g, t]) => (
                <option key={g} value={g}>
                  {t}
                </option>
              ))}
            </Selector>
          </label>
          <Boton type="submit" className="h-11">
            <FileSpreadsheet />
            Descargar Excel
          </Boton>
        </form>
        <p className="mt-3 text-[13px] text-tinta-3">Se arma con los pagos guardados: cada día se suma debajo del anterior y descargarlo otra vez no duplica nada. Para una semana, elige sus fechas en «Desde» y «Hasta».</p>
      </Tarjeta>

      <Tarjeta aria-labelledby="t-cierres">
        <CabeceraTarjeta id="t-cierres" titulo="Cierres anteriores" />
        {filas.length === 0 ? (
          <p className="text-[15px] text-tinta-2">Todavía no hay movimientos.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="num w-full min-w-[760px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-regla text-[12px] tracking-wide text-tinta-3 uppercase">
                  <th className="py-2 pr-2 font-medium">Fecha</th>
                  <th className="py-2 pr-2 text-right font-medium">Ingresos</th>
                  <th className="py-2 pr-2 text-right font-medium">Operaciones</th>
                  <th className="py-2 pr-2 text-right font-medium">Devoluciones</th>
                  <th className="py-2 pr-2 text-right font-medium">Diferencia de caja</th>
                  <th className="py-2 pr-2 font-medium">Cerró</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.dia} className="border-b border-regla last:border-0">
                    <td className="py-2.5 pr-2">
                      <Link href={`/cierre?dia=${f.dia}`} className="font-medium hover:underline">
                        {f.dia.split("-").reverse().join("/")}
                      </Link>
                      {f.abierta ? <span className="ml-2 rounded-full bg-aviso-fondo px-2 py-0.5 text-[11px] text-aviso">Caja abierta</span> : !f.cerrado ? <span className="ml-2 rounded-full bg-hundida px-2 py-0.5 text-[11px] text-tinta-2">Sin cierre del día</span> : null}
                    </td>
                    <td className="py-2.5 pr-2 text-right font-semibold">{formatearSoles(f.r.total)}</td>
                    <td className="py-2.5 pr-2 text-right">{f.r.operaciones}</td>
                    <td className={cn("py-2.5 pr-2 text-right", f.r.devoluciones > 0 && "text-negativo")}>{f.r.devoluciones ? `−${formatearSoles(f.r.devoluciones)}` : "—"}</td>
                    <td className={cn("py-2.5 pr-2 text-right", f.diferencia != null && f.diferencia !== 0 && "font-semibold text-negativo")}>{f.diferencia == null ? "—" : formatearSoles(f.diferencia)}</td>
                    <td className="py-2.5 pr-2">{f.quien}</td>
                    <td className="py-2.5">
                      <span className="flex justify-end gap-1">
                        <a href={`/cierre/word/${f.dia}`} aria-label={`Word del ${f.dia}`} className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[13px] text-tinta-2 hover:bg-interna hover:text-tinta">
                          <FileText className="size-4" />
                          Word
                        </a>
                        <a href={`/pdf/cierre/${f.dia}`} target="_blank" rel="noreferrer" aria-label={`Imprimir el ${f.dia}`} className="inline-flex min-h-9 items-center gap-1 rounded-full px-2.5 text-[13px] text-tinta-2 hover:bg-interna hover:text-tinta">
                          <Printer className="size-4" />
                          PDF
                        </a>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>
    </div>
  );
}
