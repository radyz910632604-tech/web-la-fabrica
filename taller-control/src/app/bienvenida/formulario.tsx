"use client";

import { useActionState, useTransition } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { REGLA_USUARIO } from "@/lib/usuarios";
import { guardarPrimerIngreso, omitirPrimerIngreso, type EstadoBienvenida } from "./acciones";

export function FormularioBienvenida({ usuario }: { usuario: string }) {
  const [estado, accion, enviando] = useActionState<EstadoBienvenida, FormData>(guardarPrimerIngreso, {});
  const [omitiendo, omitir] = useTransition();
  const e = estado.errores ?? {};
  return (
    <form action={accion} className="mt-6 flex flex-col gap-4">
      <Campo etiqueta="Tu usuario" error={e.usuario} ayuda={REGLA_USUARIO}>
        {(p) => <Entrada {...p} name="usuario" defaultValue={usuario} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={30} required />}
      </Campo>
      <Campo etiqueta="Contraseña nueva" error={e.clave} ayuda="Mínimo 8 caracteres.">
        {(p) => <Entrada {...p} name="clave" type="password" autoComplete="new-password" required />}
      </Campo>
      <Campo etiqueta="Repite la contraseña" error={e.repetir}>
        {(p) => <Entrada {...p} name="repetir" type="password" autoComplete="new-password" required />}
      </Campo>
      {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
      <Boton type="submit" disabled={enviando || omitiendo} className="w-full">
        {enviando ? "Guardando…" : "Guardar y entrar"}
      </Boton>
      <Boton type="button" variante="fantasma" disabled={enviando || omitiendo} onClick={() => omitir(() => omitirPrimerIngreso())} className="w-full">
        {omitiendo ? "Entrando…" : "Ahora no"}
      </Boton>
    </form>
  );
}
