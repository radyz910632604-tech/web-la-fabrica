"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";

/**
 * Si algo falla de forma inesperada (se cortó internet, se venció la sesión, un archivo muy
 * pesado), en vez de quedarse callada la pantalla dice qué pasó y deja intentar otra vez.
 */
export default function ErrorDePantalla({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[pantalla]", error);
  }, [error]);
  const red = /fetch|network|failed to fetch|load failed/i.test(error.message);
  const pesado = /body|size|limit|413/i.test(error.message);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 py-10">
      <Tarjeta className="flex flex-col items-start gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-aviso-fondo text-aviso">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold">No se pudo completar</h1>
        <p className="text-[15px] text-tinta-2">
          {red
            ? "Parece que se cortó la conexión. Revisa el internet y vuelve a intentarlo."
            : pesado
              ? "El archivo es demasiado pesado. Usa uno más liviano (por ejemplo, una foto más chica)."
              : "Algo salió mal al guardar o al cargar esta pantalla. No se perdió nada de lo ya guardado."}
        </p>
        {error.digest ? <p className="text-[13px] text-tinta-3">Código para soporte: {error.digest}</p> : null}
        <div className="mt-1 flex flex-wrap gap-2">
          <Boton onClick={() => reset()}>
            <RotateCcw />
            Intentar otra vez
          </Boton>
          <Boton asChild variante="secundario">
            <Link href="/">Ir al panel</Link>
          </Boton>
        </div>
      </Tarjeta>
    </div>
  );
}
