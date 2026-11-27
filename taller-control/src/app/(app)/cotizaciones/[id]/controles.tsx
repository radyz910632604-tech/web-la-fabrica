"use client";

import { useState, useTransition } from "react";
import { Boton } from "@/components/ui/boton";
import { Selector } from "@/components/ui/campo";
import { pasarAOrden } from "../acciones";

/** Cuando el carro llega: la cotización suelta pasa a su orden. */
export function PasarAOrden({ cotizacionId, ordenes }: { cotizacionId: string; ordenes: { id: string; etiqueta: string }[] }) {
  const [orden, setOrden] = useState("");
  const [r, setR] = useState<{ ok?: string; error?: string }>({});
  const [pendiente, iniciar] = useTransition();
  if (!ordenes.length) return <p className="mt-3 text-sm text-tinta-2">Cuando el carro llegue, regístralo en Nuevo ingreso y aquí podrás pasar esta cotización a su orden.</p>;
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-regla pt-4">
      <p className="text-sm font-medium">¿Ya llegó el carro? Pásala a su orden</p>
      <div className="flex flex-wrap gap-2">
        <Selector aria-label="Orden" value={orden} onChange={(e) => setOrden(e.target.value)} className="min-w-0 flex-1">
          <option value="">Elige la orden…</option>
          {ordenes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.etiqueta}
            </option>
          ))}
        </Selector>
        <Boton variante="secundario" disabled={!orden || pendiente} onClick={() => iniciar(async () => setR(await pasarAOrden(cotizacionId, orden)))}>
          {pendiente ? "Pasando…" : "Pasar a la orden"}
        </Boton>
      </div>
      {r.error ? <p className="text-sm text-negativo">{r.error}</p> : r.ok ? <p className="text-sm text-positivo">{r.ok}</p> : null}
    </div>
  );
}
