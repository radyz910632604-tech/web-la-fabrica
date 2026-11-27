"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Pestañas sencillas: el contenido ya viene armado; solo se muestra el de la pestaña elegida. */
export function Pestanas({ pestanas, etiqueta }: { etiqueta: string; pestanas: { id: string; titulo: string; contenido: React.ReactNode }[] }) {
  const [activa, setActiva] = useState(pestanas[0]?.id);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="tablist" aria-label={etiqueta} className="-mx-1 flex gap-1 overflow-x-auto border-b border-regla px-1 [scrollbar-width:none]">
        {pestanas.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            id={`pestana-${p.id}`}
            aria-selected={activa === p.id}
            aria-controls={`panel-${p.id}`}
            onClick={() => setActiva(p.id)}
            className={cn(
              "-mb-px min-h-11 shrink-0 cursor-pointer border-b-2 px-3 text-[14px] whitespace-nowrap",
              activa === p.id ? "border-tinta font-medium text-tinta" : "border-transparent text-tinta-2 hover:text-tinta",
            )}
          >
            {p.titulo}
          </button>
        ))}
      </div>
      {pestanas.map((p) => (
        <div key={p.id} role="tabpanel" id={`panel-${p.id}`} aria-labelledby={`pestana-${p.id}`} hidden={activa !== p.id} className="min-w-0">
          {p.contenido}
        </div>
      ))}
    </div>
  );
}
