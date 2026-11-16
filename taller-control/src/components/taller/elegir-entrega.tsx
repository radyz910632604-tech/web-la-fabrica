"use client";

import { Check } from "lucide-react";
import { Campo, Entrada } from "@/components/ui/campo";
import { atajosEntrega, cuandoEntrega, instanteLima } from "@/lib/taller/entrega";
import { diaEnLima } from "@/lib/formato";
import { cn } from "@/lib/utils";

export type ValorEntrega = { dia: string; hora: string; porDefinir: boolean };

const chip = "presionable inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[14px]";
const activo = "border-primario bg-primario text-primario-tinta";
const reposo = "border-borde bg-tarjeta hover:bg-interna";

/**
 * Día y hora que se le promete al cliente: atajos de un toque (hoy 6 p. m.,
 * mañana 12 m., mañana 6 p. m.), día y hora a mano, o «Por definir».
 * `ahora` llega del servidor para que la pantalla sea la misma en ambos lados.
 */
export function ElegirEntrega({
  valor,
  onChange,
  ahora,
  error,
  permitirPorDefinir = true,
}: {
  valor: ValorEntrega;
  onChange: (v: ValorEntrega) => void;
  ahora: string;
  error?: string;
  permitirPorDefinir?: boolean;
}) {
  const momento = new Date(ahora);
  const atajos = atajosEntrega(momento);
  const elegido = instanteLima(valor.dia, valor.hora);
  const pasada = elegido ? elegido.getTime() < momento.getTime() : false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Atajos de entrega">
        {atajos.map((a) => {
          const es = !valor.porDefinir && valor.dia === a.dia && valor.hora === a.hora;
          return (
            <button key={a.etiqueta} type="button" aria-pressed={es} onClick={() => onChange({ dia: a.dia, hora: a.hora, porDefinir: false })} className={cn(chip, es ? activo : reposo)}>
              {es ? <Check className="size-4" aria-hidden /> : null}
              {a.etiqueta}
            </button>
          );
        })}
        {permitirPorDefinir ? (
          <button
            type="button"
            aria-pressed={valor.porDefinir}
            onClick={() => onChange({ dia: "", hora: "", porDefinir: !valor.porDefinir })}
            className={cn(chip, valor.porDefinir ? activo : reposo)}
          >
            {valor.porDefinir ? <Check className="size-4" aria-hidden /> : null}
            Por definir
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Campo etiqueta="Día" error={error}>
          {(p) => (
            <Entrada
              {...p}
              type="date"
              min={diaEnLima(momento)}
              value={valor.dia}
              onChange={(e) => onChange({ ...valor, dia: e.target.value, porDefinir: false })}
              className="num"
            />
          )}
        </Campo>
        <Campo etiqueta="Hora">
          {(p) => (
            <Entrada
              {...p}
              type="time"
              step={900}
              value={valor.hora}
              onChange={(e) => onChange({ ...valor, hora: e.target.value, porDefinir: false })}
              aria-invalid={error ? true : undefined}
              className="num"
            />
          )}
        </Campo>
      </div>
      <p className="text-sm text-tinta-2" aria-live="polite">
        {valor.porDefinir
          ? "Queda por definir. Ponla en la orden apenas la sepas: así el sistema puede avisarte a tiempo."
          : elegido && pasada
            ? "Esa hora ya pasó. Elige una hora que todavía no llegue."
            : elegido
              ? (
                  <>
                    Le prometes el carro para <strong className="font-semibold text-tinta">{cuandoEntrega(elegido, momento)}</strong>. Si se acerca la hora y no está listo, te avisamos.
                  </>
                )
              : "Elige un atajo o pon el día y la hora."}
      </p>
    </div>
  );
}
