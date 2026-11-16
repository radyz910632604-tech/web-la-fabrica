import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, CircleCheck } from "lucide-react";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { NOMBRE_ALERTA, type Alerta } from "@/lib/alertas";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { alertasDelTaller } from "@/lib/taller/alertas-consultas";
import { cn } from "@/lib/utils";

export const metadata = { title: "Alertas" };

const GRUPOS: { severidad: Alerta["severidad"]; titulo: string; detalle: string; punto: string }[] = [
  { severidad: "urgente", titulo: "Urgente", detalle: "Dinero que se puede perder", punto: "bg-negativo" },
  { severidad: "atencion", titulo: "Atención", detalle: "Revísalo hoy", punto: "bg-aviso" },
  { severidad: "info", titulo: "Para revisar", detalle: "Cuando tengas un momento", punto: "bg-tinta-3" },
];

export default async function Alertas() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, [...CAJA, "almacen"])) notFound();
  const alertas = await alertasDelTaller(ctx.taller.id, {
    verDinero: tieneAlguno(ctx.roles, CAJA),
    verMargen: ctx.roles.includes("gerencia"),
  });
  const urgentes = alertas.filter((a) => a.severidad === "urgente").length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Alertas"
        detalle={
          alertas.length === 0
            ? "Nada pendiente."
            : `${alertas.length} ${alertas.length === 1 ? "alerta" : "alertas"}${urgentes ? `, ${urgentes} ${urgentes === 1 ? "urgente" : "urgentes"}` : ""}. Se actualizan solas al registrar lo que falta.`
        }
      />
      <SubnavCaja actual="/alertas" roles={ctx.roles} />
      {alertas.length === 0 ? (
        <Tarjeta>
          <p className="flex items-center gap-2 text-[15px] text-positivo">
            <CircleCheck className="size-5" aria-hidden />
            Todo en orden: no hay órdenes atrasadas, entregas sin comprobante ni deudas pendientes.
          </p>
        </Tarjeta>
      ) : (
        GRUPOS.map((g) => {
          const lista = alertas.filter((a) => a.severidad === g.severidad);
          if (lista.length === 0) return null;
          return (
            <Tarjeta key={g.severidad} aria-labelledby={`t-${g.severidad}`}>
              <CabeceraTarjeta id={`t-${g.severidad}`} titulo={`${g.titulo} (${lista.length})`} detalle={g.detalle} />
              <ul className="flex flex-col">
                {lista.map((a, i) => {
                  const contenido = (
                    <>
                      <span className={cn("mt-2 size-2 shrink-0 rounded-full", g.punto)} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium text-tinta-2">{NOMBRE_ALERTA[a.tipo]}</span>
                        <span className="block text-[15px]">{a.mensaje}</span>
                      </span>
                      {a.ordenId || a.href ? <ChevronRight className="mt-2 size-4 shrink-0 text-tinta-3" aria-hidden /> : null}
                    </>
                  );
                  return (
                    <li key={`${a.tipo}-${a.ordenId ?? i}-${i}`} className="border-t border-regla first:border-t-0">
                      {a.ordenId || a.href ? (
                        <Link href={a.href ?? `/ordenes/${a.ordenId}`} className="-mx-2 flex items-start gap-3 rounded-xl px-2 py-3 hover:bg-interna">
                          {contenido}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 py-3">{contenido}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Tarjeta>
          );
        })
      )}
    </div>
  );
}
