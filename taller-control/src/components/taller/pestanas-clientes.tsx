import Link from "next/link";
import { cn } from "@/lib/utils";

/** Clientes y Carros son dos vistas de la misma sección: se cambia con estas pestañas. */
export function PestanasClientes({ actual }: { actual: "clientes" | "carros" }) {
  return (
    <nav aria-label="Clientes o carros">
      <ul className="flex w-max gap-1 rounded-full bg-hundida p-1">
        {[
          ["clientes", "Clientes", "/clientes"],
          ["carros", "Carros", "/vehiculos"],
        ].map(([clave, nombre, href]) => (
          <li key={clave}>
            <Link
              href={href}
              aria-current={actual === clave ? "page" : undefined}
              className={cn(
                "presionable flex h-9 items-center rounded-full px-4 text-[15px]",
                actual === clave ? "bg-tarjeta font-medium text-tinta shadow-reposo" : "text-tinta-2 hover:text-tinta",
              )}
            >
              {nombre}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
