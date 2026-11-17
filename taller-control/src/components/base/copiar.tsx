"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Boton } from "@/components/ui/boton";

/**
 * Botón que copia un texto largo (un cambio de la base, una llave recién
 * creada). Si el navegador no deja copiar, muestra el texto marcado para
 * copiarlo con Ctrl + C.
 */
export function Copiar({ texto, etiqueta, variante = "primario", ancho = true }: { texto: string; etiqueta: string; variante?: "primario" | "secundario"; ancho?: boolean }) {
  const [estado, setEstado] = useState<"" | "copiado" | "manual">("");
  return (
    <div className="flex flex-col gap-2">
      <Boton
        type="button"
        variante={variante}
        className={ancho ? "w-full sm:w-auto sm:self-start" : undefined}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(texto);
            setEstado("copiado");
          } catch {
            setEstado("manual");
          }
        }}
      >
        {estado === "copiado" ? <Check /> : <Copy />}
        {estado === "copiado" ? "Copiado" : etiqueta}
      </Boton>
      <p className="min-h-5 text-sm text-positivo" role="status">
        {estado === "copiado" ? "Listo. Pégalo con Ctrl + V." : estado === "manual" ? "Marca todo el cuadro (Ctrl + A) y copia con Ctrl + C." : ""}
      </p>
      {estado === "manual" ? (
        <textarea readOnly value={texto} onFocus={(e) => e.currentTarget.select()} autoFocus rows={5} className="num w-full rounded-2xl border border-borde bg-interna p-3 text-[12px]" aria-label={etiqueta} />
      ) : null}
    </div>
  );
}
