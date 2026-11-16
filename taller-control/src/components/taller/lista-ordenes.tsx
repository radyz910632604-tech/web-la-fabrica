import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { Estado } from "@/components/ui/estado";
import { formatearMomento } from "@/lib/formato";
import { cuandoEntrega, situacionEntrega, type SituacionEntrega } from "@/lib/taller/entrega";
import { COLOR_ESTADO, NOMBRE_ESTADO, numeroOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";
import type { FilaOrden } from "@/lib/taller/consultas";

/**
 * Lista de órdenes: cada fila abre la orden. En computadora es una tabla; en
 * celular, filas de dos líneas. Sin cliente para quien no debe verlo.
 */
export function ListaOrdenes({
  ordenes,
  verCliente,
  verTecnico = true,
  vacio,
  fecha = "estado",
  minutosAviso = 120,
}: {
  ordenes: FilaOrden[];
  verCliente: boolean;
  verTecnico?: boolean;
  vacio: string;
  fecha?: "estado" | "ingreso";
  minutosAviso?: number;
}) {
  if (ordenes.length === 0) {
    return <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">{vacio}</p>;
  }
  const ahora = new Date();
  const momento = (o: FilaOrden) => formatearMomento(new Date(fecha === "ingreso" ? o.ingresadoEn : o.estadoCambiadoEn), ahora);
  const detalle = (o: FilaOrden) => o.servicios.join(" · ") || "Sin servicios anotados";
  const entrega = (o: FilaOrden) => <Entrega o={o} ahora={ahora} minutosAviso={minutosAviso} />;

  return (
    <>
      <div className="hidden overflow-hidden rounded-interna border border-borde md:block">
        <table className="w-full table-fixed text-left text-[14px]">
          <thead className="bg-interna text-[13px] text-tinta-2">
            <tr className="h-12">
              <th scope="col" className="w-[118px] pl-4 font-medium">Placa</th>
              <th scope="col" className="px-3 font-medium">{verCliente ? "Cliente y servicios" : "Carro y servicios"}</th>
              {verTecnico ? <th scope="col" className="w-[150px] px-3 font-medium">Técnico</th> : null}
              <th scope="col" className="w-[160px] px-3 font-medium">Estado</th>
              <th scope="col" className="w-[110px] px-3 text-right font-medium">{fecha === "ingreso" ? "Ingreso" : "Desde"}</th>
              <th scope="col" className="w-10 pr-3">
                <span className="sr-only">Abrir</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordenes.map((o) => (
              <tr key={o.id} className="group relative h-16 border-t border-regla hover:bg-interna/60">
                <td className="pl-4">
                  <Placa placa={o.placa} />
                </td>
                <td className="px-3">
                  <Link href={`/ordenes/${o.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
                    <p className="truncate font-medium">
                      {verCliente ? (o.cliente ?? "—") : o.vehiculo || numeroOrden(o.numero)}
                      {o.garantia ? <GarantiaChip /> : null}
                    </p>
                    <p className="truncate text-[13px] text-tinta-3">{detalle(o)}</p>
                  </Link>
                </td>
                {verTecnico ? <td className="truncate px-3 text-tinta-2">{o.tecnico ?? "Sin asignar"}</td> : null}
                <td className="px-3">
                  <Estado color={COLOR_ESTADO[o.estado]} texto={NOMBRE_ESTADO[o.estado]} />
                  {entrega(o)}
                </td>
                <td className="num px-3 text-right whitespace-nowrap text-tinta-2">{momento(o)}</td>
                <td className="pr-3 text-tinta-3">
                  <ChevronRight className="size-5" aria-hidden />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col md:hidden">
        {ordenes.map((o) => (
          <li key={o.id} className="border-t border-regla first:border-t-0">
            <Link href={`/ordenes/${o.id}`} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <Placa placa={o.placa} />
                  <span className="num text-[13px] text-tinta-2">{momento(o)}</span>
                </div>
                <p className="mt-1.5 truncate text-[15px] font-medium">
                  {verCliente ? (o.cliente ?? "—") : o.vehiculo || numeroOrden(o.numero)}
                  {o.garantia ? <GarantiaChip /> : null}
                </p>
                <p className="truncate text-[13px] text-tinta-2">{detalle(o)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-tinta-2">
                  <Estado color={COLOR_ESTADO[o.estado]} texto={NOMBRE_ESTADO[o.estado]} />
                  {entrega(o)}
                </div>
              </div>
              <ChevronRight className="size-5 shrink-0 text-tinta-3" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

const TONO: Partial<Record<SituacionEntrega["tipo"], string>> = { atrasada: "font-medium text-negativo", por_vencer: "font-medium text-aviso" };

/** Bajo el estado: cuándo se prometió el carro, en rojo si ya pasó y en ámbar si se acerca. */
function Entrega({ o, ahora, minutosAviso }: { o: FilaOrden; ahora: Date; minutosAviso: number }) {
  if (o.estado === "entregado" || o.estado === "listo") return null;
  if (!o.entregaPrometida) return <p className="text-[13px] text-tinta-3">Entrega por definir</p>;
  const prometida = new Date(o.entregaPrometida);
  const s = situacionEntrega({ entregaPrometida: prometida, estado: o.estado }, ahora, minutosAviso);
  return (
    <p className={cn("text-[13px] whitespace-nowrap text-tinta-3", TONO[s.tipo])}>
      {s.tipo === "atrasada" ? "Atrasada · " : "Entrega "}
      {cuandoEntrega(prometida, ahora)}
    </p>
  );
}

export function GarantiaChip() {
  return (
    <span className="ml-2 inline-flex h-6 items-center gap-1 rounded-full bg-acento-suave px-2 align-middle text-[12px] font-medium text-tinta">
      <ShieldCheck className="size-3.5" aria-hidden />
      Garantía
    </span>
  );
}
