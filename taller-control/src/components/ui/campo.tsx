import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/lib/utils";

const estiloControl =
  "h-12 w-full rounded-2xl border border-borde bg-tarjeta px-4 text-[15px] text-tinta placeholder:text-tinta-3 transition-[border-color,box-shadow] duration-150 outline-none focus-visible:border-tinta focus-visible:ring-4 focus-visible:ring-acento/15 focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-negativo";

export function Entrada({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(estiloControl, className)} {...props} />;
}

export function Selector({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        estiloControl,
        "appearance-none bg-[length:16px] bg-[right_14px_center] bg-no-repeat pr-10",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b6b6b%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')]",
        className,
      )}
      {...props}
    />
  );
}

/** Etiqueta arriba, control, ayuda o error debajo (atados con aria-describedby). */
export function Campo({
  etiqueta,
  ayuda,
  error,
  className,
  children,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  error?: string;
  className?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode;
}) {
  const id = useId();
  const idNota = `${id}-nota`;
  const tieneNota = Boolean(ayuda || error);
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium text-tinta">
        {etiqueta}
      </label>
      {children({ id, "aria-describedby": tieneNota ? idNota : undefined, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={idNota} className="text-sm text-negativo">
          {error}
        </p>
      ) : ayuda ? (
        <p id={idNota} className="text-sm text-tinta-3">
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}
