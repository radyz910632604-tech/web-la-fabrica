"use client";

import { useActionState } from "react";
import { Boton } from "@/components/ui/boton";
import { Selector } from "@/components/ui/campo";
import { guardarAvisos } from "./avisos-acciones";
import { CANALES_PERMITIDOS, NOMBRE_CANAL, TIPOS_AVISO } from "./avisos-tipos";

export function FormAvisos({ canales }: { canales: Record<string, string> }) {
  const [estado, accion, enviando] = useActionState(guardarAvisos, {});
  return (
    <form action={accion} className="flex flex-col gap-1">
      <ul className="flex flex-col">
        {TIPOS_AVISO.map((t) => (
          <li key={t.tipo} className="flex flex-col gap-2 border-t border-regla py-3 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
            <label htmlFor={`aviso-${t.tipo}`} className="min-w-0">
              <span className="block text-[15px] font-medium">{t.nombre}</span>
              <span className="block text-[13px] text-tinta-3">{t.detalle}</span>
            </label>
            <Selector id={`aviso-${t.tipo}`} name={t.tipo} defaultValue={canales[t.tipo] ?? t.defecto} className="h-11 text-sm sm:w-64">
              {CANALES_PERMITIDOS[t.destino].map((c) => (
                <option key={c} value={c}>
                  {NOMBRE_CANAL[c]}
                </option>
              ))}
            </Selector>
          </li>
        ))}
      </ul>
      {estado.ok ? <p role="status" className="rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">{estado.ok}</p> : null}
      {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
      <Boton type="submit" variante="secundario" disabled={enviando} className="mt-2 self-start">
        {enviando ? "Guardando…" : "Guardar avisos"}
      </Boton>
      <p className="mt-2 text-sm text-tinta-3">Los mensajes que inicia el taller por WhatsApp usan plantillas aprobadas por Meta y se cobran por conversación. Al cliente solo se le escribe si aceptó recibir mensajes.</p>
    </form>
  );
}
