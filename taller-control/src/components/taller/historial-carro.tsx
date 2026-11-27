import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Estado } from "@/components/ui/estado";
import { formatearSoles, ZONA } from "@/lib/formato";
import { COLOR_ESTADO, nombreEstado, numeroOrden } from "@/lib/taller/estados";
import type { Visita } from "@/lib/taller/historial";

const dia = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, day: "numeric" });
const mes = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, month: "short" });
const anio = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, year: "numeric" });

function Linea({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-3 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <dt className="text-[13px] text-tinta-3 sm:pt-px">{titulo}</dt>
      <dd className="min-w-0 text-[15px] text-tinta">{children}</dd>
    </div>
  );
}

/** La vida del carro en el taller: cada visita con lo que se hizo, sin abrir orden por orden. */
export function HistorialCarro({ visitas }: { visitas: Visita[] }) {
  if (!visitas.length) return <p className="text-sm text-tinta-2">Este carro no tiene visitas.</p>;
  return (
    <ol className="flex flex-col">
      {visitas.map((v, i) => {
        const fecha = new Date(v.ingresadoEn);
        const anioCambia = i === 0 || anio.format(new Date(visitas[i - 1].ingresadoEn)) !== anio.format(fecha);
        return (
          <li key={v.id} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:gap-x-4">
            <div className="flex flex-col items-center border-r border-regla pr-3 pt-4 text-center sm:pr-4">
              {anioCambia ? <span className="num mb-1 text-[12px] font-medium text-tinta-3">{anio.format(fecha)}</span> : null}
              <span className="num text-[22px] leading-none font-semibold tracking-[-0.02em]">{dia.format(fecha)}</span>
              <span className="text-[13px] text-tinta-2">{mes.format(fecha).replace(".", "")}</span>
            </div>
            <Link
              href={`/ordenes/${v.id}`}
              className="group my-2 flex min-w-0 items-start gap-2 rounded-2xl px-3 py-3 hover:bg-interna focus-visible:bg-interna focus-visible:outline-none sm:px-4"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="num text-[15px] font-semibold">{numeroOrden(v.numero)}</span>
                  <Estado color={COLOR_ESTADO[v.estado]} texto={nombreEstado(v.estado, v.facturadoEn)} />
                  {v.garantia ? (
                    <span className="inline-flex items-center gap-1 text-[13px] text-aviso">
                      <ShieldCheck className="size-3.5" aria-hidden />
                      Garantía
                    </span>
                  ) : null}
                  {v.importada ? <span className="rounded-full bg-hundida px-2.5 py-0.5 text-[12px] text-tinta-2">Del Excel anterior</span> : null}
                  {v.monto ? (
                    <span className="num ml-auto text-right">
                      <span className="block text-[15px] font-semibold">{formatearSoles(v.monto.valor)}</span>
                      <span className="block text-[12px] text-tinta-3">{v.monto.tipo === "cobrado" ? "Cobrado" : "Aprobado, sin cobrar"}</span>
                    </span>
                  ) : null}
                </div>
                <dl className="flex flex-col gap-1.5">
                  {v.km != null ? <Linea titulo="Kilometraje"><span className="num">{v.km.toLocaleString("es-PE")} km</span></Linea> : null}
                  <Linea titulo="Trabajos">{v.servicios.length ? v.servicios.join(" · ") : <span className="text-tinta-3">Sin trabajos anotados</span>}</Linea>
                  {v.repuestos.length ? <Linea titulo="Repuestos">{v.repuestos.join(" · ")}</Linea> : null}
                  {v.diagnostico ? <Linea titulo="Diagnóstico">{v.diagnostico}</Linea> : null}
                  {v.importada && v.notas ? <Linea titulo="Notas">{v.notas}</Linea> : null}
                  {!v.importada ? <Linea titulo="Lo trabajó">{v.tecnico ?? <span className="text-tinta-3">Sin asignar</span>}</Linea> : null}
                </dl>
              </div>
              <ChevronRight className="mt-0.5 size-5 shrink-0 text-tinta-3 group-hover:text-tinta-2" aria-hidden />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
