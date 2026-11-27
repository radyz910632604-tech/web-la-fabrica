"use client";

import { cn } from "@/lib/utils";

/** Fila de opciones de un toque (chips), para elegir rápido sin abrir listas. */
export function Chips<T extends string>({
  opciones,
  valor,
  alElegir,
  etiqueta,
  tamano = "normal",
}: {
  opciones: readonly (readonly [T, string])[];
  valor: T | "";
  alElegir: (v: T) => void;
  etiqueta: string;
  tamano?: "normal" | "chico";
}) {
  return (
    <div role="group" aria-label={etiqueta} className="flex flex-wrap gap-2">
      {opciones.map(([v, texto]) => (
        <button
          key={v}
          type="button"
          aria-pressed={valor === v}
          onClick={() => alElegir(v)}
          className={cn(
            "presionable cursor-pointer rounded-full border font-medium whitespace-nowrap",
            tamano === "chico" ? "h-9 px-3.5 text-[13px]" : "h-11 px-4 text-[15px]",
            valor === v ? "border-primario bg-primario text-primario-tinta" : "border-borde bg-tarjeta text-tinta hover:bg-interna",
          )}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

/** Los gastos de todos los días, primero; el resto va en «Más». */
export const GASTOS_FRECUENTES = [
  ["movilidad", "Movilidad"],
  ["limpieza", "Limpieza"],
  ["herramientas", "Herramientas"],
  ["mantenimiento_local", "Local"],
  ["otros", "Otro gasto"],
] as const;

export const MEDIOS_CHIP = [
  ["efectivo", "Efectivo"],
  ["yape", "Yape"],
  ["plin", "Plin"],
  ["tarjeta", "Tarjeta"],
  ["transferencia", "Transferencia"],
] as const;
