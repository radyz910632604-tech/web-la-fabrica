import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { ListaOrdenes } from "@/components/taller/lista-ordenes";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { normalizarPlaca, formatearPlaca } from "@/lib/placas";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { COMBUSTIBLES, TRANSMISIONES } from "@/lib/taller/estados";

export async function generateMetadata({ params }: { params: Promise<{ placa: string }> }) {
  return { title: formatearPlaca((await params).placa) };
}

export default async function Vehiculo({ params }: { params: Promise<{ placa: string }> }) {
  const ctx = await obtenerContexto();
  const placa = normalizarPlaca(decodeURIComponent((await params).placa));
  const supabase = await clienteServidor();
  const { data: v } = await supabase
    .from("vehiculos")
    .select("id, placa, marca, modelo, anio, color, combustible, transmision, kilometraje_actual, clientes (id, nombre)")
    .eq("empresa_id", ctx.taller.id)
    .eq("placa", placa)
    .maybeSingle();
  if (!v) notFound();
  const ordenes = await listarOrdenes(ctx.taller.id, { vehiculoId: v.id, orden: "ingreso" });
  const cliente = Array.isArray(v.clientes) ? v.clientes[0] : v.clientes;
  const verCliente = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes", "recepcion"]);
  const garantias = ordenes.filter((o) => o.garantia).length;

  const datos: [string, string][] = [
    ["Marca y modelo", [v.marca, v.modelo].filter(Boolean).join(" ") || "—"],
    ["Año", v.anio ? String(v.anio) : "—"],
    ["Color", v.color ?? "—"],
    ["Combustible", v.combustible ? COMBUSTIBLES[v.combustible as keyof typeof COMBUSTIBLES] : "—"],
    ["Caja", v.transmision ? TRANSMISIONES[v.transmision as keyof typeof TRANSMISIONES] : "—"],
    ["Último kilometraje", v.kilometraje_actual != null ? `${v.kilometraje_actual.toLocaleString("es-PE")} km` : "—"],
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
        <Tarjeta aria-labelledby="t-datos" className="xl:col-span-4">
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
          <CabeceraTarjeta id="t-visitas" titulo="Visitas" detalle="De la más reciente a la más antigua" />
          <ListaOrdenes ordenes={ordenes} verCliente={false} fecha="ingreso" vacio="Este carro no tiene visitas." />
        </Tarjeta>
      </div>
    </div>
  );
}
