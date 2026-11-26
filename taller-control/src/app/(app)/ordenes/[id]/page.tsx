import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarCheck, Phone } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { GarantiaChip } from "@/components/taller/lista-ordenes";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { Estado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { TarjetaDinero, TarjetaRepuestos, TarjetaUtilidad } from "@/components/caja/tarjeta-dinero";
import { diaEnLima, formatearMomento } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogo, nombresPersonal, personalConRol } from "@/lib/taller/consultas";
import { configDinero, dineroDeOrden } from "@/lib/taller/dinero-consultas";
import { COLOR_ESTADO, COMBUSTIBLES, enTrabajo, etiquetaOrden, nombreEstado, NOMBRE_ESTADO, numeroOrden, TRANSMISIONES, type EstadoOrden } from "@/lib/taller/estados";
import { listarRepuestos } from "@/lib/taller/inventario-consultas";
import { colorSituacion, cuandoEntrega, partesLima, situacionEntrega, textoSituacion } from "@/lib/taller/entrega";
import { SacarDelInventario } from "../../inventario/controles";
import { FirmarCliente } from "@/components/taller/firma-cliente";
import { AgregarServicio, AsignarTecnico, BotonesEstado, CambiarEntrega, FormAvance, FormDiagnostico, SubirFotos } from "./controles";
import { guardarFirma } from "./firma-acciones";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await clienteServidor();
  const { id } = await params;
  const { data } = await supabase.from("ordenes_trabajo").select("numero").eq("id", id).maybeSingle();
  return { title: data ? numeroOrden(data.numero) : "Orden" };
}

