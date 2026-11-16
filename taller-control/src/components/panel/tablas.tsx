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
import { formatearCelular } from "@/lib/celulares";
import { formatearMomento } from "@/lib/formato";
import {
  COLOR_ESTADO,
  COLOR_ESTADO_CITA,
  ESTADOS_ORDEN,
  NOMBRE_ESTADO,
  NOMBRE_ESTADO_CITA,
  REDES,
  numeroOrden,
  type EstadoCita,
  type EstadoOrden,
} from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

export type FilaActividad = {
  id: string;
  numero: number;
  placa: string;
  cliente: string | null;
  servicio: string;
  estado: EstadoOrden;
  momento: string;
};

const MAX_FILAS = 5;

/**
 * "Actividad reciente" (y "Mis trabajos" del técnico): buscador, filtro por
 * estado, casilla por fila y menú de tres puntos. Sin cliente para los roles
 * que no deben verlo. Cada fila abre su orden.
 */
export function TablaActividad({
  filas,
  ahora,
  verCliente,
  titulo,
  idTitulo,
  verTodas,
}: {
  filas: FilaActividad[];
  ahora: string;
  verCliente: boolean;
  titulo: string;
  idTitulo: string;
  verTodas: string;
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
      return [f.placa, f.servicio, verCliente ? (f.cliente ?? "") : "", String(f.numero)].join(" ").toLowerCase().replace(/-/g, "").includes(q);
    });
  }, [filas, filtro, busqueda, verCliente]);

  const visibles = filtradas.slice(0, MAX_FILAS);
  const todasElegidas = visibles.length > 0 && visibles.every((f) => elegidas.has(f.id));
  const filtroActivo = filtro !== "todos";

  function alternar(id: string, marcada: boolean) {
    setElegidas((previas) => {
      const nuevas = new Set(previas);
      if (marcada) nuevas.add(id);
      else nuevas.delete(id);
      return nuevas;
    });
  }

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
              <span className="sr-only">Buscar por placa{verCliente ? ", cliente" : ""} o servicio</span>
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
                  <OpcionRadioMenu value="todos">Todos los estados</OpcionRadioMenu>
                  {ESTADOS_ORDEN.map((e) => (
                    <OpcionRadioMenu key={e} value={e}>
                      {NOMBRE_ESTADO[e]}
                    </OpcionRadioMenu>
                  ))}
                </GrupoRadioMenu>
              </ContenidoMenu>
            </Menu>
          </>
        }
      />

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

      {filas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">
          Todavía no hay órdenes. Aparecerán aquí al registrar el primer ingreso.
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-interna border border-borde md:block">
            <table className="w-full table-fixed text-left text-[14px]">
              <thead className="bg-interna text-[13px] text-tinta-2">
                <tr className="h-12">
                  <th scope="col" className="w-12 pl-4">
                    <Casilla
                      checked={todasElegidas}
                      onCheckedChange={(v) => visibles.forEach((f) => alternar(f.id, v === true))}
                      aria-label="Elegir todas las órdenes visibles"
                    />
                  </th>
                  <th scope="col" className="w-[118px] px-3 font-medium">Placa</th>
                  <th scope="col" className="px-3 font-medium">{verCliente ? "Cliente y servicio" : "Servicio"}</th>
                  <th scope="col" className="w-[164px] px-3 pl-6 font-medium">Estado</th>
                  <th scope="col" className="w-[104px] px-3 text-right font-medium">Fecha</th>
                  <th scope="col" className="w-14 pr-3">
                    <span className="sr-only">Opciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => {
                  const elegida = elegidas.has(f.id);
                  return (
                    <tr key={f.id} className={cn("h-16 border-t border-regla", elegida && "bg-interna/60")}>
                      <td className="pl-4">
                        <Casilla checked={elegida} onCheckedChange={(v) => alternar(f.id, v === true)} aria-label={`Elegir ${numeroOrden(f.numero)}`} />
                      </td>
                      <td className="px-3">
                        <Link href={`/ordenes/${f.id}`} className="inline-block rounded-[5px]">
                          <Placa placa={f.placa} />
                        </Link>
                      </td>
                      <td className="px-3">
                        <Link href={`/ordenes/${f.id}`} className="block hover:underline">
                          {verCliente ? <p className="truncate font-medium">{f.cliente ?? "—"}</p> : null}
                          <p className={cn("truncate", verCliente ? "text-[13px] text-tinta-3" : "text-tinta")}>{f.servicio}</p>
                        </Link>
                      </td>
                      <td className="px-3 pl-6">
                        <Estado color={COLOR_ESTADO[f.estado]} texto={NOMBRE_ESTADO[f.estado]} />
                      </td>
                      <td className="num px-3 text-right whitespace-nowrap text-tinta-2">{formatearMomento(new Date(f.momento), momentoAhora)}</td>
                      <td className="pr-3 text-right">
                        <OpcionesFila id={f.id} numero={f.numero} placa={f.placa} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibles.length === 0 ? <SinResultados /> : null}
          </div>

          <ul className="flex flex-col md:hidden">
            {visibles.map((f) => (
              <li key={f.id} className="border-t border-regla first:border-t-0">
                <Link href={`/ordenes/${f.id}`} className="block py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Placa placa={f.placa} />
                    <span className="num text-[13px] text-tinta-2">{formatearMomento(new Date(f.momento), momentoAhora)}</span>
                  </div>
                  <p className="mt-1.5 truncate text-[15px]">{verCliente && f.cliente ? `${f.cliente} · ${f.servicio}` : f.servicio}</p>
                  <Estado className="mt-1 text-[13px] text-tinta-2" color={COLOR_ESTADO[f.estado]} texto={NOMBRE_ESTADO[f.estado]} />
                </Link>
              </li>
            ))}
            {visibles.length === 0 ? <SinResultados /> : null}
          </ul>
        </>
      )}

      {filtradas.length > MAX_FILAS ? (
        <Link href={verTodas} className="mt-3 self-start rounded-full px-1 text-sm font-medium underline-offset-4 hover:underline">
          Ver todas las órdenes
        </Link>
      ) : null}
    </Tarjeta>
  );
}

