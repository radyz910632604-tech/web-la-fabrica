"use client";

import { useActionState, useState, useTransition } from "react";
import { DatabaseBackup, KeyRound } from "lucide-react";
import { Copiar } from "@/components/base/copiar";
import { Boton } from "@/components/ui/boton";
import { copiaAhora, crearLlaves, type ResultadoCopia } from "./acciones";

/** Botón «Hacer una copia ahora». Tarda unos segundos; avisa cómo terminó. */
export function CopiaAhora() {
  const [resultado, setResultado] = useState<ResultadoCopia>({});
  const [haciendo, iniciar] = useTransition();
  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <Boton type="button" variante="secundario" disabled={haciendo} onClick={() => iniciar(async () => setResultado(await copiaAhora()))}>
        <DatabaseBackup />
        {haciendo ? "Copiando…" : "Hacer una copia ahora"}
      </Boton>
      {resultado.error ? (
        <p role="alert" className="max-w-sm text-sm text-negativo sm:text-right">{resultado.error}</p>
      ) : resultado.ok ? (
        <p role="status" className="text-sm text-positivo sm:text-right">{resultado.ok}</p>
      ) : null}
    </div>
  );
}

/** Crea llaves nuevas y las deja listas para copiar y pegar en EasyPanel → Entorno. */
export function CrearLlaves({ cual, etiqueta }: { cual: "avisos" | "n8n"; etiqueta: string }) {
  const [estado, accion, creando] = useActionState(crearLlaves, {});
  if (estado.lineas) {
    return (
      <div className="flex flex-col gap-3">
        <pre className="num overflow-x-auto rounded-2xl bg-interna p-4 text-[12px] leading-5 whitespace-pre-wrap break-all text-tinta">{estado.lineas}</pre>
        <Copiar texto={estado.lineas} etiqueta="Copiar las líneas" />
        <p className="text-sm text-tinta-2">Pégalas ahora en EasyPanel → Entorno: no se guardan aquí y al salir de esta pantalla desaparecen.</p>
      </div>
    );
  }
  return (
    <form action={accion} className="flex flex-col gap-2">
      <input type="hidden" name="cual" value={cual} />
      <Boton type="submit" variante="secundario" disabled={creando} className="w-full sm:w-auto sm:self-start">
        <KeyRound />
        {creando ? "Creando…" : etiqueta}
      </Boton>
      {estado.error ? <p role="alert" className="text-sm text-negativo">{estado.error}</p> : null}
    </form>
  );
}
