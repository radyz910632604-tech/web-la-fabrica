import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CarFront, Phone } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { VentanaCliente } from "@/components/taller/formulario-cliente";
import { ListaOrdenes } from "@/components/taller/lista-ordenes";
import { Boton } from "@/components/ui/boton";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { DOCUMENTOS, ORIGENES_CLIENTE } from "@/lib/taller/estados";

export const metadata = { title: "Cliente" };

export default async function Cliente({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContexto();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await clienteServidor();
  const { data: c } = await supabase
    .from("clientes")
    .select("id, nombre, celular, tipo_documento, numero_documento, origen, acepta_mensajes, acepta_mensajes_en, notas, creado_en")
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!c) notFound();

  const [{ data: vehiculos }, ordenes] = await Promise.all([
    supabase.from("vehiculos").select("id, placa, marca, modelo, anio").eq("cliente_id", id).order("placa"),
    tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen", "recepcion"]) ? listarOrdenes(ctx.taller.id, { clienteId: id, orden: "ingreso" }) : Promise.resolve([]),
  ]);
  const puedeEditar = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes"]);
  const puedeIngresar = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]);
  const fechaPermiso = c.acepta_mensajes_en
    ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "numeric", month: "short", year: "numeric" }).format(new Date(c.acepta_mensajes_en))
    : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href="/clientes" className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Clientes
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">{c.nombre}</h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-tinta-2">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-4" aria-hidden />
                <span className="num select-all">{formatearCelular(c.celular)}</span>
              </span>
              <span>{ORIGENES_CLIENTE[c.origen as keyof typeof ORIGENES_CLIENTE]}</span>
              <span>
                {ordenes.length} {ordenes.length === 1 ? "visita" : "visitas"}
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            {puedeEditar ? (
              <VentanaCliente
                valores={{
                  id: c.id,
                  nombre: c.nombre,
                  celular: formatearCelular(c.celular),
                  tipoDocumento: c.tipo_documento,
                  numeroDocumento: c.numero_documento,
                  origen: c.origen,
                  aceptaMensajes: c.acepta_mensajes,
                  notas: c.notas,
                }}
              />
            ) : null}
            {puedeIngresar ? (
              <Boton asChild>
                <Link href="/ordenes/nueva">
                  <CarFront />
                  Nuevo ingreso
                </Link>
              </Boton>
            ) : null}
          </div>
        </div>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <Tarjeta aria-labelledby="t-datos">
            <CabeceraTarjeta id="t-datos" titulo="Datos" />
            <dl className="rounded-2xl bg-interna px-4 py-1 text-[15px]">
              {[
                ["Documento", c.tipo_documento === "ninguno" ? "Sin documento" : `${DOCUMENTOS[c.tipo_documento as keyof typeof DOCUMENTOS]} ${c.numero_documento}`],
                ["Mensajes", c.acepta_mensajes ? `Acepta desde ${fechaPermiso}` : "No acepta"],
                ["Total gastado", "Disponible en la Fase 3"],
              ].map(([t, d]) => (
                <div key={t} className="flex justify-between gap-3 border-b border-borde py-3 last:border-b-0">
                  <dt className="text-tinta-2">{t}</dt>
                  <dd className="text-right">{d}</dd>
                </div>
              ))}
            </dl>
            {c.notas ? <p className="mt-3 text-[15px] whitespace-pre-line text-tinta-2">{c.notas}</p> : null}
          </Tarjeta>
          <Tarjeta aria-labelledby="t-carros">
            <CabeceraTarjeta id="t-carros" titulo="Sus carros" />
            {(vehiculos ?? []).length === 0 ? (
              <p className="text-sm text-tinta-2">Todavía no tiene carros registrados.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(vehiculos ?? []).map((v) => (
                  <li key={v.id}>
                    <Link href={`/vehiculos/${v.placa}`} className="flex items-center gap-3 rounded-2xl bg-interna px-3 py-2.5 hover:bg-hundida">
                      <Placa placa={v.placa} />
                      <span className="truncate text-[15px]">{[v.marca, v.modelo, v.anio].filter(Boolean).join(" ") || "Sin datos"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>
        </div>
        <div className="min-w-0 xl:col-span-8">
          <Tarjeta aria-labelledby="t-visitas">
            <CabeceraTarjeta id="t-visitas" titulo="Visitas" detalle="Cada ingreso al taller" />
            <ListaOrdenes ordenes={ordenes} verCliente={false} fecha="ingreso" vacio="Este cliente todavía no tiene visitas." />
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
