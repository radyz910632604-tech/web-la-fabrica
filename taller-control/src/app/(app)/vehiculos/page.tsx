import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { PestanasClientes } from "@/components/taller/pestanas-clientes";
import { Estado } from "@/components/ui/estado";
import { Tarjeta } from "@/components/ui/tarjeta";
import { formatearMomento } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { COLOR_ESTADO, esAbierto, NOMBRE_ESTADO, type EstadoOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

export const metadata = { title: "Carros" };

/** Todos los carros que pasaron por el taller; cada uno abre su historial. */
export default async function Carros({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes"])) notFound();
  const { q = "", ver = "todos" } = await searchParams;
  const supabase = await clienteServidor();
  const [{ data: carros }, { data: ordenes }] = await Promise.all([
    supabase.from("vehiculos").select("id, placa, marca, modelo, anio, kilometraje_actual, clientes (nombre)").eq("empresa_id", ctx.taller.id).limit(3000),
    supabase.from("ordenes_trabajo").select("vehiculo_id, ingresado_en, estado").eq("empresa_id", ctx.taller.id).eq("anulada", false).order("ingresado_en", { ascending: false }).limit(10000),
  ]);
  const visitas = new Map<string, { n: number; ultima: string; abierta: EstadoOrden | null }>();
  for (const o of ordenes ?? []) {
    const v = visitas.get(o.vehiculo_id) ?? { n: 0, ultima: o.ingresado_en, abierta: null };
    v.n++;
    if (!v.abierta && esAbierto(o.estado)) v.abierta = o.estado as EstadoOrden;
    visitas.set(o.vehiculo_id, v);
  }
  const lista = (carros ?? [])
    .map((c) => {
      const dueno = (Array.isArray(c.clientes) ? c.clientes[0] : c.clientes) as { nombre: string } | null;
      return { ...c, dueno: dueno?.nombre ?? null, ...(visitas.get(c.id) ?? { n: 0, ultima: null, abierta: null }) };
    })
    .sort((a, b) => (b.ultima ?? "").localeCompare(a.ultima ?? "") || a.placa.localeCompare(b.placa));
  const enTaller = lista.filter((c) => c.abierta).length;
  const texto = q.trim().toLowerCase();
  const sinGuion = texto.replace(/[^a-z0-9]/g, "");
  const filtrados = lista.filter((c) => {
    if (ver === "taller" && !c.abierta) return false;
    if (!texto) return true;
    return (sinGuion.length >= 2 && c.placa.toLowerCase().includes(sinGuion)) || [c.marca, c.modelo, c.dueno].some((x) => x?.toLowerCase().includes(texto));
  });
  const ahora = new Date();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-4">
        <PestanasClientes actual="carros" />
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Carros</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
            {lista.length} {lista.length === 1 ? "carro" : "carros"} en {ctx.taller.nombre}
            {enTaller ? ` · ${enTaller} en el taller ahora` : ""}. Toca uno para ver todo lo que se le hizo.
          </p>
        </div>
      </header>

      <nav aria-label="Filtrar carros">
        <ul className="flex w-max gap-1 rounded-full bg-tarjeta p-1.5 shadow-reposo">
          {[
            ["todos", "Todos"],
            ["taller", `En el taller · ${enTaller}`],
          ].map(([clave, nombre]) => (
            <li key={clave}>
              <Link
                href={`/vehiculos?ver=${clave}`}
                aria-current={ver === clave ? "page" : undefined}
                className={cn("presionable flex h-10 items-center rounded-full px-4 text-[15px]", ver === clave ? "bg-primario font-medium text-primario-tinta" : "text-tinta-2 hover:bg-interna")}
              >
                {nombre}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Tarjeta aria-label="Lista de carros">
        <form className="relative mb-4" action="/vehiculos">
          <input type="hidden" name="ver" value={ver} />
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-tinta-3" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por placa, marca, modelo o dueño"
            aria-label="Buscar carros"
            className="h-12 w-full rounded-full border border-borde bg-tarjeta pr-4 pl-11 text-[15px] outline-none placeholder:text-tinta-3 focus-visible:border-tinta md:max-w-md"
          />
        </form>
        {filtrados.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">
            {lista.length === 0 ? "Todavía no hay carros. Se crean solos al registrar un ingreso o al importar tu Excel." : "Ningún carro coincide."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtrados.slice(0, 300).map((c) => (
              <li key={c.id} className="border-t border-regla first:border-t-0">
                <Link href={`/vehiculos/${c.placa}`} className="flex items-center gap-4 rounded-2xl px-1 py-3 hover:bg-interna/60 md:px-3">
                  <Placa placa={c.placa} className="h-8 shrink-0 px-2.5 text-[15px]" />
                  <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_150px] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{[c.marca, c.modelo, c.anio].filter(Boolean).join(" ") || "Sin marca ni modelo"}</p>
                      <p className="truncate text-[13px] text-tinta-3">{c.dueno ?? "Sin dueño registrado"}</p>
                    </div>
                    <p className="text-[14px] text-tinta-2">
                      {c.n} {c.n === 1 ? "visita" : "visitas"}
                      {c.kilometraje_actual != null ? ` · ${c.kilometraje_actual.toLocaleString("es-PE")} km` : ""}
                    </p>
                    <div className="text-[14px] text-tinta-2">{c.abierta ? <Estado color={COLOR_ESTADO[c.abierta]} texto={NOMBRE_ESTADO[c.abierta]} /> : null}</div>
                    <p className="num text-[13px] text-tinta-3 md:text-right">{c.ultima ? `Última: ${formatearMomento(new Date(c.ultima), ahora).replace(/ \d\d:\d\d$/, "")}` : "Sin visitas"}</p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-tinta-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {filtrados.length > 300 ? <p className="mt-3 text-sm text-tinta-3">Se muestran los 300 más recientes. Busca por placa para encontrar los demás.</p> : null}
      </Tarjeta>
    </div>
  );
}
