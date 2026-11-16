"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Ellipsis, Search, SlidersHorizontal } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { Casilla } from "@/components/ui/casilla";
import { Estado } from "@/components/ui/estado";
import {
  ContenidoMenu,
  DisparadorMenu,
  EtiquetaMenu,
  GrupoRadioMenu,
  Menu,
  OpcionMenu,
  OpcionRadioMenu,
} from "@/components/ui/menu";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import {
  COLOR_ESTADO,
  COLOR_ESTADO_CITA,
  NOMBRE_ESTADO,
  NOMBRE_ESTADO_CITA,
  type CitaEjemplo,
  type EstadoOrden,
  type OrdenEjemplo,
} from "@/lib/panel/ejemplo";
import { cn } from "@/lib/utils";

type Fila = OrdenEjemplo & { momento: string };

const FILTROS: { valor: "todos" | EstadoOrden; nombre: string }[] = [
  { valor: "todos", nombre: "Todos los estados" },
  { valor: "en_taller", nombre: NOMBRE_ESTADO.en_taller },
  { valor: "en_proceso", nombre: NOMBRE_ESTADO.en_proceso },
  { valor: "esperando_repuesto", nombre: NOMBRE_ESTADO.esperando_repuesto },
  { valor: "listo", nombre: NOMBRE_ESTADO.listo },
  { valor: "entregado", nombre: NOMBRE_ESTADO.entregado },
];

const MAX_FILAS = 5;

/**
 * "Actividad reciente" (y "Mis trabajos" del técnico): buscador, filtro por
 * estado, casilla por fila y menú de tres puntos. Sin cliente ni monto para
 * los roles que no deben verlos.
 */
