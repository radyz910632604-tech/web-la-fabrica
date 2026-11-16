"use client";

import { useActionState, useState, useTransition } from "react";
import { Ellipsis, KeyRound, Plus, UserRoundCheck, UserRoundX, UsersRound } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Casilla } from "@/components/ui/casilla";
import { Estado } from "@/components/ui/estado";
import { ContenidoMenu, DisparadorMenu, Menu, OpcionMenu, SeparadorMenu } from "@/components/ui/menu";
import { Tarjeta } from "@/components/ui/tarjeta";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { iniciales } from "@/lib/formato";
import { NOMBRE_ROL, type Rol } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { agregarPersona, asignarClave, cambiarAcceso, cambiarRoles, type Resultado } from "./acciones";

export type Persona = { id: string; nombre: string; celular: string; activo: boolean; roles: Rol[] };

function Mensaje({ resultado }: { resultado: Resultado }) {
  if (resultado.error) {
    return (
      <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
        {resultado.error}
      </p>
    );
  }
  if (resultado.ok) {
    return (
      <p role="status" className="rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">
        {resultado.ok}
      </p>
    );
  }
  return null;
}

export function AgregarPersona({ asignables }: { asignables: Rol[] }) {
  const [abierta, setAbierta] = useState(false);
  const [clave] = useState(generarClave);
  const [estado, accion, enviando] = useActionState(agregarPersona, {});
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <Plus />
          Agregar persona
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Agregar persona" descripcion="Entrará con su celular y esta contraseña. Dásela en persona.">
        <form action={accion} className="flex flex-col gap-4">
          <Campo etiqueta="Nombre y apellido" error={estado.errores?.nombre}>
            {(p) => <Entrada {...p} name="nombre" autoComplete="off" required />}
          </Campo>
          <Campo etiqueta="Celular" error={estado.errores?.celular} ayuda="Con este número también la reconocerá el WhatsApp del taller.">
            {(p) => <Entrada {...p} name="celular" type="tel" inputMode="tel" placeholder="987 654 321" required />}
          </Campo>
          <Campo etiqueta="Rol" error={estado.errores?.rol} ayuda="Luego puedes darle más de un rol.">
            {(p) => (
              <Selector {...p} name="rol" defaultValue="" required>
                <option value="" disabled>
                  Elige un rol
                </option>
                {asignables.map((r) => (
                  <option key={r} value={r}>
                    {NOMBRE_ROL[r]}
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Contraseña inicial" error={estado.errores?.clave} ayuda="Mínimo 8 caracteres. Te sugerimos esta; puedes cambiarla.">
            {(p) => <Entrada {...p} name="clave" defaultValue={clave} autoComplete="new-password" className="num" required />}
          </Campo>
          <Mensaje resultado={{ ok: estado.ok, error: estado.error }} />
          <Boton type="submit" disabled={enviando} className="mt-1 w-full">
            {enviando ? "Guardando…" : "Agregar"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Una contraseña fácil de dictar: tres sílabas, cuatro números. */
function generarClave() {
  const silabas = ["ba", "ca", "da", "fe", "ga", "lo", "ma", "no", "pa", "ra", "sa", "to", "ve", "zu"];
  const azar = (n: number) => {
    const caja = new Uint32Array(1);
    crypto.getRandomValues(caja);
    return caja[0] % n;
  };
  const texto = Array.from({ length: 3 }, () => silabas[azar(silabas.length)]).join("");
  return `${texto}-${String(azar(10000)).padStart(4, "0")}`;
}

export function ListaPersonal({
  personas,
  asignables,
  yo,
  soyGerencia,
}: {
  personas: Persona[];
  asignables: Rol[];
  yo: string;
  soyGerencia: boolean;
}) {
  if (personas.length === 0) {
    return (
      <Tarjeta className="flex flex-col items-start gap-2">
        <UsersRound className="size-6 text-tinta-3" aria-hidden />
        <p className="text-[15px] font-medium">Todavía no hay personal en este taller.</p>
        <p className="text-sm text-tinta-2">Agrega a la primera persona con el botón de arriba.</p>
      </Tarjeta>
    );
  }
  return (
    <Tarjeta aria-label="Personal" className="p-2 md:p-3">
      <ul className="flex flex-col">
        {personas.map((p) => {
          const esGerencia = p.roles.includes("gerencia");
          const puedoGestionar = p.id !== yo && (soyGerencia || !esGerencia);
          return (
            <li key={p.id} className="flex items-center gap-3 border-t border-regla px-2 py-3 first:border-t-0 md:gap-4 md:px-3">
              <span
                aria-hidden
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold",
                  p.activo ? "bg-acento-suave text-tinta" : "bg-interna text-tinta-3",
                )}
              >
                {iniciales(p.nombre)}
              </span>
              <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_120px] md:items-center md:gap-4">
                <div className="min-w-0">
                  <p className={cn("truncate text-[15px] font-medium", !p.activo && "text-tinta-3")}>
                    {p.nombre}
                    {p.id === yo ? <span className="font-normal text-tinta-3"> (tú)</span> : null}
                  </p>
                  <p className="num text-[13px] text-tinta-3">{p.celular}</p>
                </div>
                <ul className="mt-1.5 flex flex-wrap gap-1.5 md:mt-0" aria-label="Roles">
                  {p.roles.map((r) => (
                    <li key={r} className="flex h-7 items-center rounded-full bg-interna px-3 text-[13px] whitespace-nowrap text-tinta">
                      {NOMBRE_ROL[r]}
                    </li>
                  ))}
                </ul>
                <Estado
                  className="mt-1.5 text-[13px] text-tinta-2 md:mt-0"
                  color={p.activo ? "verde" : "gris"}
                  texto={p.activo ? "Con acceso" : "Desactivada"}
                />
              </div>
              {puedoGestionar ? (
                <AccionesPersona persona={p} asignables={asignables} />
              ) : (
                <span className="size-10 shrink-0" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}

function AccionesPersona({ persona, asignables }: { persona: Persona; asignables: Rol[] }) {
  const [ventana, setVentana] = useState<"roles" | "clave" | null>(null);
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();

  return (
    <>
      <Menu>
        <DisparadorMenu asChild>
          <button
            type="button"
            className="presionable grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna data-[state=open]:bg-interna"
            aria-label={`Opciones de ${persona.nombre}`}
          >
            <Ellipsis className="size-5" />
          </button>
        </DisparadorMenu>
        <ContenidoMenu align="end">
          <OpcionMenu onSelect={() => { setResultado({}); setVentana("roles"); }}>
            <UsersRound />
            Cambiar roles
          </OpcionMenu>
          <OpcionMenu onSelect={() => { setResultado({}); setVentana("clave"); }}>
            <KeyRound />
            Asignar nueva contraseña
          </OpcionMenu>
          <SeparadorMenu />
          <OpcionMenu
            disabled={pendiente}
            onSelect={() =>
              iniciar(async () => {
                setResultado(await cambiarAcceso(persona.id, !persona.activo));
                setTimeout(() => setResultado({}), 4000);
              })
            }
            className={persona.activo ? "text-negativo [&_svg]:text-negativo" : undefined}
          >
            {persona.activo ? <UserRoundX /> : <UserRoundCheck />}
            {persona.activo ? "Quitar acceso" : "Devolver acceso"}
          </OpcionMenu>
        </ContenidoMenu>
      </Menu>

      {(resultado.error || resultado.ok) && ventana === null ? (
        <p
          role={resultado.error ? "alert" : "status"}
          className={cn(
            "fixed bottom-24 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl px-4 py-3 text-sm shadow-flotante md:bottom-8",
            resultado.error ? "bg-negativo-fondo text-negativo" : "bg-positivo-fondo text-positivo",
          )}
        >
          {resultado.error ?? resultado.ok}
        </p>
      ) : null}

      <Ventana open={ventana === "roles"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana titulo={`Roles de ${persona.nombre}`} descripcion="Puede tener más de uno. Lo que ve depende de sus roles.">
          <FormularioRoles persona={persona} asignables={asignables} alTerminar={() => setVentana(null)} />
        </ContenidoVentana>
      </Ventana>

      <Ventana open={ventana === "clave"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana titulo="Nueva contraseña" descripcion={`Para ${persona.nombre}. Dásela en persona; la anterior deja de funcionar.`}>
          <FormularioClave persona={persona} />
        </ContenidoVentana>
      </Ventana>
    </>
  );
}

function FormularioRoles({ persona, asignables, alTerminar }: { persona: Persona; asignables: Rol[]; alTerminar: () => void }) {
  const [elegidos, setElegidos] = useState<Set<Rol>>(new Set(persona.roles));
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  // Los roles que no puede tocar (gerencia, para administración) se muestran pero no se cambian.
  const visibles = [...new Set([...asignables, ...persona.roles])];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await cambiarRoles(persona.id, [...elegidos]);
          setResultado(r);
          if (r.ok) alTerminar();
        });
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Roles</legend>
        {visibles.map((rol) => {
          const fijo = !asignables.includes(rol);
          return (
            <label key={rol} className={cn("flex min-h-12 items-center gap-3 rounded-2xl px-3 hover:bg-interna", fijo ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
              <Casilla
                checked={elegidos.has(rol)}
                disabled={fijo}
                onCheckedChange={(v) =>
                  setElegidos((previos) => {
                    const nuevos = new Set(previos);
                    if (v === true) nuevos.add(rol);
                    else nuevos.delete(rol);
                    return nuevos;
                  })
                }
              />
              <span className="text-[15px]">{NOMBRE_ROL[rol]}</span>
              {fijo ? <span className="ml-auto text-[13px] text-tinta-3">Solo gerencia lo cambia</span> : null}
            </label>
          );
        })}
      </fieldset>
      <Mensaje resultado={resultado} />
      <Boton type="submit" disabled={pendiente || elegidos.size === 0} className="w-full">
        {pendiente ? "Guardando…" : "Guardar roles"}
      </Boton>
    </form>
  );
}

function FormularioClave({ persona }: { persona: Persona }) {
  const [clave, setClave] = useState(generarClave);
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => setResultado(await asignarClave(persona.id, clave)));
      }}
    >
      <Campo etiqueta="Contraseña nueva" ayuda="Mínimo 8 caracteres.">
        {(p) => <Entrada {...p} value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" className="num" />}
      </Campo>
      <Mensaje resultado={resultado} />
      <Boton type="submit" disabled={pendiente || clave.length < 8} className="w-full">
        {pendiente ? "Guardando…" : "Cambiar contraseña"}
      </Boton>
    </form>
  );
}
