"use client";

import { useState, useTransition } from "react";
import { Selector } from "@/components/ui/campo";
import { asignarItem, type Resultado } from "./acciones";

/** Elegir la orden a la que se entrega un repuesto del stock. */
export function EntregarRepuesto({ id, ordenes }: { id: string; ordenes: { id: string; etiqueta: string }[] }) {
  const [pendiente, iniciar] = useTransition();
  const [r, setR] = useState<Resultado>({});
  return (
    <div className="min-w-0">
      <label className="sr-only" htmlFor={`entregar-${id}`}>
        Entregar a una orden
      </label>
      <Selector
        id={`entregar-${id}`}
        defaultValue=""
        disabled={pendiente}
        onChange={(ev) => {
          const valor = ev.target.value;
          if (valor) iniciar(async () => setR(await asignarItem(id, valor)));
        }}
        className="h-10 text-sm"
      >
        <option value="">Entregar a la orden…</option>
        {ordenes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.etiqueta}
          </option>
        ))}
      </Selector>
      {r.error ? <p className="mt-1 text-sm text-negativo">{r.error}</p> : null}
    </div>
  );
}
