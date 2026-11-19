"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { ingresar, type EstadoIngreso } from "@/lib/acciones-sesion";

export function FormularioIngreso() {
  const [estado, accion, enviando] = useActionState<EstadoIngreso, FormData>(ingresar, {});
  const [verClave, setVerClave] = useState(false);

  return (
    <form action={accion} className="mt-8 flex flex-col gap-5" noValidate>
      <Campo etiqueta="Celular">
        {(p) => (
          <Entrada
            {...p}
            name="celular"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="987 654 321"
            defaultValue={estado.celular}
            required
          />
        )}
      </Campo>
      <Campo etiqueta="Contraseña">
        {(p) => (
          <div className="relative">
            <Entrada {...p} name="clave" type={verClave ? "text" : "password"} autoComplete="current-password" required className="pr-14" />
            <button
              type="button"
              onClick={() => setVerClave((v) => !v)}
              className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna"
              aria-label={verClave ? "Ocultar contraseña" : "Mostrar contraseña"}
              aria-pressed={verClave}
            >
              {verClave ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        )}
      </Campo>
      {estado.error ? (
        <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}
      <Boton type="submit" disabled={enviando} className="mt-1 w-full">
        {enviando ? "Entrando…" : "Entrar"}
      </Boton>
    </form>
  );
}