function SinResultados() {
  return <p className="px-4 py-6 text-center text-sm text-tinta-2">Ninguna orden coincide con la búsqueda o el filtro.</p>;
}

function OpcionesFila({ id, numero, placa }: { id: string; numero: number; placa: string }) {
  return (
    <Menu>
      <DisparadorMenu asChild>
        <button
          type="button"
          className="presionable inline-grid size-10 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna data-[state=open]:bg-interna"
          aria-label={`Opciones de ${numeroOrden(numero)}`}
        >
          <Ellipsis className="size-5" />
        </button>
      </DisparadorMenu>
      <ContenidoMenu align="end">
        <OpcionMenu asChild>
          <Link href={`/ordenes/${id}`}>Abrir {numeroOrden(numero)}</Link>
        </OpcionMenu>
        <OpcionMenu asChild>
          <Link href={`/vehiculos/${placa}`}>Historial del carro</Link>
        </OpcionMenu>
      </ContenidoMenu>
    </Menu>
  );
}

export type FilaCita = {
  id: string;
  hora: string;
  cliente: string;
  celular: string;
  servicio: string;
  red: string;
  estado: EstadoCita;
};

/** Citas de hoy (vendedor de redes y confirmador). */
export function TablaCitas({ citas }: { citas: FilaCita[] }) {
  return (
    <Tarjeta aria-labelledby="titulo-tabla-citas">
      <CabeceraTarjeta
        id="titulo-tabla-citas"
        titulo="Citas de hoy"
        detalle="Ordenadas por hora"
        accion={
          <Link href="/citas" className="text-sm font-medium underline-offset-4 hover:underline">
            Abrir citas
          </Link>
        }
      />
      {citas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">No hay citas para hoy.</p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-interna border border-borde md:block">
            <table className="w-full table-fixed text-left text-[14px]">
              <thead className="bg-interna text-[13px] text-tinta-2">
                <tr className="h-12">
                  <th scope="col" className="w-20 pl-4 font-medium">Hora</th>
                  <th scope="col" className="px-3 font-medium">Cliente</th>
                  <th scope="col" className="px-3 font-medium">Servicio</th>
                  <th scope="col" className="w-28 px-3 font-medium">Red</th>
                  <th scope="col" className="w-36 px-3 pr-4 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {citas.map((c) => (
                  <tr key={c.id} className="h-14 border-t border-regla">
                    <td className="num pl-4 font-medium">{c.hora}</td>
                    <td className="px-3">
                      <p className="truncate font-medium">{c.cliente}</p>
                      <p className="num truncate text-[13px] text-tinta-3">{formatearCelular(c.celular)}</p>
                    </td>
                    <td className="truncate px-3 text-tinta-2">{c.servicio}</td>
                    <td className="px-3 text-tinta-2">{REDES[c.red as keyof typeof REDES] ?? c.red}</td>
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
              <li key={c.id} className="flex gap-4 border-t border-regla py-3 first:border-t-0">
                <span className="num w-12 shrink-0 text-[15px] font-medium">{c.hora}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{c.cliente}</p>
                  <p className="truncate text-[13px] text-tinta-2">
                    {c.servicio} · {REDES[c.red as keyof typeof REDES] ?? c.red}
                  </p>
                  <Estado className="mt-1 text-[13px] text-tinta-2" color={COLOR_ESTADO_CITA[c.estado]} texto={NOMBRE_ESTADO_CITA[c.estado]} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tarjeta>
  );
}
