import { formatearPlaca } from "@/lib/placas";
import { cn } from "@/lib/utils";

/**
 * Placa del carro, dibujada como una placa: fondo blanco, borde oscuro,
 * franja superior y letras en mayúscula con cifras de ancho fijo.
 */
export function Placa({ placa, className }: { placa: string; className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex h-7 shrink-0 items-center rounded-[5px] border border-[#1a1a1a]/70 bg-white px-2 pt-[3px] text-[13px] leading-none font-semibold tracking-[0.06em] whitespace-nowrap text-[#1a1a1a] tabular-nums",
        className,
      )}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] rounded-t-[4px] bg-[#1a1a1a]/80" />
      {formatearPlaca(placa)}
    </span>
  );
}