export function TablaActividad({
  filas,
  ahora,
  columnas,
  titulo,
  idTitulo,
}: {
  filas: Fila[];
  ahora: string;
  columnas: { cliente: boolean; monto: boolean };
  titulo: string;
  idTitulo: string;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<"todos" | EstadoOrden>("todos");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const momentoAhora = useMemo(() => new Date(ahora), [ahora]);

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase().replace(/-/g, "");
    return filas.filter((f) => {
      if (filtro !== "todos" && f.estado !== filtro) return false;
      if (!q) return true;
      const texto = [f.placa.replace(/-/g, ""), f.servicio, columnas.cliente ? f.cliente : ""].join(" ").toLowerCase();
      return texto.includes(q);
    });
  }, [filas, filtro, busqueda, columnas.cliente]);

  const visibles = filtradas.slice(0, MAX_FILAS);
  const todasElegidas = visibles.length > 0 && visibles.every((f) => elegidas.has(f.numero));

  function alternar(numero: string, marcada: boolean) {
    setElegidas((previas) => {
      const nuevas = new Set(previas);
      if (marcada) nuevas.add(numero);
      else nuevas.delete(numero);
      return nuevas;
    });
  }

  const filtroActivo = filtro !== "todos";

  return (
    <Tarjeta aria-labelledby={idTitulo} className="flex flex-col">
      <CabeceraTarjeta
        id={idTitulo}
        titulo={titulo}
        detalle={
          elegidas.size > 0
            ? `${elegidas.size} ${elegidas.size === 1 ? "orden elegida" : "órdenes elegidas"}`
            : `${filtradas.length} ${filtradas.length === 1 ? "orden" : "órdenes"}${filtroActivo || busqueda ? " con este filtro" : ""}`
        }
        accion={
          <>
            <label className="relative hidden sm:block">
              <span className="sr-only">Buscar por placa{columnas.cliente ? ", cliente" : ""} o servicio</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-tinta-3" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar"
                className="h-11 w-48 rounded-full border border-borde bg-tarjeta pr-4 pl-11 text-[15px] outline-none placeholder:text-tinta-3 focus-visible:border-tinta lg:w-56"
              />
            </label>
            <Menu>
              <DisparadorMenu asChild>
                <button
                  type="button"
                  className={cn(
                    "presionable flex h-11 cursor-pointer items-center gap-2 rounded-full border px-4 text-[15px] hover:bg-interna data-[state=open]:bg-interna",
                    filtroActivo ? "border-tinta" : "border-borde",
                  )}
                >
                  Filtro
                  <SlidersHorizontal className="size-[18px]" aria-hidden />
                  {filtroActivo ? <span aria-hidden className="size-1.5 rounded-full bg-acento" /> : null}
                </button>
              </DisparadorMenu>
              <ContenidoMenu align="end">
                <EtiquetaMenu>Mostrar</EtiquetaMenu>
                <GrupoRadioMenu value={filtro} onValueChange={(v) => setFiltro(v as typeof filtro)}>
                  {FILTROS.map((f) => (
                    <OpcionRadioMenu key={f.valor} value={f.valor}>
                      {f.nombre}
                    </OpcionRadioMenu>
                  ))}
                </GrupoRadioMenu>
              </ContenidoMenu>
            </Menu>
          </>
        }
      />

      {/* Buscador en celular: su propia fila */}
      <label className="relative mb-3 sm:hidden">
        <span className="sr-only">Buscar</span>
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-tinta-3" />
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar placa o servicio"
          className="h-12 w-full rounded-full border border-borde bg-tarjeta pr-4 pl-11 text-[15px] outline-none placeholder:text-tinta-3 focus-visible:border-tinta"
        />
      </label>

      {/* Computadora: tabla */}
      <div className="hidden overflow-hidden rounded-interna border border-borde md:block">
        <table className="w-full table-fixed text-left text-[14px]">
          <thead className="bg-interna text-[13px] text-tinta-2">
            <tr className="h-12">
              <th scope="col" className="w-12 pl-4">
                <Casilla
                  checked={todasElegidas}
                  onCheckedChange={(v) => visibles.forEach((f) => alternar(f.numero, v === true))}
                  aria-label="Elegir todas las órdenes visibles"
                />
              </th>
              <th scope="col" className="w-[118px] px-3 font-medium">Placa</th>
              <th scope="col" className="px-3 font-medium">{columnas.cliente ? "Cliente y servicio" : "Servicio"}</th>
              {columnas.monto ? <th scope="col" className="w-[112px] px-3 text-right font-medium">Monto</th> : null}
              <th scope="col" className="w-[164px] px-3 pl-6 font-medium">Estado</th>
              <th scope="col" className="w-[104px] px-3 text-right font-medium">Fecha</th>
              <th scope="col" className="w-14 pr-3">
                <span className="sr-only">Opciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const elegida = elegidas.has(f.numero);
              return (
                <tr key={f.numero} className={cn("h-16 border-t border-regla", elegida && "bg-interna/60")}>
                  <td className="pl-4">
                    <Casilla checked={elegida} onCheckedChange={(v) => alternar(f.numero, v === true)} aria-label={`Elegir ${f.numero}`} />
                  </td>
                  <td className="px-3">
                    <Placa placa={f.placa} />
                  </td>
                  <td className="px-3">
                    {columnas.cliente ? <p className="truncate font-medium">{f.cliente}</p> : null}
                    <p className={cn("truncate", columnas.cliente ? "text-[13px] text-tinta-3" : "text-tinta")}>{f.servicio}</p>
                  </td>
                  {columnas.monto ? <td className="num px-3 text-right">{formatearSoles(f.montoTotal)}</td> : null}
                  <td className="px-3 pl-6">
                    <Estado color={COLOR_ESTADO[f.estado]} texto={NOMBRE_ESTADO[f.estado]} />
                  </td>
                  <td className="num px-3 text-right whitespace-nowrap text-tinta-2">{formatearMomento(new Date(f.momento), momentoAhora)}</td>
                  <td className="pr-3 text-right">
                    <OpcionesFila numero={f.numero} placa={f.placa} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {visibles.length === 0 ? <SinResultados /> : null}
      </div>

      {/* Celular: lista de dos líneas */}
      <ul className="flex flex-col md:hidden">
        {visibles.map((f) => (
          <li key={f.numero} className="flex gap-3 border-t border-regla py-3 first:border-t-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <Placa placa={f.placa} />
                {columnas.monto ? <span className="num text-[15px] font-medium">{formatearSoles(f.montoTotal)}</span> : null}
              </div>
              <p className="mt-1.5 truncate text-[15px]">{columnas.cliente ? `${f.cliente} · ${f.servicio}` : f.servicio}</p>
              <div className="mt-1 flex items-center justify-between gap-3 text-[13px] text-tinta-2">
                <Estado color={COLOR_ESTADO[f.estado]} texto={NOMBRE_ESTADO[f.estado]} />
                <span className="num">{formatearMomento(new Date(f.momento), momentoAhora)}</span>
              </div>
            </div>
          </li>
        ))}
        {visibles.length === 0 ? <SinResultados /> : null}
      </ul>

      {filtradas.length > MAX_FILAS ? (
        <Link href="/pronto/ordenes" className="mt-3 self-start rounded-full px-1 text-sm font-medium underline-offset-4 hover:underline">
          Ver las {filtradas.length} órdenes
        </Link>
      ) : null}
    </Tarjeta>
  );
}

