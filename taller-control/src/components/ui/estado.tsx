import { cn } from "@/lib/utils";

const PUNTO = {
  verde: "bg-[var(--punto-verde)]",
  amarillo: "bg-[var(--punto-amarillo)]",
  rojo: "bg-[var(--punto-rojo)]",
  gris: "bg-[var(--punto-gris)]",
} as const;

export type ColorEstado = keyof typeof PUNTO;

/** Estado con punto de color y texto en tinta. */
export function Estado({ color, texto, className }: { color: ColorEstado; texto: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 whitespace-nowrap", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", PUNTO[color])} />
      {texto}
    </span>
  );
}
