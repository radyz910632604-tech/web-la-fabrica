import { FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Abre el PDF en otra pestaña: desde ahí se descarga, imprime o comparte (también en iPhone). */
export function EnlacePdf({ href, texto = "PDF", className, boton = false }: { href: string; texto?: string; className?: string; boton?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        boton
          ? "presionable inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-hundida px-4 text-sm font-medium whitespace-nowrap hover:bg-control/70 [&_svg]:size-[18px]"
          : "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[13px] text-tinta-2 hover:bg-interna hover:text-tinta [&_svg]:size-3.5",
        className,
      )}
    >
      <FileDown aria-hidden />
      {texto}
    </a>
  );
}
