import Link from "next/link";
import { AlarmClock, ChevronRight, Clock3 } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import type { FilaOrden } from "@/lib/taller/consultas";
import { cuandoEntrega, duracion, situacionEntrega } from "@/lib/taller/entrega";
import { cn } from "@/lib/utils";

type Alerta = { orden: FilaOrden; tipo: "atrasada" | "por_vencer"; minutos: number };

/** Alertas del panel: horas prometidas al cliente que ya vencieron o están por vencer. */
export function alertasDeHora(ordenes: FilaOrden[], ahora: Date, minutosAviso: number): { alertas: Alerta[]; sinHora: FilaOrden[] } {
  const alertas: Alerta[] = [];
  const sinHora: FilaOrden[] = [];
  for (const o of ordenes) {
    const s = situacionEntrega({ entregaPrometida: o.entregaPrometida ? new Date(o.entregaPrometida) : null, estado: o.estado }, ahora, minutosAviso);
    if (s.tipo === "atrasada" || s.tipo === "por_vencer") alertas.push({ orden: o, tipo: s.tipo, minutos: s.minutos });
    else if (s.tipo === "sin_hora" && o.estado !== "listo") sinHora.push(o);
  }
  // Primero lo más atrasado; después lo que vence antes.
  alertas.sort((a, b) => (a.tipo === b.tipo ? (a.tipo === "atrasada" ? b.minutos - a.minutos : a.minutos - b.minutos) : a.tipo === "atrasada" ? -1 : 1));
  return { alertas, sinHora };
}

export function AlertasHora({
  alertas,
  sinHora,
  ahora,
  puedeCambiar,
}: {
  alertas: Alerta[];
  sinHora: FilaOrden[];
  ahora: Date;
  puedeCambiar: boolean;
}) {
  if (alertas.length === 0 && (sinHora.length === 0 || !puedeCambiar)) return null;
  const atrasadas = alertas.filter((a) => a.tipo === "atrasada").length;
  const porVencer = alertas.length - atrasadas;
  const detalle = [
    atrasadas ? `${atrasadas} ${atrasadas === 1 ? "atrasada" : "atrasadas"}` : null,
    porVencer ? `${porVencer} por vencer` : null,
    puedeCambiar && sinHora.length ? `${sinHora.length} sin hora` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Tarjeta aria-labelledby="t-horas" className={cn(atrasadas > 0 && "ring-1 ring-negativo/25")}>
      <CabeceraTarjeta id="t-horas" titulo="Horas prometidas al cliente" detalle={detalle} />
      {alertas.length ? (
        <ul className="flex flex-col">
          {alertas.map(({ orden: o, tipo, minutos }) => (
            <li key={o.id} className="border-t border-regla first:border-t-0">
              <Link href={`/ordenes/${o.id}`} className="group flex items-center gap-3 py-3">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-full",
                    tipo === "atrasada" ? "bg-negativo-fondo text-negativo" : "bg-aviso-fondo text-aviso",
                  )}
                >
                  {tipo === "atrasada" ? <AlarmClock className="size-5" /> : <Clock3 className="size-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Placa placa={o.placa} />
                    <span className={cn("text-[15px] font-semibold", tipo === "atrasada" ? "text-negativo" : "text-aviso")}>
                      {tipo === "atrasada" ? `Atrasado ${duracion(minutos)}` : `Vence en ${duracion(minutos)}`}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-tinta-2">
                    Prometido {cuandoEntrega(new Date(o.entregaPrometida as string), ahora)}
                    {o.cliente ? ` · ${o.cliente}` : ""}
                    {o.tecnico ? ` · ${o.tecnico}` : ""}
                  </p>
                </div>
                <ChevronRight className="size-5 shrink-0 text-tinta-3 group-hover:text-tinta-2" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {puedeCambiar && sinHora.length ? (
        <p className={cn("text-sm text-tinta-2", alertas.length && "mt-2 border-t border-regla pt-3")}>
          Sin hora prometida:{" "}
          {sinHora.slice(0, 6).map((o, i) => (
            <span key={o.id}>
              {i ? ", " : ""}
              <Link href={`/ordenes/${o.id}`} className="font-medium text-tinta underline-offset-4 hover:underline">
                {o.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}
              </Link>
            </span>
          ))}
          {sinHora.length > 6 ? ` y ${sinHora.length - 6} más` : ""}. Ponles hora para que el sistema avise antes de que venza.
        </p>
      ) : null}
    </Tarjeta>
  );
}
