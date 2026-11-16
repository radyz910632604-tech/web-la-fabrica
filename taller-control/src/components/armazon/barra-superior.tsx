"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { Bell, ChevronDown, CircleQuestionMark, LogOut, Moon, Search, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { MarcaLogo } from "@/components/marca/logo";
import { Boton } from "@/components/ui/boton";
import {
  ContenidoMenu,
  DisparadorMenu,
  EtiquetaMenu,
  GrupoRadioMenu,
  Menu,
  OpcionMenu,
  OpcionRadioMenu,
  SeparadorMenu,
} from "@/components/ui/menu";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { Entrada } from "@/components/ui/campo";
import { Consejo } from "@/components/ui/consejo";
import { cambiarTaller, salir } from "@/lib/acciones-sesion";
import { iniciales } from "@/lib/formato";
import type { Destino } from "@/lib/navegacion";
import { cn } from "@/lib/utils";

type Props = {
  nombre: string;
  rol: string;
  talleres: { id: string; nombre: string }[];
  tallerId: string;
  secciones: Destino[];
  verAlertas: boolean;
};

export function esActivo(ruta: string, href: string) {
  return href === "/" ? ruta === "/" : ruta === href || ruta.startsWith(`${href}/`);
}

const pildora = "flex h-14 items-center rounded-full bg-tarjeta shadow-reposo";

export function BarraSuperior({ nombre, rol, talleres, tallerId, secciones, verAlertas }: Props) {
  const ruta = usePathname();
  const taller = talleres.find((t) => t.id === tallerId) ?? talleres[0];

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 md:gap-3">
        {/* Marca y taller */}
        <div className={cn(pildora, "min-w-0 gap-1 pr-1.5 pl-1.5 md:gap-2 md:pr-2 md:pl-2")}>
          <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-full pr-1" aria-label="Taller Control, ir al panel">
            <MarcaLogo className="size-9 md:size-10" />
            <span className="hidden text-[17px] font-semibold tracking-[-0.02em] whitespace-nowrap xl:inline">Taller Control</span>
          </Link>
          <span aria-hidden className="hidden h-6 w-px bg-borde xl:block" />
          <SelectorTaller talleres={talleres} taller={taller} />
        </div>

        {/* Pestañas (computadora) */}
        <nav aria-label="Secciones" className={cn(pildora, "hidden gap-1 p-1.5 lg:flex")}>
          {secciones.map((s) => (
            <Pestana key={s.clave} destino={s} activa={esActivo(ruta, s.href)} />
          ))}
        </nav>

        {/* Búsqueda, avisos y usuario */}
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          <div className={cn(pildora, "gap-0 px-1 md:gap-0.5 md:px-1.5")}>
            <Buscar />
            <Avisos verAlertas={verAlertas} />
          </div>
          <MenuUsuario nombre={nombre} rol={rol} />
        </div>
      </div>

      {/* Pestañas (celular y tableta): una fila que se desliza */}
      {secciones.length > 1 ? (
        <nav aria-label="Secciones" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:-mx-6 md:px-6 lg:hidden">
          <div className="flex w-max gap-1 rounded-full bg-tarjeta p-1.5 shadow-reposo">
            {secciones.map((s) => (
              <Pestana key={s.clave} destino={s} activa={esActivo(ruta, s.href)} />
            ))}
          </div>
        </nav>
      ) : null}
    </header>
  );
}

function Pestana({ destino, activa }: { destino: Destino; activa: boolean }) {
  return (
    <Link
      href={destino.href}
      aria-current={activa ? "page" : undefined}
      className={cn(
        "presionable flex h-11 items-center rounded-full px-5 text-[15px] whitespace-nowrap",
        activa ? "bg-primario font-medium text-primario-tinta" : "text-tinta-2 hover:bg-interna hover:text-tinta",
      )}
    >
      {destino.nombre}
    </Link>
  );
}

function SelectorTaller({ talleres, taller }: { talleres: { id: string; nombre: string }[]; taller: { id: string; nombre: string } }) {
  const [pendiente, iniciar] = useTransition();
  if (talleres.length < 2) {
    return <span className="truncate px-2 text-[15px] font-medium">{taller.nombre}</span>;
  }
  return (
    <Menu>
      <DisparadorMenu asChild>
        <button
          type="button"
          className="presionable flex h-11 min-w-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[15px] font-medium hover:bg-interna data-[state=open]:bg-interna md:gap-1.5 md:px-3"
          aria-label={`Taller: ${taller.nombre}. Cambiar de taller`}
        >
          <span className={cn("truncate", pendiente && "opacity-60")}>{taller.nombre}</span>
          <ChevronDown className="size-4 shrink-0 text-tinta-3" />
        </button>
      </DisparadorMenu>
      <ContenidoMenu align="start">
        <EtiquetaMenu>Ver el taller</EtiquetaMenu>
        <GrupoRadioMenu value={taller.id} onValueChange={(id) => iniciar(() => cambiarTaller(id))}>
          {talleres.map((t) => (
            <OpcionRadioMenu key={t.id} value={t.id}>
              {t.nombre}
            </OpcionRadioMenu>
          ))}
        </GrupoRadioMenu>
      </ContenidoMenu>
    </Menu>
  );
}