export default async function Orden({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ "fotos-fallidas"?: string }> }) {
  const ctx = await obtenerContexto();
  const { id } = await params;
  const { "fotos-fallidas": fallidas } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await clienteServidor();

  const { data: o } = await supabase
    .from("ordenes_trabajo")
    .select(
      "id, numero, estado, tecnico_id, cita_id, kilometraje_ingreso, observaciones_ingreso, ingresado_en, listo_en, entregado_en, entrega_prometida, entrega_reprogramada, es_reingreso_garantia, orden_garantia_origen_id, firma_ingreso_ruta, firma_ingreso_en, firma_entrega_ruta, firma_entrega_en, diagnostico, diagnostico_en, facturado_en, vehiculos (placa, marca, modelo, anio, color, combustible, transmision), clientes (id, nombre, celular)",
    )
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!o) notFound();

  const [{ data: servicios }, { data: historial }, { data: avances }, { data: archivos }, nombres, tecnicos, servCatalogo] = await Promise.all([
    supabase.from("orden_servicios").select("id, descripcion, es_adicional").eq("orden_id", id).order("creado_en"),
    supabase.from("orden_estados_historial").select("id, estado_anterior, estado_nuevo, nota, cambiado_por, cambiado_en").eq("orden_id", id).order("cambiado_en", { ascending: false }),
    supabase.from("orden_avances").select("id, texto, autor_id, creado_en").eq("orden_id", id).order("creado_en", { ascending: false }),
    supabase.from("archivos").select("id, ruta, etapa, creado_en").eq("orden_id", id).eq("tipo", "foto").order("creado_en"),
    nombresPersonal(ctx.taller.id),
    tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]) ? personalConRol(ctx.taller.id, "tecnico") : Promise.resolve([]),
    tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]) ? catalogo(ctx.taller.id) : Promise.resolve([]),
  ]);

  const rutasFirma = [o.firma_ingreso_ruta, o.firma_entrega_ruta].filter(Boolean) as string[];
  const rutas = [...(archivos ?? []).map((a) => a.ruta), ...rutasFirma];
  const firmadas = rutas.length ? (await supabase.storage.from("ordenes").createSignedUrls(rutas, 60 * 60)).data ?? [] : [];
  const fotos = (archivos ?? []).map((a, i) => ({ id: a.id, etapa: a.etapa, url: firmadas[i]?.signedUrl ?? null }));
  const urlDe = (ruta: string | null) => (ruta ? (firmadas.find((f) => f.path === ruta)?.signedUrl ?? null) : null);

  const v = Array.isArray(o.vehiculos) ? o.vehiculos[0] : o.vehiculos;
  const c = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;
  const estado = o.estado as EstadoOrden;
  const gestiona = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]);
  const esTecnicoAsignado = ctx.roles.includes("tecnico") && o.tecnico_id === ctx.perfil.id;
  const puedeTrabajar = gestiona || esTecnicoAsignado;
  const verDinero = tieneAlguno(ctx.roles, CAJA);
  const verCompras = verDinero || ctx.roles.includes("almacen");
  const esRecepcion = ctx.roles.includes("recepcion") && !gestiona;
  const verUtilidad = ctx.roles.includes("gerencia");
  const mueveInventario = tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"]);
  const [dinero, config, conStock] = verCompras
    ? await Promise.all([
        dineroDeOrden(ctx.taller.id, o.id, { verVentas: verDinero, verUtilidad }, { tecnicoId: o.tecnico_id, entregadoEn: o.entregado_en }),
        configDinero(ctx.taller.id),
        mueveInventario && o.estado !== "entregado" ? listarRepuestos(ctx.taller.id).then((l) => l.filter((r) => r.stock > 0)) : Promise.resolve([]),
      ])
    : [null, null, []];
  const ahora = new Date();
  const prometida = o.entrega_prometida ? new Date(o.entrega_prometida) : null;
  const situacion = situacionEntrega({ entregaPrometida: prometida, estado, listoEn: o.listo_en ? new Date(o.listo_en) : null }, ahora, ctx.configuracion.minutosAvisoEntrega);
  const datosCarro = [
    v?.marca && v?.modelo ? `${v.marca} ${v.modelo}` : (v?.marca ?? v?.modelo),
    v?.anio ? String(v.anio) : null,
    v?.color,
    v?.combustible ? COMBUSTIBLES[v.combustible as keyof typeof COMBUSTIBLES] : null,
    v?.transmision ? `Caja ${v.transmision === "cvt" ? "CVT" : TRANSMISIONES[v.transmision as keyof typeof TRANSMISIONES].toLowerCase()}` : null,
  ].filter(Boolean);

  const tarjetaEntrega = (id: string) =>
    estado !== "entregado" || prometida ? (
      <Tarjeta aria-labelledby={id}>
        <CabeceraTarjeta id={id} titulo="Entrega al cliente" detalle={prometida ? "Lo que se le prometió" : undefined} />
        {prometida ? (
          <>
            <p className="text-[26px] leading-tight font-semibold tracking-[-0.02em] first-letter:uppercase">{cuandoEntrega(prometida, ahora)}</p>
            <Estado color={colorSituacion(situacion)} texto={textoSituacion(situacion)} className="mt-2 text-[15px]" />
            {situacion.tipo === "atrasada" ? (
              <p role="alert" className="mt-3 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
                Ya pasó la hora. Llama al cliente{c ? ` (${formatearCelular(c.celular)})` : ""}, dale la nueva hora y cámbiala aquí.
              </p>
            ) : situacion.tipo === "por_vencer" ? (
              <p className="mt-3 rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
                Se acerca la hora y el carro no está listo. Si no llega, avísale al cliente antes.
              </p>
            ) : null}
            {o.entrega_reprogramada > 0 ? (
              <p className="mt-3 text-sm text-tinta-2">
                Se cambió {o.entrega_reprogramada === 1 ? "una vez" : `${o.entrega_reprogramada} veces`}. Los cambios quedan en Avances.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[15px] text-tinta-2">Todavía no hay hora prometida. Ponla apenas la sepas: así el sistema te avisa antes de que venza.</p>
        )}
        {gestiona && enTrabajo(estado) ? (
          <CambiarEntrega ordenId={o.id} actual={prometida ? partesLima(prometida) : null} ahora={ahora.toISOString()} cliente={c?.nombre.split(" ")[0] ?? "el cliente"} />
        ) : null}
      </Tarjeta>
    ) : null;

  // Firma del cliente: al dejar el carro la toma el asesor; al recogerlo, quien entrega (asesor o recepción).
  const tomaIngreso = gestiona && !o.firma_ingreso_ruta && estado !== "entregado";
  const tomaEntrega = verDinero && !o.firma_entrega_ruta && (estado === "listo" || estado === "entregado");
  const filasFirma = [
    { clave: "ingreso", titulo: "Al dejar el carro", ruta: o.firma_ingreso_ruta, en: o.firma_ingreso_en },
    { clave: "entrega", titulo: "Al recoger el carro", ruta: o.firma_entrega_ruta, en: o.firma_entrega_en },
  ].filter((f) => f.ruta || (f.clave === "ingreso" ? tomaIngreso : tomaEntrega));
  const tarjetaFirmas =
    filasFirma.length && c ? (
      <Tarjeta aria-labelledby="t-firmas">
        <CabeceraTarjeta id="t-firmas" titulo="Firma del cliente" detalle="Sale en la orden y en el recibo en PDF." />
        <ul className="flex flex-col gap-3">
          {filasFirma.map((f) => (
            <li key={f.clave} className="rounded-2xl bg-interna p-4">
              <p className="text-[15px] font-medium">{f.titulo}</p>
              {f.ruta ? (
                <>
                  {urlDe(f.ruta) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urlDe(f.ruta)!} alt={`Firma de ${c.nombre} ${f.titulo.toLowerCase()}`} className="mt-2 h-20 w-full max-w-72 rounded-xl bg-white object-contain p-1" />
                  ) : null}
                  <p className="mt-1.5 text-[13px] text-tinta-3">Firmó {formatearMomento(new Date(f.en!), ahora).toLowerCase()}</p>
                </>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-sm text-tinta-2">{f.clave === "ingreso" ? "Que confirme el estado del carro y lo que pidió." : "Que confirme que recibe su carro conforme."}</p>
                  <FirmarCliente
                    etiqueta={f.clave === "ingreso" ? "Firma de ingreso" : "Firma de entrega"}
                    titulo={f.clave === "ingreso" ? `Firma de ${c.nombre}` : `${c.nombre} recibe su carro`}
                    texto={f.clave === "ingreso" ? "Pásale el celular al cliente para que firme con el dedo." : "Pásale el celular al cliente para que firme que recibe su carro conforme."}
                    accion={guardarFirma.bind(null, o.id, f.clave as "ingreso" | "entrega")}
                    variante={f.clave === "entrega" && estado === "listo" ? "primario" : "secundario"}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </Tarjeta>
    ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link href={ctx.roles.includes("tecnico") && !gestiona ? "/mis-trabajos" : "/ordenes"} className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          {ctx.roles.includes("tecnico") && !gestiona ? "Mis trabajos" : "Órdenes"}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Placa placa={v?.placa ?? ""} className="h-9 px-3 text-[17px]" />
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">{numeroOrden(o.numero)}</h1>
          <Estado color={COLOR_ESTADO[estado]} texto={nombreEstado(estado, o.facturado_en)} className="rounded-full bg-tarjeta px-3 py-1.5 text-[15px] shadow-reposo" />
          {o.es_reingreso_garantia ? <GarantiaChip /> : null}
          {prometida && estado !== "entregado" ? (
            <Estado
              color={colorSituacion(situacion)}
              texto={`Entrega ${cuandoEntrega(prometida, ahora)}`}
              className="rounded-full bg-tarjeta px-3 py-1.5 text-[15px] shadow-reposo"
            />
          ) : null}
          <EnlacePdf href={`/pdf/orden/${o.id}`} texto="Orden de trabajo" boton className="md:ml-auto" />
        </div>
        <p className="text-[15px] text-tinta-2 md:text-base">
          {datosCarro.join(" · ") || "Carro sin datos"} · Ingresó {formatearMomento(new Date(o.ingresado_en), ahora).toLowerCase()}
          {o.kilometraje_ingreso != null ? ` con ${o.kilometraje_ingreso.toLocaleString("es-PE")} km` : ""}
          {o.tecnico_id ? ` · Lo trabaja ${nombres.get(o.tecnico_id) ?? "un técnico"}` : " · Sin técnico"}
        </p>
        {fallidas ? (
          <p role="alert" className="rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
            {fallidas} {fallidas === "1" ? "foto no se pudo subir" : "fotos no se pudieron subir"}. Agrégalas de nuevo abajo.
          </p>
        ) : null}
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          {/* En celular la hora prometida va arriba; en computadora, en la columna derecha. */}
          <div className="contents xl:hidden">{tarjetaEntrega("t-entrega-movil")}</div>
          {puedeTrabajar ? (
            <Tarjeta aria-labelledby="t-estado">
              <CabeceraTarjeta id="t-estado" titulo="Cambiar estado" detalle="Un toque. Si quieres, deja una nota." />
              {gestiona && estado !== "entregado" ? (
                <div className="mb-4">
                  <AsignarTecnico ordenId={o.id} tecnicoId={o.tecnico_id ?? ""} tecnicos={tecnicos} />
                </div>
              ) : null}
              <BotonesEstado ordenId={o.id} estado={estado} esTecnico={!gestiona} sinTecnico={!o.tecnico_id} />
            </Tarjeta>
          ) : esRecepcion && estado === "listo" ? (
            <Tarjeta aria-labelledby="t-estado">
              <CabeceraTarjeta id="t-estado" titulo="Entrega al cliente" detalle="El carro está listo. Cobra el saldo y entrégalo." />
              <BotonesEstado ordenId={o.id} estado={estado} esTecnico={false} soloEntregar />
            </Tarjeta>
          ) : null}

          <Tarjeta aria-labelledby="t-servicios">
            <CabeceraTarjeta id="t-servicios" titulo="Servicios" detalle={`${servicios?.length ?? 0} ${servicios?.length === 1 ? "servicio" : "servicios"}`} />
            <ul className="flex flex-col gap-2">
              {(servicios ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-2xl bg-interna px-4 py-3 text-[15px]">
                  {s.descripcion}
                  {s.es_adicional ? <span className="rounded-full bg-tarjeta px-2.5 py-0.5 text-[12px] text-tinta-2">Adicional</span> : null}
                </li>
              ))}
            </ul>
            {gestiona && estado !== "entregado" ? <AgregarServicio ordenId={o.id} sugerencias={servCatalogo.map((s) => s.nombre)} /> : null}
            {o.observaciones_ingreso ? (
              <div className="mt-4">
                <h3 className="mb-1 text-sm font-medium text-tinta-2">Observaciones de ingreso</h3>
                <p className="text-[15px] whitespace-pre-line">{o.observaciones_ingreso}</p>
              </div>
            ) : null}
          </Tarjeta>

          <Tarjeta aria-labelledby="t-diagnostico">
            <CabeceraTarjeta
              id="t-diagnostico"
              titulo="Diagnóstico"
              detalle={o.diagnostico_en ? `Actualizado ${formatearMomento(new Date(o.diagnostico_en), ahora).toLowerCase()}` : "Lo que encontró el taller"}
            />
            {o.diagnostico ? (
              <p className="text-[15px] whitespace-pre-line">{o.diagnostico}</p>
            ) : !puedeTrabajar ? (
              <p className="text-sm text-tinta-2">Todavía no hay diagnóstico.</p>
            ) : null}
            {puedeTrabajar && estado !== "entregado" ? <FormDiagnostico ordenId={o.id} actual={o.diagnostico} /> : null}
          </Tarjeta>

          <Tarjeta aria-labelledby="t-fotos">
            <CabeceraTarjeta id="t-fotos" titulo="Fotos" detalle={`${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"}`} />
            {fotos.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {fotos.map((f) =>
                  f.url ? (
                    <li key={f.id} className="relative aspect-square overflow-hidden rounded-xl bg-interna">
                      <a href={f.url} target="_blank" rel="noreferrer" className="block size-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt={`Foto de ${f.etapa}`} className="size-full object-cover" loading="lazy" />
                      </a>
                      <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white capitalize">{f.etapa}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-control px-4 py-4 text-sm text-tinta-2">Todavía no hay fotos de este carro.</p>
            )}
            {puedeTrabajar ? <SubirFotos ordenId={o.id} etapa={estado === "en_taller" || estado === "en_diagnostico" ? "ingreso" : estado === "listo" || estado === "entregado" ? "entrega" : "proceso"} /> : null}
          </Tarjeta>

          <Tarjeta aria-labelledby="t-avances">
            <CabeceraTarjeta id="t-avances" titulo="Avances" detalle="Lo que se va haciendo en el carro" />
            {puedeTrabajar && estado !== "entregado" ? <FormAvance ordenId={o.id} /> : null}
            {(avances ?? []).length > 0 ? (
              <ol className="mt-4 flex flex-col gap-3">
                {(avances ?? []).map((a) => (
                  <li key={a.id} className="rounded-2xl bg-interna px-4 py-3">
                    <p className="text-[15px] whitespace-pre-line">{a.texto}</p>
                    <p className="mt-1 text-[13px] text-tinta-3">
                      {nombres.get(a.autor_id ?? "") ?? "Alguien del taller"} · {formatearMomento(new Date(a.creado_en), ahora)}
                    </p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-sm text-tinta-2">Todavía no hay avances.</p>
            )}
          </Tarjeta>
        </div>

        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          <div className="hidden xl:contents">{tarjetaEntrega("t-entrega")}</div>

          {c ? (
            <Tarjeta aria-labelledby="t-cliente">
              <CabeceraTarjeta id="t-cliente" titulo="Cliente" />
              <p className="text-[17px] font-medium">
                <Link href={`/clientes/${c.id}`} className="underline-offset-4 hover:underline">
                  {c.nombre}
                </Link>
              </p>
              <p className="mt-1 flex items-center gap-2 text-[15px] text-tinta-2">
                <Phone className="size-4" aria-hidden />
                <span className="num select-all">{formatearCelular(c.celular)}</span>
              </p>
              {o.cita_id ? (
                <p className="mt-3 flex items-center gap-2 rounded-2xl bg-positivo-fondo px-3 py-2 text-sm text-positivo">
                  <CalendarCheck className="size-4" aria-hidden />
                  Llegó por una cita de redes.
                </p>
              ) : null}
            </Tarjeta>
          ) : null}

          {dinero && verDinero ? (
            <TarjetaDinero
              puedeCotizar={gestiona}
              d={dinero}
              ordenId={o.id}
              etiqueta={etiquetaOrden({ numero: o.numero, placa: v?.placa ?? "", cliente: c?.nombre })}
              entregada={estado === "entregado"}
              servicios={(servicios ?? []).map((s) => s.descripcion)}
              hoy={diaEnLima(ahora)}
            />
          ) : null}
          {dinero && (gestiona || ctx.roles.includes("almacen")) ? <TarjetaRepuestos
              d={dinero}
              ordenId={o.id}
              registra={mueveInventario}
              delInventario={o.estado !== "entregado" ? <SacarDelInventario ordenId={o.id} repuestos={conStock.map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, stock: r.stock, unidad: r.unidad }))} /> : undefined}
            /> : null}
          {dinero && config ? <TarjetaUtilidad d={dinero} margenMinimo={config.margenMinimo} /> : null}

          {!gestiona || estado === "entregado" ? (
            <Tarjeta aria-labelledby="t-tecnico">
              <CabeceraTarjeta id="t-tecnico" titulo="Lo trabajó" />
              <p className="text-[15px]">{o.tecnico_id ? (nombres.get(o.tecnico_id) ?? "Asignado") : "Sin asignar"}</p>
            </Tarjeta>
          ) : null}

          {tarjetaFirmas}

          <Tarjeta aria-labelledby="t-historial">
            <CabeceraTarjeta
              id="t-historial"
              titulo="Historial de estados"
              accion={
                v?.placa ? (
                  <Link href={`/vehiculos/${v.placa}`} className="text-sm font-medium underline-offset-4 hover:underline">
                    Historial del carro
                  </Link>
                ) : null
              }
            />
            <ol className="flex flex-col">
              {(historial ?? []).map((h) => (
                <li key={h.id} className="flex gap-3 border-t border-regla py-3 first:border-t-0 first:pt-0">
                  <Estado color={COLOR_ESTADO[h.estado_nuevo as EstadoOrden]} texto="" className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{NOMBRE_ESTADO[h.estado_nuevo as EstadoOrden]}</p>
                    {h.nota ? <p className="text-[14px] text-tinta-2">{h.nota}</p> : null}
                    <p className="text-[13px] text-tinta-3">
                      {nombres.get(h.cambiado_por ?? "") ?? "Sistema"} · {formatearMomento(new Date(h.cambiado_en), ahora)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Tarjeta>
        </div>
      </div>
    </div>
  );
}
