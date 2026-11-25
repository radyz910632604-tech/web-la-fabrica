import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import { VentanaCliente } from "@/components/taller/formulario-cliente";
import { PestanasClientes } from "@/components/taller/pestanas-clientes";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { formatearMomento } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { ORIGENES_CLIENTE } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";

export const metadata = { title: "Clientes" };

type Fila = {
  id: string;
  nombre: string;
  celular: string;
  origen: keyof typeof ORIGENES_CLIENTE;
  acepta_mensajes: boolean;
  vehiculos: { placa: string }[];
  ordenes_trabajo: { ingresado_en: string; anulada: boolean }[];
};

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes", "confirmador", "recepcion"])) notFound();
  const { q = "", ver = "todos" } = await searchParams;
  const supabase = await clienteServidor();

  const [{ data }, { data: config }] = await Promise.all([
    supabase
      .from("clientes")
      .select("id, nombre, celular, origen, acepta_mensajes, vehiculos (placa), ordenes_trabajo (ingresado_en, anulada)")
      .eq("empresa_id", ctx.taller.id)
      .order("nombre")
      .limit(1000),
    supabase.from("configuracion_empresa").select("dias_cliente_inactivo").eq("empresa_id", ctx.taller.id).single(),
  ]);
  const diasInactivo = config?.dias_cliente_inactivo ?? 180;
  const ahora = new Date();
  const limite = ahora.getTime() - diasInactivo * 24 * 60 * 60 * 1000;

  const clientes = ((data ?? []) as Fila[]).map((c) => {
    const visitas = c.ordenes_trabajo.filter((o) => !o.anulada).map((o) => new Date(o.ingresado_en).getTime());
    const ultima = visitas.length ? Math.max(...visitas) : null;
    return { ...c, visitas: visitas.length, ultima, inactivo: ultima !== null && ultima < limite };
  });

  const texto = q.trim().toLowerCase();
  const digitos = texto.replace(/\D/g, "");
  const filtrados = clientes.filter((c) => {
    if (ver === "inactivos" && !c.inactivo) return false;
    if (!texto) return true;
    return (
      c.nombre.toLowerCase().includes(texto) ||
      (digitos.length >= 3 && c.celular.includes(digitos)) ||
      c.vehiculos.some((v) => v.placa.toLowerCase().includes(texto.replace(/[^a-z0-9]/g, "")))
    );
  });
  const inactivos = clientes.filter((c) => c.inactivo).length;
  // Mantenimientos que ya tocan (o tocan en 15 días): WhatsApp a quien aceptó; a los demás, llamarlos.
  const en15 = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(ahora.getTime() + 15 * 86400_000));
  const { data: tocan } = await supabase
    .from("recordatorios_mantenimiento")
    .select("id, servicio, fecha_objetivo, km_objetivo, estado, clientes (id, nombre, celular, acepta_mensajes), vehiculos (placa)")
    .eq("empresa_id", ctx.taller.id)
    .in("estado", ["pendiente", "enviado"])
    .lte("fecha_objetivo", en15)
    .order("fecha_objetivo")
    .limit(40);
  const puedeCrear = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes"]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes"]) ? <PestanasClientes actual="clientes" /> : null}
      <header className="-mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Clientes</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
            {clientes.length} {clientes.length === 1 ? "cliente" : "clientes"} en {ctx.taller.nombre}
            {inactivos ? ` · ${inactivos} no vienen hace más de ${diasInactivo} días` : ""}.
          </p>
        </div>
        {puedeCrear ? <VentanaCliente /> : null}
      </header>

      <nav aria-label="Filtrar clientes">
        <ul className="flex w-max gap-1 rounded-full bg-tarjeta p-1.5 shadow-reposo">
          {[
            ["todos", "Todos"],
            ["inactivos", `Inactivos · ${inactivos}`],
          ].map(([clave, nombre]) => (
            <li key={clave}>
              <Link
                href={`/clientes?ver=${clave}`}
                aria-current={ver === clave ? "page" : undefined}
                className={cn(
                  "presionable flex h-10 items-center rounded-full px-4 text-[15px]",
                  ver === clave ? "bg-primario font-medium text-primario-tinta" : "text-tinta-2 hover:bg-interna",
                )}
              >
                {nombre}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Tarjeta aria-label="Lista de clientes">
        <form className="relative mb-4" action="/clientes">
          <input type="hidden" name="ver" value={ver} />
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-tinta-3" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Buscar por nombre, celular o placa"
            aria-label="Buscar clientes"
            className="h-12 w-full rounded-full border border-borde bg-tarjeta pr-4 pl-11 text-[15px] outline-none placeholder:text-tinta-3 focus-visible:border-tinta md:max-w-md"
          />
        </form>
        {filtrados.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">
            {clientes.length === 0 ? "Todavía no hay clientes. Se crean solos al registrar un ingreso." : "Ningún cliente coincide."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtrados.map((c) => (
              <li key={c.id} className="border-t border-regla first:border-t-0">
                <Link href={`/clientes/${c.id}`} className="flex items-center gap-4 rounded-2xl px-1 py-3 hover:bg-interna/60 md:px-3">
                  <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_120px] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-medium">{c.nombre}</p>
                      <p className="num text-[13px] text-tinta-3">{formatearCelular(c.celular)}</p>
                    </div>
                    <p className="truncate text-[14px] text-tinta-2">
                      {c.vehiculos.map((v) => v.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")).join(", ") || "Sin carros"}
                    </p>
                    <p className="text-[14px] text-tinta-2">
                      {c.visitas} {c.visitas === 1 ? "visita" : "visitas"} · {ORIGENES_CLIENTE[c.origen]}
                    </p>
                    <p className={cn("num text-[13px] md:text-right", c.inactivo ? "text-negativo" : "text-tinta-3")}>
                      {c.ultima ? formatearMomento(new Date(c.ultima), ahora).replace(/ \d\d:\d\d$/, "") : "Sin visitas"}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-tinta-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
      {tocan?.length && ver === "todos" && !q ? (
        <Tarjeta aria-labelledby="t-mantenimientos">
          <CabeceraTarjeta id="t-mantenimientos" titulo="Mantenimientos que tocan" detalle="Según el último servicio. A quien aceptó mensajes le llega un WhatsApp; a los demás, llámalos." />
          <ul className="flex flex-col">
            {tocan.map((r) => {
              const c = Array.isArray(r.clientes) ? r.clientes[0] : r.clientes;
              const v = Array.isArray(r.vehiculos) ? r.vehiculos[0] : r.vehiculos;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-regla py-3 first:border-t-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">
                      {c?.nombre} <span className="font-normal text-tinta-2">· {v?.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}</span>
                    </p>
                    <p className="text-[13px] text-tinta-3">
                      {r.servicio} · desde el {r.fecha_objetivo.split("-").reverse().join("/")}
                      {r.km_objetivo ? ` o a los ${r.km_objetivo.toLocaleString("es-PE")} km` : ""}
                    </p>
                  </div>
                  <p className="num text-[13px] text-tinta-2">
                    {r.estado === "enviado" ? "WhatsApp enviado" : c?.acepta_mensajes ? "Se enviará por WhatsApp" : `Llamar al ${c ? formatearCelular(c.celular) : ""}`}
                  </p>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      ) : null}
    </div>
  );
}