function Buscar() {
  return (
    <Ventana>
      <Consejo texto="Buscar" lado="bottom">
        <DisparadorVentana asChild>
          <Boton variante="fantasma" tamano="icono-chico" className="size-10 md:size-11" aria-label="Buscar placa, cliente o celular">
            <Search />
          </Boton>
        </DisparadorVentana>
      </Consejo>
      <ContenidoVentana titulo="Buscar" descripcion="Placa, nombre del cliente, celular o número de orden.">
        <form action="/buscar" className="flex gap-2">
          <Entrada type="search" name="q" placeholder="ABC-123, Juan Pérez o 987 654 321" aria-label="Qué buscar" autoFocus />
          <Boton type="submit" tamano="icono" aria-label="Buscar">
            <Search />
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

function Avisos({ verAlertas }: { verAlertas: boolean }) {
  return (
    <Menu>
      <Consejo texto="Avisos" lado="bottom">
        <DisparadorMenu asChild>
          <Boton variante="fantasma" tamano="icono-chico" className="size-10 md:size-11" aria-label="Avisos">
            <Bell />
          </Boton>
        </DisparadorMenu>
      </Consejo>
      <ContenidoMenu align="end" className="w-80 p-4">
        {verAlertas ? (
          <>
            <p className="text-[15px] font-medium">Alertas del taller</p>
            <p className="mt-1 text-sm text-tinta-2">Entregas sin comprobante, saldos pendientes, órdenes sin avance, repuestos no cobrados y más.</p>
            <OpcionMenu asChild className="mt-3 justify-center rounded-full bg-primario font-medium text-primario-tinta data-highlighted:bg-primario/88">
              <Link href="/alertas">Ver alertas</Link>
            </OpcionMenu>
          </>
        ) : (
          <>
            <p className="text-[15px] font-medium">No tienes avisos</p>
            <p className="mt-1 text-sm text-tinta-2">Aquí llegarán los resúmenes del día cuando se conecte WhatsApp (Fase 2).</p>
          </>
        )}
      </ContenidoMenu>
    </Menu>
  );
}

function MenuUsuario({ nombre, rol }: { nombre: string; rol: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const oscuro = resolvedTheme === "dark";
  return (
    <Menu>
      <DisparadorMenu asChild>
        <button
          type="button"
          className={cn(pildora, "presionable cursor-pointer gap-3 pr-1.5 pl-1.5 hover:bg-interna data-[state=open]:bg-interna md:pr-4")}
          aria-label={`${nombre}, ${rol}. Abrir menú`}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-acento-suave text-sm font-semibold text-tinta">
            {iniciales(nombre)}
          </span>
          <span className="hidden min-w-0 text-left md:block">
            <span className="block max-w-40 truncate text-[15px] leading-5 font-medium">{nombre}</span>
            <span className="block max-w-40 truncate text-[13px] leading-4 text-tinta-3">{rol}</span>
          </span>
          <ChevronDown className="hidden size-4 shrink-0 text-tinta-3 md:block" />
        </button>
      </DisparadorMenu>
      <ContenidoMenu align="end">
        <div className="px-3 pt-2 pb-2 md:hidden">
          <p className="text-[15px] font-medium">{nombre}</p>
          <p className="text-[13px] text-tinta-3">{rol}</p>
        </div>
        <SeparadorMenu className="md:hidden" />
        <OpcionMenu onSelect={() => setTheme(oscuro ? "light" : "dark")}>
          {oscuro ? <Sun /> : <Moon />}
          {oscuro ? "Modo claro" : "Modo oscuro"}
        </OpcionMenu>
        <OpcionMenu asChild>
          <Link href="/ayuda">
            <CircleQuestionMark />
            Ayuda
          </Link>
        </OpcionMenu>
        <SeparadorMenu />
        <OpcionMenu onSelect={() => salir()}>
          <LogOut />
          Salir
        </OpcionMenu>
      </ContenidoMenu>
    </Menu>
  );
}
