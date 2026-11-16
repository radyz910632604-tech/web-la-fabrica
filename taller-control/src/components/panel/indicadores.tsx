import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Indicador } from "@/lib/panel/vista";
import type { ResumenMes } from "@/lib/panel/ejemplo";
import { formatearEntero, formatearSoles, formatearVariacion, variacion } from "@/lib/formato";
import { cn } from "@/lib/utils";

const ETIQUETA: Record<Indicador, string> = {
  ventas: "Ventas del mes",
  compras: "Compras del mes",
  utilidad: "Utilidad del mes",
  entregados: "Carros entregados",
};

/**
 * Para cada cifra: ¿subir es bueno? Ventas, utilidad y entregados sí.
 * Que suban las compras no es ni bueno ni malo (acompaña a las ventas): va en gris.
 */
const SUBIR_ES_BUENO: Record<Indicador, boolean | null> = {
  ventas: true,
  compras: null,
  utilidad: true,
  entregados: true,
};

function valor(indicador: Indicador, mes: ResumenMes) {
  return indicador === "entregados" ? mes.entregados : mes[indicador];
}

export function Indicadores({
  indicadores,
  mes,
  anterior,
  mesAnterior,
  diaDelMes,
}: {
  indicadores: Indicador[];
  mes: ResumenMes;
  anterior: ResumenMes;
  mesAnterior: string;
  diaDelMes: number;
}) {
  const impar = indicadores.length % 2 === 1;
  return (
    <ul aria-label="Indicadores del mes" className={cn("grid grid-cols-2 gap-4", indicadores.length <= 2 && "xl:grid-cols-1")}>
      {indicadores.map((ind, i) => {
        const actual = valor(ind, mes);
        const cambio = variacion(actual, valor(ind, anterior));
        const ultimoSolo = impar && i === indicadores.length - 1;
        return (
          <li
            key={ind}
            className={cn("flex min-w-0 flex-col justify-between gap-3 rounded-tarjeta bg-tarjeta p-4 shadow-reposo md:p-5", ultimoSolo && "col-span-full")}
          >
            <p className="text-sm text-tinta-2">{ETIQUETA[ind]}</p>
            <p className="num truncate text-[24px] leading-tight font-medium tracking-[-0.02em] md:text-[28px]">
              {ind === "entregados" ? formatearEntero(actual) : formatearSoles(actual, { sinDecimales: true })}
            </p>
            <Variacion cambio={cambio} subirEsBueno={SUBIR_ES_BUENO[ind]} base={`${mesAnterior} al día ${diaDelMes}`} />
          </li>
        );
      })}
    </ul>
  );
}

function Variacion({ cambio, subirEsBueno, base }: { cambio: number | null; subirEsBueno: boolean | null; base: string }) {
  if (cambio === null) {
    return <p className="text-sm text-tinta-3">— sin mes anterior</p>;
  }
  const sube = cambio > 0;
  const tono =
    cambio === 0 || subirEsBueno === null ? "neutro" : sube === subirEsBueno ? "bueno" : "malo";
  const Flecha = sube ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-tinta-3" title={`Comparado con ${base}`}>
      <span
        className={cn(
          "num inline-flex h-6 items-center gap-0.5 rounded-full pr-2 pl-1.5 font-medium whitespace-nowrap",
          tono === "bueno" && "bg-positivo-fondo text-positivo",
          tono === "malo" && "bg-negativo-fondo text-negativo",
          tono === "neutro" && "bg-interna text-tinta-2",
        )}
      >
        {cambio !== 0 ? <Flecha className="size-3.5" strokeWidth={2.25} aria-hidden /> : null}
        {formatearVariacion(cambio)}
      </span>
      <span>este mes</span>
      <span className="sr-only">(comparado con {base})</span>
    </p>
  );
}
