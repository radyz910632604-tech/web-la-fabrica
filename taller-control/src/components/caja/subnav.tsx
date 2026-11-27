import Link from "next/link";
import { cn } from "@/lib/utils";

const CAJA = ["gerencia", "administrador", "asesor", "recepcion"];
const ENLACES = [
  { href: "/caja", nombre: "Caja del día", roles: [...CAJA, "almacen"] },
  { href: "/caja/resumen", nombre: "Resumen", roles: CAJA },
  { href: "/caja/maestra", nombre: "Caja Maestra", roles: ["gerencia", "administrador"] },
  { href: "/cobros", nombre: "Cobros y deudas", roles: CAJA },
  { href: "/ventas", nombre: "Comprobantes", roles: CAJA },
  { href: "/compras", nombre: "Compras", roles: ["gerencia", "administrador", "asesor", "almacen"] },
  { href: "/cierre", nombre: "Cierre del día", roles: CAJA },
  { href: "/gastos", nombre: "Gastos del taller", roles: ["gerencia", "administrador"] },
];

/** Pestañas de la caja: cobros, comprobantes, compras, cierre y alertas. */
export function SubnavCaja({ actual, roles }: { actual: string; roles: string[] }) {
  const visibles = ENLACES.filter((e) => e.roles.some((r) => roles.includes(r)));
  if (visibles.length < 2) return null;
  return (
    <nav aria-label="Caja" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
      <ul className="flex w-max gap-1 rounded-full bg-tarjeta p-1.5 shadow-reposo">
        {visibles.map((e) => (
          <li key={e.href}>
            <Link
              href={e.href}
              aria-current={e.href === actual ? "page" : undefined}
              className={cn(
                "presionable flex h-10 items-center rounded-full px-4 text-[15px] whitespace-nowrap",
                e.href === actual ? "bg-primario font-medium text-primario-tinta" : "text-tinta-2 hover:bg-interna hover:text-tinta",
              )}
            >
              {e.nombre}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function TituloCaja({ titulo, detalle, accion }: { titulo: string; detalle: string; accion?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">{titulo}</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">{detalle}</p>
      </div>
      {accion}
    </header>
  );
}
