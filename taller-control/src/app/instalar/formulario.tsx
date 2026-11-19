"use client";

import { useActionState } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { instalar } from "./acciones";

export function FormularioInstalar() {
  const [estado, accion, enviando] = useActionState(instalar, {});
  const e = estado.errores ?? {};
  return (
    <form action={accion} className="mt-7 flex flex-col gap-4" noValidate>
      <Campo etiqueta="Clave de instalación" error={e.clave_instalacion} ayuda="La que pusiste en EasyPanel como CLAVE_INSTALACION.">
        {(p) => <Entrada {...p} name="clave_instalacion" type="password" autoComplete="off" required />}
      </Campo>
      <Campo etiqueta="Nombre del taller" error={e.taller}>
        {(p) => <Entrada {...p} name="taller" placeholder="Corporación Motors" required />}
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Tu nombre y apellido" error={e.nombre}>
          {(p) => <Entrada {...p} name="nombre" autoComplete="name" required />}
        </Campo>
        <Campo etiqueta="Tu celular" error={e.celular} ayuda="Con él vas a entrar.">
          {(p) => <Entrada {...p} name="celular" type="tel" inputMode="tel" placeholder="987 654 321" required />}
        </Campo>
        <Campo etiqueta="Contraseña" error={e.clave} ayuda="Mínimo 8 caracteres.">
          {(p) => <Entrada {...p} name="clave" type="password" autoComplete="new-password" required />}
        </Campo>
        <Campo etiqueta="Repite la contraseña" error={e.clave2}>
          {(p) => <Entrada {...p} name="clave2" type="password" autoComplete="new-password" required />}
        </Campo>
      </div>
      {estado.error ? (
        <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
          {estado.error}
        </p>
      ) : null}
      <Boton type="submit" disabled={enviando} className="mt-1 h-14 w-full text-[16px]">
        {enviando ? "Creando…" : "Crear el taller y mi acceso"}
      </Boton>
    </form>
  );
}
