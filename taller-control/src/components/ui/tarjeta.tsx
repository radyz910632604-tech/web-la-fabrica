import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Tarjeta blanca, esquinas de 24 px, sombra casi imperceptible. */
export function Tarjeta({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-tarjeta bg-tarjeta p-5 shadow-reposo md:p-6", className)} {...props} />;
}

/** Tarjeta interna, gris muy suave. */
export function Interna({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-interna bg-interna p-4", className)} {...props} />;
}

export function CabeceraTarjeta({
  titulo,
  detalle,
  accion,
  nivel = 2,
  id,
}: {
  titulo: ReactNode;
  detalle?: ReactNode;
  accion?: ReactNode;
  nivel?: 2 | 3;
  id?: string;
}) {
  const Titulo = nivel === 2 ? "h2" : "h3";
  return (
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Titulo id={id} className="text-[17px] leading-6 font-semibold tracking-[-0.01em] text-tinta">
          {titulo}
        </Titulo>
        {detalle ? <p className="mt-0.5 text-sm text-tinta-3">{detalle}</p> : null}
      </div>
      {accion ? <div className="flex shrink-0 items-center gap-2">{accion}</div> : null}
    </header>
  );
}
