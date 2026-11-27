import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { HistorialCarro } from "@/components/taller/historial-carro";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { normalizarPlaca, formatearPlaca } from "@/lib/placas";
import { formatearSoles, ZONA } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { CARROCERIAS, NOMBRE_COMBUSTIBLE, TRANSMISIONES } from "@/lib/taller/estados";
import { historialDelCarro, resumenHistorial } from "@/lib/taller/historial";

export async function generateMetadata({ params }: { params: Promise<{ placa: string }> }) {
  return { title: formatearPlaca((await params).placa) };
}

export default async function Vehiculo({ params }: { params: Promise<{ placa: string }> }) {
  const ctx = await obtenerContexto();
  const placa = normalizarPlaca(decodeURIComponent((await params).placa));
  const supabase = await clienteServidor();
  const { data: v } = await supabase
    .from("vehiculos")
    .select("id, placa, marca, modelo, anio, color, combustible, transmision, carroceria, kilometraje_actual, clientes (id, nombre)")
    .eq("empresa_id", ctx.taller.id)
    .eq("placa", placa)
    .maybeSingle();
  if (!v) notFound();
  const verDinero = tieneAlguno(ctx.roles, CAJA);
  const ordenes = await historialDelCarro(ctx.taller.id, v.id, verDinero);
  const resumen = resumenHistorial(ordenes);
  const desde = resumen.primera ? new Intl.DateTimeFormat("es-PE", { timeZone: ZONA, month: "long", year: "numeric" }).format(new Date(resumen.primera)) : null;
  const cliente = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
  const verCliente = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes", "recepcion"]);
  const garantias = ordenes.filter((o) => o.garantia).length;

  const datos: [string, string][] = [
    ["Marca y modelo", [v.marca, v.modelo].filter(Boolean).join(" ") || "—"],
    ["Año", v.anio ? String(v.anio) : "—"],
    ["Color", v.color ?? "—"],
    ["Carrocería", v.carroceria ? ((CARROCERIAS as Record<string, string>)[v.carroceria] ?? v.carroceria) : "—"],
    ["Combustible", v.combustible ? (NOMBRE_COMBUSTIBLE[v.combustible] ?? v.combustible) : "—"],
    // La caja ya no se pide al ingresar; se muestra solo si un carro antiguo la tiene.
    ...(v.transmision ? ([["Caja", TRANSMISIONES[v.transmision as keyof typeof TRANSMISIONES]]] as [string, string][]) : []),
    ["Último kilometraje", v.kilometraje_actual != null ? `${v.kilometraje_actual.toLocaleString("es-PE")} km` : "—"],
    ["Con nosotros desde", desde ?? "—"],
    ...(resumen.recorrido ? ([["Recorrido entre visitas", `${resumen.recorrido.toLocaleString("es-PE")} km`]] as [string, string][]) : []),
    ...(verDinero && resumen.cobrado ? ([["Total cobrado", formatearSoles(resumen.cobrado)]] as [string, string][]) : []),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={verCliente && cliente ? `/clientes/${cliente.id}` : "/"} className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          {verCliente && cliente ? cliente.nombre : "Panel"}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Placa placa={v.placa} className="h-10 px-3 text-[19px]" />
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Historial del carro</h1>
          {tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "recepcion"]) ? <EnlacePdf href={`/pdf/historial/${v.placa}`} texto="Historial en PDF" boton className="md:ml-auto" /> : null}
        </div>
        <p className="text-[15px] text-tinta-2 md:text-base">
          {ordenes.length} {ordenes.length === 1 ? "visita" : "visitas"}
          {garantias ? ` · ${garantias} ${garantias === 1 ? "reingreso" : "reingresos"} por garantía` : ""}
          {verCliente && cliente ? ` · Dueño: ${cliente.nombre}` : ""}
        </p>
      </header>
      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <Tarjeta aria-labelledby="t-datos" className="self-start xl:col-span-4">
          <CabeceraTarjeta id="t-datos" titulo="Datos del carro" />
          <dl className="rounded-2xl bg-interna px-4 py-1 text-[15px]">
            {datos.map(([t, d]) => (
              <div key={t} className="flex justify-between gap-3 border-b border-borde py-3 last:border-b-0">
                <dt className="text-tinta-2">{t}</dt>
                <dd className="num text-right">{d}</dd>
              </div>
            ))}
          </dl>
        </Tarjeta>
        <Tarjeta aria-labelledby="t-visitas" className="min-w-0 xl:col-span-8">
          <CabeceraTarjeta id="t-visitas" titulo="Todo lo que se le hizo" detalle="Cada visita, de la más reciente a la más antigua" />
          <HistorialCarro visitas={ordenes} />
        </Tarjeta>
      </div>
    </div>
  );
}
