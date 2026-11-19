import Link from "next/link";
import { notFound } from "next/navigation";
import { CarFront, Search } from "lucide-react";
import { ListaOrdenes } from "@/components/taller/lista-ordenes";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { listarOrdenes } from "@/lib/taller/consultas";
import { ESTADOS_ORDEN, NOMBRE_ESTADO, type EstadoOrden, ESTADOS_ABIERTOS, ESTADOS_EN_TRABAJO } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

export const metadata = { title: "Órdenes" };

const PESTANAS: { clave: string; nombre: string; estados: EstadoOrden[] }[] = [
  { clave: "taller", nombre: "En el taller", estados: [...ESTADOS_ABIERTOS] },
  { clave: "entregas", nombre: "Por hora de entrega", estados: [...ESTADOS_EN_TRABAJO] },
  ...ESTADOS_ORDEN.map((e) => ({ clave: e, nombre: NOMBRE_ESTADO[e], estados: [e] })),
];

export default async function Ordenes({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen", "recepcion"])) notFound();
  const { ver = "taller", q = "" } = await searchParams;
  const pestana = PESTANAS.find((p) => p.clave === ver) ?? PESTANAS[0];
  const verCliente = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "recepcion"]);

  const todas = await listarOrdenes(ctx.taller.id, {
    estados: pestana.estados,
    orden: pestana.clave === "entregado" ? "reciente" : pestana.clave === "entregas" ? "entrega" : "ingreso",
    limite: pestana.clave === "entregado" ? 100 : 300,
  });
  const texto = q.trim().toLowerCase().replace(/-/g, "");
  const ordenes = texto
    ? todas.filter((o) =>
        [o.placa, o.vehiculo, o.servicios.join(" "), verCliente ? (o.cliente ?? "") : "", String(o.numero)].join(" ").toLowerCase().replace(/-/g, "").includes(texto),
      )
    : todas;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Órdenes</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
            {ordenes.length} {ordenes.length === 1 ? "orden" : "órdenes"} · {pestana.nombre.toLowerCase()}
          </p>
        </div>
        {verCliente ? (
          <Boton asChild>
            <Link href="/ordenes/nueva">
              <CarFront />
              Nuevo ingreso
            </Link>
          </Boton>
        ) : null}
      </header>

      <nav aria-label="Filtrar por estado" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0">
        <ul className="flex w-max gap-1 rounded-full bg-tarjeta p-1.5 shadow-reposo">
          {PESTANAS.map((p) => (
            <li key={p.clave}>
              <Link
                href={`/ordenes?ver=${p.clave}`}
                aria-current={p.clave === pestana.clave ? "page" : undefined}
                className={cn(
                  "presionable flex h-10 items-center rounded-full px-4 text-[15px] whitespace-nowrap",
                  p.clave === pestana.clave ? "bg-primario font-medium text-primario-tinta" : "text-tinta-2 hover:bg-interna hover:text-tinta",
                )}
              >
                {p.nombre}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Tarjeta aria-label="Lista de órdenes">
        <form className="relative mb-4" action="/ordenes">
          <input type="hidden" name="ver" value={pestana.clave} />
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-tinta-3" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder={verCliente ? "Buscar placa, cliente o servicio" : "Buscar placa o servicio"}
            aria-label="Buscar en las órdenes"
            className="h-12 w-full rounded-full border border-borde bg-tarjeta pr-4 pl-11 text-[15px] outline-none placeholder:text-tinta-3 focus-visible:border-tinta md:max-w-md"
          />
        </form>
        <ListaOrdenes
          ordenes={ordenes}
          verCliente={verCliente}
          fecha={pestana.clave === "entregado" ? "estado" : "ingreso"}
          minutosAviso={ctx.configuracion.minutosAvisoEntrega}
          vacio={texto ? "Ninguna orden coincide con la búsqueda." : "No hay órdenes en este estado."}
        />
      </Tarjeta>
    </div>
  );
}
