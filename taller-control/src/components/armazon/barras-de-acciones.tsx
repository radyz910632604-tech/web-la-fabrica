"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { CircleQuestionMark, LogOut, Menu as IconoMenu, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Consejo } from "@/components/ui/consejo";
import { ContenidoVentana, Ventana, DisparadorVentana, CerrarVentana } from "@/components/ui/ventana";
import { Icono } from "./icono";
import { esActivo } from "./barra-superior";
import { salir } from "@/lib/acciones-sesion";
import type { Destino } from "@/lib/navegacion";
import { cn } from "@/lib/utils";

const pildoraVertical = "flex flex-col items-center gap-1 rounded-full bg-tarjeta p-1.5 shadow-reposo";
const botonRiel =
  "presionable grid size-12 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna hover:text-tinta [&_svg]:size-[21px]";

/** Barra lateral de íconos (tableta y computadora). */
export function BarraLateral({ acciones, gestion }: { acciones: Destino[]; gestion: Destino[] }) {
  const ruta = usePathname();
  return (
    <aside aria-label="Acciones rápidas" className="sticky top-5 hidden h-[calc(100dvh-152px)] min-h-[440px] w-[60px] shrink-0 flex-col items-center gap-4 md:flex">
      <InterruptorTema />

      {acciones.length + gestion.length > 0 ? (
        <nav aria-label="Acciones" className={pildoraVertical}>
          {acciones.map((a) => (
            <ElementoRiel key={a.clave} destino={a} activo={esActivo(ruta, a.href)} />
          ))}
          {acciones.length > 0 && gestion.length > 0 ? <span aria-hidden className="my-1 h-px w-7 bg-borde" /> : null}
          {gestion.map((g) => (
            <ElementoRiel key={g.clave} destino={g} activo={esActivo(ruta, g.href)} />
          ))}
        </nav>
      ) : null}

      <div className={cn(pildoraVertical, "mt-auto")}>
        <Consejo texto="Ayuda">
          <Link href="/ayuda" className={botonRiel} aria-label="Ayuda">
            <CircleQuestionMark strokeWidth={1.75} />
          </Link>
        </Consejo>
        <Consejo texto="Salir">
          <button type="button" onClick={() => salir()} className={botonRiel} aria-label="Salir">
            <LogOut strokeWidth={1.75} />
          </button>
        </Consejo>
      </div>
    </aside>
  );
}

function ElementoRiel({ destino, activo }: { destino: Destino; activo: boolean }) {
  return (
    <Consejo texto={destino.nombre}>
      <Link
        href={destino.href}
        aria-label={destino.nombre}
        aria-current={activo ? "page" : undefined}
        className={cn(botonRiel, activo && "bg-primario text-primario-tinta hover:bg-primario hover:text-primario-tinta")}
      >
        <Icono nombre={destino.icono} />
      </Link>
    </Consejo>
  );
}

/** El tema guardado solo se conoce en el navegador: hasta entonces no se marca ninguno. */
const sinSuscripcion = () => () => {};
function useMontado() {
  return useSyncExternalStore(sinSuscripcion, () => true, () => false);
}

function InterruptorTema() {
  const { resolvedTheme, setTheme } = useTheme();
  const montado = useMontado();
  const opciones = [
    { valor: "light", nombre: "Modo claro", Icono: Sun },
    { valor: "dark", nombre: "Modo oscuro", Icono: Moon },
  ] as const;
  return (
    <div role="radiogroup" aria-label="Tema" className={pildoraVertical}>
      {opciones.map(({ valor, nombre, Icono: I }) => {
        const activo = montado && resolvedTheme === valor;
        return (
          <Consejo key={valor} texto={nombre}>
            <button
              type="button"
              role="radio"
              aria-checked={activo}
              aria-label={nombre}
              onClick={() => setTheme(valor)}
              className={cn(botonRiel, "size-11", activo && "bg-primario text-primario-tinta hover:bg-primario hover:text-primario-tinta")}
            >
              <I strokeWidth={1.75} />
            </button>
          </Consejo>
        );
      })}
    </div>
  );
}

/** En celular, la barra lateral pasa a ser una barra inferior. */
export function BarraInferior({ acciones, gestion }: { acciones: Destino[]; gestion: Destino[] }) {
  const ruta = usePathname();
  const visibles = acciones.slice(0, 3);
  const resto = [...acciones.slice(3), ...gestion];
  const { resolvedTheme, setTheme } = useTheme();
  const oscuro = resolvedTheme === "dark";

  return (
    // Barra fija sobre el contenido: su sombra la separa de lo que pasa por debajo.
    <nav
      aria-label="Acciones"
      className="fixed inset-x-0 bottom-0 z-40 rounded-t-[26px] bg-tarjeta px-2 pt-2 pb-[max(8px,env(safe-area-inset-bottom))] shadow-[0_-6px_24px_rgb(0_0_0/0.07)] md:hidden" // taste-skill-ignore
    >
      <ul className="flex items-stretch justify-around">
        {visibles.map((a) => {
          const activo = esActivo(ruta, a.href);
          return (
            <li key={a.clave} className="flex-1">
              <Link href={a.href} aria-current={activo ? "page" : undefined} className="presionable flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl">
                <span className={cn("grid h-8 w-12 place-items-center rounded-full [&_svg]:size-[21px]", activo ? "bg-primario text-primario-tinta" : "text-tinta-2")}>
                  <Icono nombre={a.icono} />
                </span>
                <span className="text-xs font-medium text-tinta">{a.corto}</span>
              </Link>
            </li>
          );
        })}
        <li className="flex-1">
          <Ventana>
            <DisparadorVentana asChild>
              <button type="button" className="presionable flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl">
                <span className="grid h-8 w-12 place-items-center rounded-full text-tinta-2 [&_svg]:size-[21px]">
                  <IconoMenu strokeWidth={1.75} />
                </span>
                <span className="text-xs font-medium text-tinta">Más</span>
              </button>
            </DisparadorVentana>
            <ContenidoVentana titulo="Más opciones">
              <ul className="flex flex-col gap-1">
                {resto.map((d) => (
                  <li key={d.clave}>
                    <CerrarVentana asChild>
                      <Link href={d.href} className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] hover:bg-interna">
                        <Icono nombre={d.icono} className="size-5 text-tinta-2" />
                        {d.nombre}
                      </Link>
                    </CerrarVentana>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => setTheme(oscuro ? "light" : "dark")} className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] hover:bg-interna">
                    {oscuro ? <Sun className="size-5 text-tinta-2" /> : <Moon className="size-5 text-tinta-2" />}
                    {oscuro ? "Modo claro" : "Modo oscuro"}
                  </button>
                </li>
                <li>
                  <CerrarVentana asChild>
                    <Link href="/ayuda" className="flex min-h-12 items-center gap-3 rounded-2xl px-3 text-[15px] hover:bg-interna">
                      <CircleQuestionMark className="size-5 text-tinta-2" />
                      Ayuda
                    </Link>
                  </CerrarVentana>
                </li>
                <li>
                  <button type="button" onClick={() => salir()} className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-2xl px-3 text-[15px] hover:bg-interna">
                    <LogOut className="size-5 text-tinta-2" />
                    Salir
                  </button>
                </li>
              </ul>
            </ContenidoVentana>
          </Ventana>
        </li>
      </ul>
    </nav>
  );
}
