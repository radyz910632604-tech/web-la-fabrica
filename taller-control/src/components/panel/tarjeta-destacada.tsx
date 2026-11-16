import Link from "next/link";
import { Banknote, CarFront } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Placa } from "@/components/marca/placa";
import type { CitaEjemplo, EstadoOrden, OrdenEjemplo } from "@/lib/panel/ejemplo";
import { cn } from "@/lib/utils";

/**
 * La tarjeta destacada: la única con el degradado naranja (especificación).
 * El texto va en negro: sobre este naranja el negro se lee (5:1) y el blanco no (3.4:1).
 */
// El degradado suave de la tarjeta destacada lo pide la especificación (sección 3).
const fondo = "bg-[linear-gradient(145deg,#f6714d_0%,var(--acento)_48%,var(--acento-hondo)_100%)] text-acento-tinta"; // taste-skill-ignore

/** Sobre el naranja, el botón principal es negro también en modo oscuro. */
const negroFijo = "bg-[#1a1a1a] text-white hover:bg-[#1a1a1a]/88";

function Contenedor({ etiquetaId, children }: { etiquetaId: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={etiquetaId} className={cn("flex flex-col rounded-tarjeta p-5 md:p-6", fondo)}>
      {children}
    </section>
  );
}

function Cifra({ valor, unidad }: { valor: number; unidad: string }) {
  return (
    <p className="mt-2 flex items-baseline gap-2">
      <span className="num text-[44px] leading-none font-medium tracking-[-0.03em]">{valor}</span>
      <span className="text-[15px] font-medium">{unidad}</span>
    </p>
  );
}

const ORDEN_ESTADOS: Exclude<EstadoOrden, "entregado">[] = ["en_proceso", "listo", "esperando_repuesto", "en_taller"];

/** Dentro de "Carros en taller", el estado en_taller se lee mejor como "sin empezar". */
const ETIQUETA_CORTA: Record<Exclude<EstadoOrden, "entregado">, string> = {
  en_proceso: "En proceso",
  listo: "Listos",
  esperando_repuesto: "Esperan repuesto",
  en_taller: "Sin empezar",
};

export function TarjetaTaller({
  enTaller,
  conteo,
  acciones,
}: {
  enTaller: OrdenEjemplo[];
  conteo: Record<Exclude<EstadoOrden, "entregado">, number>;
  acciones: { nuevoIngreso: boolean; registrarPago: boolean };
}) {
  const visibles = enTaller.slice(0, 6);
  const restantes = enTaller.length - visibles.length;
  return (
    <Contenedor etiquetaId="titulo-taller">
      <h2 id="titulo-taller" className="text-[15px] font-medium">
        Carros en taller hoy
      </h2>
      <Cifra valor={enTaller.length} unidad={enTaller.length === 1 ? "carro" : "carros"} />

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {ORDEN_ESTADOS.map((estado) => (
          <div key={estado} className="flex items-baseline justify-between gap-2 border-b border-black/10 py-1.5">
            <dt>{ETIQUETA_CORTA[estado]}</dt>
            <dd className="num font-semibold">{conteo[estado]}</dd>
          </div>
        ))}
      </dl>

      <ul aria-label="Placas en el taller" className="mt-4 flex flex-wrap gap-1.5">
        {visibles.map((o) => (
          <li key={o.numero}>
            <Placa placa={o.placa} />
          </li>
        ))}
        {restantes > 0 ? (
          <li className="flex h-7 items-center rounded-[5px] bg-black/10 px-2 text-[13px] font-semibold">+{restantes}</li>
        ) : null}
      </ul>

      {acciones.nuevoIngreso || acciones.registrarPago ? (
        <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
          {acciones.nuevoIngreso ? (
            <Boton asChild className={cn("px-4", negroFijo)}>
              <Link href="/pronto/nuevo-ingreso">
                <CarFront />
                Nuevo ingreso
              </Link>
            </Boton>
          ) : null}
          {acciones.registrarPago ? (
            <Boton asChild variante="blanco" className="px-4 text-[#1a1a1a] dark:bg-white dark:hover:bg-white/90">
              <Link href="/pronto/registrar-pago">
                <Banknote />
                Registrar pago
              </Link>
            </Boton>
          ) : null}
        </div>
      ) : null}
    </Contenedor>
  );
}

export function TarjetaMisTrabajos({ trabajos }: { trabajos: OrdenEjemplo[] }) {
  const resumen = resumirEstados(trabajos);
  return (
    <Contenedor etiquetaId="titulo-trabajos">
      <h2 id="titulo-trabajos" className="text-[15px] font-medium">
        Mis trabajos de hoy
      </h2>
      <Cifra valor={trabajos.length} unidad={trabajos.length === 1 ? "carro" : "carros"} />
      <p className="mt-3 text-[15px]">{resumen}</p>
      <ul aria-label="Placas asignadas" className="mt-4 flex flex-wrap gap-1.5">
        {trabajos.map((o) => (
          <li key={o.numero}>
            <Placa placa={o.placa} />
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-5">
        <Boton asChild className={cn("w-full", negroFijo)}>
          <Link href="/pronto/reportar-avance">Reportar avance</Link>
        </Boton>
      </div>
    </Contenedor>
  );
}

export function TarjetaCitasHoy({ citas, puedeAgendar }: { citas: CitaEjemplo[]; puedeAgendar: boolean }) {
  const llegaron = citas.filter((c) => c.estado === "llego").length;
  const porConfirmar = citas.filter((c) => c.estado === "agendada").length;
  const noLlegaron = citas.filter((c) => c.estado === "no_llego").length;
  const filas = [
    ["Llegaron", llegaron],
    ["Por confirmar", porConfirmar],
    ["No llegaron", noLlegaron],
    ["Confirmadas", citas.filter((c) => c.estado === "confirmada").length],
  ] as const;
  return (
    <Contenedor etiquetaId="titulo-citas">
      <h2 id="titulo-citas" className="text-[15px] font-medium">
        Citas de hoy
      </h2>
      <Cifra valor={citas.length} unidad={citas.length === 1 ? "cita" : "citas"} />
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {filas.map(([nombre, valor]) => (
          <div key={nombre} className="flex items-baseline justify-between gap-2 border-b border-black/10 py-1.5">
            <dt>{nombre}</dt>
            <dd className="num font-semibold">{valor}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-auto pt-5">
        <Boton asChild className={cn("w-full", negroFijo)}>
          <Link href={puedeAgendar ? "/pronto/agendar-cita" : "/pronto/confirmar-citas"}>
            {puedeAgendar ? "Agendar cita" : "Confirmar citas"}
          </Link>
        </Boton>
      </div>
    </Contenedor>
  );
}

/** "1 listo · 6 en proceso": solo los estados que tienen carros. */
export function resumirEstados(ordenes: OrdenEjemplo[]): string {
  const partes: [EstadoOrden, string, string][] = [
    ["listo", "listo", "listos"],
    ["en_proceso", "en proceso", "en proceso"],
    ["esperando_repuesto", "espera repuesto", "esperan repuesto"],
    ["en_taller", "sin empezar", "sin empezar"],
  ];
  return partes
    .map(([estado, uno, varios]) => {
      const n = ordenes.filter((o) => o.estado === estado).length;
      return n > 0 ? `${n} ${n === 1 ? uno : varios}` : null;
    })
    .filter(Boolean)
    .join(" · ");
}
