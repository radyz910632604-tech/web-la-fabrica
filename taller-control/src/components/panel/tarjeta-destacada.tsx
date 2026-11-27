import Link from "next/link";
import { Banknote, CarFront } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Placa } from "@/components/marca/placa";
import type { EstadoOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

/**
 * La tarjeta destacada: la única con el degradado naranja (especificación).
 * El texto va en negro: sobre este naranja el negro se lee (5:1) y el blanco no (3.4:1).
 */
// El degradado suave de la tarjeta destacada lo pide la especificación (sección 3).
const fondo = "bg-[linear-gradient(145deg,#f6714d_0%,var(--acento)_48%,var(--acento-hondo)_100%)] text-acento-tinta"; // taste-skill-ignore

/** Sobre el naranja, el botón principal es negro también en modo oscuro. */
const negroFijo = "bg-[#1a1a1a] text-white hover:bg-[#1a1a1a]/88";

type Carro = { id: string; placa: string; estado: EstadoOrden };

function Contenedor({ etiquetaId, children }: { etiquetaId: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={etiquetaId} className={cn("flex flex-col rounded-tarjeta p-5 md:p-6", fondo)}>
      {children}
    </section>
  );
}

function Cifra({ valor, uno, varios }: { valor: number; uno: string; varios: string }) {
  return (
    <p className="mt-2 flex items-baseline gap-2">
      <span className="num text-[44px] leading-none font-medium tracking-[-0.03em]">{valor}</span>
      <span className="text-[15px] font-medium">{valor === 1 ? uno : varios}</span>
    </p>
  );
}

function Conteo({ filas }: { filas: [string, number][] }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {filas.map(([nombre, valor]) => (
        <div key={nombre} className="flex items-baseline justify-between gap-2 border-b border-black/10 py-1.5">
          <dt>{nombre}</dt>
          <dd className="num font-semibold">{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Placas({ carros, etiqueta }: { carros: Carro[]; etiqueta: string }) {
  if (carros.length === 0) return null;
  const visibles = carros.slice(0, 6);
  return (
    <ul aria-label={etiqueta} className="mt-4 flex flex-wrap gap-1.5">
      {visibles.map((c) => (
        <li key={c.id}>
          <Link href={`/ordenes/${c.id}`} className="block rounded-[5px] focus-visible:outline-2 focus-visible:outline-[#1a1a1a]">
            <Placa placa={c.placa} />
          </Link>
        </li>
      ))}
      {carros.length > visibles.length ? (
        <li className="flex h-7 items-center rounded-[5px] bg-black/10 px-2 text-[13px] font-semibold">+{carros.length - visibles.length}</li>
      ) : null}
    </ul>
  );
}

const contar = (carros: Carro[], ...e: EstadoOrden[]) => carros.filter((c) => e.includes(c.estado)).length;

export function TarjetaTaller({ enTaller, acciones }: { enTaller: Carro[]; acciones: { nuevoIngreso: boolean; registrarPago: boolean } }) {
  return (
    <Contenedor etiquetaId="titulo-taller">
      <h2 id="titulo-taller" className="text-[15px] font-medium">
        Carros en taller hoy
      </h2>
      <Cifra valor={enTaller.length} uno="carro" varios="carros" />
      <Conteo
        filas={[
          ["En reparación", contar(enTaller, "en_proceso", "aprobado")],
          ["Listos", contar(enTaller, "listo")],
          ["Esperando", contar(enTaller, "esperando_repuesto", "espera_aprobacion")],
          ["En diagnóstico", contar(enTaller, "en_taller", "en_diagnostico")],
        ]}
      />
      {enTaller.length === 0 ? <p className="mt-4 text-[15px]">No hay carros en el taller. Registra el primer ingreso.</p> : null}
      <Placas carros={enTaller} etiqueta="Placas en el taller" />
      {acciones.nuevoIngreso || acciones.registrarPago ? (
        <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
          {acciones.nuevoIngreso ? (
            <Boton asChild className={cn("px-4", negroFijo)}>
              <Link href="/ordenes/nueva">
                <CarFront />
                Nuevo ingreso
              </Link>
            </Boton>
          ) : null}
          {acciones.registrarPago ? (
            <Boton asChild variante="blanco" className="px-4 text-[#1a1a1a] dark:bg-white dark:hover:bg-white/90">
              <Link href="/cobros?nuevo=1">
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

/** "1 listo · 6 en proceso": solo los estados que tienen carros. */
export function resumirEstados(carros: { estado: EstadoOrden }[]): string {
  const partes: [EstadoOrden, string, string][] = [
    ["listo", "listo", "listos"],
    ["en_proceso", "en reparación", "en reparación"],
    ["aprobado", "aprobado", "aprobados"],
    ["espera_aprobacion", "espera aprobación", "esperan aprobación"],
    ["esperando_repuesto", "espera repuestos", "esperan repuestos"],
    ["en_diagnostico", "en diagnóstico", "en diagnóstico"],
    ["en_taller", "recién ingresado", "recién ingresados"],
  ];
  return (
    partes
      .map(([estado, uno, varios]) => {
        const n = carros.filter((o) => o.estado === estado).length;
        return n > 0 ? `${n} ${n === 1 ? uno : varios}` : null;
      })
      .filter(Boolean)
      .join(" · ") || "ninguno por ahora"
  );
}

export function TarjetaMisTrabajos({ trabajos }: { trabajos: Carro[] }) {
  return (
    <Contenedor etiquetaId="titulo-trabajos">
      <h2 id="titulo-trabajos" className="text-[15px] font-medium">
        Mis trabajos de hoy
      </h2>
      <Cifra valor={trabajos.length} uno="carro" varios="carros" />
      <p className="mt-3 text-[15px]">{resumirEstados(trabajos)}</p>
      <Placas carros={trabajos} etiqueta="Placas asignadas" />
      <div className="mt-auto pt-5">
        <Boton asChild className={cn("w-full", negroFijo)}>
          <Link href="/mis-trabajos">Ver y reportar avances</Link>
        </Boton>
      </div>
    </Contenedor>
  );
}

export function TarjetaCitasHoy({ citas, puedeAgendar }: { citas: { estado: string }[]; puedeAgendar: boolean }) {
  const vivas = citas.filter((c) => c.estado !== "reagendada" && c.estado !== "cancelada");
  const n = (e: string) => citas.filter((c) => c.estado === e).length;
  return (
    <Contenedor etiquetaId="titulo-citas">
      <h2 id="titulo-citas" className="text-[15px] font-medium">
        Citas de hoy
      </h2>
      <Cifra valor={vivas.length} uno="cita" varios="citas" />
      <Conteo
        filas={[
          ["Llegaron", n("llego")],
          ["Por confirmar", n("agendada")],
          ["No llegaron", n("no_llego")],
          ["Confirmadas", n("confirmada")],
        ]}
      />
      <div className="mt-auto pt-5">
        <Boton asChild className={cn("w-full", negroFijo)}>
          <Link href={puedeAgendar ? "/citas?agendar=1" : "/citas"}>{puedeAgendar ? "Agendar cita" : "Confirmar citas"}</Link>
        </Boton>
      </div>
    </Contenedor>
  );
}
