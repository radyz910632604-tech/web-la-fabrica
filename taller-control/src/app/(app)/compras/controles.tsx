"use client";

import { useState, useTransition } from "react";
import { Boton } from "@/components/ui/boton";
import { Entrada, Selector } from "@/components/ui/campo";
import { asignarItem, completarComprobanteCompra, type Resultado } from "./acciones";

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

/** Completar serie y número de un comprobante que quedó pendiente. */
export function CompletarComprobanteCompra({ id }: { id: string }) {
  const [abierto, setAbierto] = useState(false);
  const [serie, setSerie] = useState("");
  const [numero, setNumero] = useState("");
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();
  if (!abierto)
    return (
      <button type="button" onClick={() => setAbierto(true)} className="mt-1 inline-flex cursor-pointer rounded-full bg-aviso-fondo px-2.5 py-0.5 text-[12px] font-medium text-aviso hover:bg-aviso-fondo/70">
        Comprobante pendiente · completar
      </button>
    );
  return (
    <form
      className="mt-1.5 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r: Resultado = await completarComprobanteCompra(id, serie, numero);
          if (r.error) setError(r.error);
        });
      }}
    >
      <Entrada aria-label="Serie" value={serie} onChange={(e) => setSerie(e.target.value.toUpperCase())} placeholder="F001" maxLength={4} className="h-10 w-20 text-sm uppercase" />
      <Entrada aria-label="Número" value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))} placeholder="4521" maxLength={8} inputMode="numeric" className="num h-10 w-28 text-sm" autoFocus />
      <Boton type="submit" tamano="chico" disabled={pendiente || !numero}>
        {pendiente ? "Guardando…" : "Guardar"}
      </Boton>
      {error ? <span className="text-[13px] text-negativo">{error}</span> : null}
    </form>
  );
}
