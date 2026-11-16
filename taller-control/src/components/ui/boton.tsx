import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Botón píldora. Primario negro, secundario gris claro. Alto mínimo 48 px. */
export const estilosBoton = cva(
  "presionable inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-[18px] [&_svg]:shrink-0",
  {
    variants: {
      variante: {
        primario: "bg-primario text-primario-tinta hover:bg-primario/88",
        secundario: "bg-hundida text-tinta hover:bg-control/70",
        blanco: "bg-tarjeta text-tinta hover:bg-interna",
        fantasma: "text-tinta hover:bg-interna",
        peligro: "bg-negativo-fondo text-negativo hover:bg-negativo-fondo/70",
      },
      tamano: {
        normal: "h-12 px-6 text-[15px]",
        chico: "h-10 px-4 text-sm",
        icono: "size-12",
        "icono-chico": "size-10",
      },
    },
    defaultVariants: { variante: "primario", tamano: "normal" },
  },
);

export function Boton({
  className,
  variante,
  tamano,
  asChild = false,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof estilosBoton> & { asChild?: boolean }) {
  const Componente = asChild ? Slot.Root : "button";
  return <Componente className={cn(estilosBoton({ variante, tamano }), className)} {...props} />;
}
