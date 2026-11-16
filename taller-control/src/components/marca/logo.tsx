import { cn } from "@/lib/utils";

/**
 * Marca de Taller Control: un medidor (el tablero del carro) dentro de un
 * círculo naranja. La aguja apunta arriba a la derecha: todo bajo control.
 */
export function MarcaLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-10 shrink-0", className)} aria-hidden>
      <circle cx="20" cy="20" r="20" fill="var(--acento)" />
      <path d="M10.5 25.5a10 10 0 1 1 19 0" fill="none" stroke="#1a1a1a" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M20 22.5 26.2 14" fill="none" stroke="#1a1a1a" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="20" cy="22.5" r="2.6" fill="#1a1a1a" />
    </svg>
  );
}

export function Logo({ className, conTexto = true }: { className?: string; conTexto?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <MarcaLogo />
      {conTexto ? (
        <span className="text-[17px] leading-none font-semibold tracking-[-0.02em] whitespace-nowrap text-tinta">
          Taller Control
        </span>
      ) : null}
    </span>
  );
}