function SinResultados() {
  return <p className="px-4 py-6 text-center text-sm text-tinta-2">Ninguna orden coincide con la búsqueda o el filtro.</p>;
}

function OpcionesFila({ numero, placa }: { numero: string; placa: string }) {
  return (
    <Menu>
      <DisparadorMenu asChild>
        <button
          type="button"
          className="presionable inline-grid size-10 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna data-[state=open]:bg-interna"
          aria-label={`Opciones de ${numero}`}
        >
          <Ellipsis className="size-5" />
        </button>
      </DisparadorMenu>
      <ContenidoMenu align="end">
        <OpcionMenu asChild>
          <Link href="/pronto/ordenes">Abrir {numero}</Link>
        </OpcionMenu>
        <OpcionMenu asChild>
          <Link href="/pronto/ordenes">Historial de {placa}</Link>
        </OpcionMenu>
      </ContenidoMenu>
    </Menu>
  );
}

/** Citas de hoy (vendedor de redes y confirmador). */
export function TablaCitas({ citas }: { citas: CitaEjemplo[] }) {
  return (
    <Tarjeta aria-labelledby="titulo-tabla-citas">
      <CabeceraTarjeta id="titulo-tabla-citas" titulo="Citas de hoy" detalle="Ordenadas por hora" />
      <div className="hidden overflow-hidden rounded-interna border border-borde md:block">
        <table className="w-full text-left text-[14px]">
          <thead className="bg-interna text-[13px] text-tinta-2">
            <tr className="h-12">
              <th scope="col" className="pl-4 font-medium">Hora</th>
              <th scope="col" className="px-3 font-medium">Cliente</th>
              <th scope="col" className="px-3 font-medium">Servicio</th>
              <th scope="col" className="px-3 font-medium">Red</th>
              <th scope="col" className="px-3 pr-4 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {citas.map((c) => (
              <tr key={c.hora + c.cliente} className="h-14 border-t border-regla">
                <td className="num pl-4 font-medium">{c.hora}</td>
                <td className="px-3 font-medium">{c.cliente}</td>
                <td className="px-3 text-tinta-2">{c.servicio}</td>
                <td className="px-3 text-tinta-2">{c.red}</td>
                <td className="px-3 pr-4">
                  <Estado color={COLOR_ESTADO_CITA[c.estado]} texto={NOMBRE_ESTADO_CITA[c.estado]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col md:hidden">
        {citas.map((c) => (
          <li key={c.hora + c.cliente} className="flex gap-4 border-t border-regla py-3 first:border-t-0">
            <span className="num w-12 shrink-0 text-[15px] font-medium">{c.hora}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{c.cliente}</p>
              <p className="truncate text-[13px] text-tinta-2">
                {c.servicio} · {c.red}
              </p>
              <Estado className="mt-1 text-[13px] text-tinta-2" color={COLOR_ESTADO_CITA[c.estado]} texto={NOMBRE_ESTADO_CITA[c.estado]} />
            </div>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}
