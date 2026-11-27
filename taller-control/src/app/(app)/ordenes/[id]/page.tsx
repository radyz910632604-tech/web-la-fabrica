import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Banknote, Car, ChevronDown, Clock, FileText, MessageCircle, Pencil } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { GarantiaChip } from "@/components/taller/lista-ordenes";
import { Boton } from "@/components/ui/boton";
import { cn } from "@/lib/utils";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { Estado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { TarjetaDinero, TarjetaRepuestos, TarjetaUtilidad } from "@/components/caja/tarjeta-dinero";
import { EmitirRecibo } from "@/components/caja/controles";
import { AprobarEnCaja, TablaLineas, type LineaCaja } from "@/components/caja/panel-cobro";
import { Pestanas } from "@/components/ui/pestanas";
import { estadoPago, NOMBRE_ESTADO_PAGO } from "@/lib/dinero";
import { diaEnLima, formatearMomento, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogo, nombresPersonal, responsablesDeOrden, tecnicosMecanicos } from "@/lib/taller/consultas";
import { configDinero, dineroDeOrden } from "@/lib/taller/dinero-consultas";
import { CARROCERIAS, COLOR_ESTADO, NOMBRE_COMBUSTIBLE, enTrabajo, etiquetaOrden, nombreEstado, NOMBRE_ESTADO, numeroOrden, TRANSMISIONES, type EstadoOrden } from "@/lib/taller/estados";
import { listarRepuestos } from "@/lib/taller/inventario-consultas";
import { colorSituacion, cuandoEntrega, partesLima, situacionEntrega, textoSituacion } from "@/lib/taller/entrega";
import { SacarDelInventario } from "../../inventario/controles";
import { FirmarCliente } from "@/components/taller/firma-cliente";
import { AgregarServicio, PonerPrecio, AnularOrden, AsignarAsesor, AsignarTecnico, BotonesEstado, CambiarEntrega, FormAvance, FormDiagnostico, SubirFotos } from "./controles";
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
      "id, numero, estado, tecnico_id, cita_id, kilometraje_ingreso, observaciones_ingreso, ingresado_en, listo_en, entregado_en, entrega_prometida, entrega_reprogramada, entrega_cambiada_por, entrega_cambiada_en, asesor_id, anulada, motivo_anulacion, es_reingreso_garantia, orden_garantia_origen_id, firma_ingreso_ruta, firma_ingreso_en, firma_entrega_ruta, firma_entrega_en, diagnostico, diagnostico_en, facturado_en, vehiculos (placa, marca, modelo, anio, color, combustible, transmision, carroceria), clientes (id, nombre, celular)",
    )
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!o) notFound();

  const esGestorOrden = tieneAlguno(ctx.roles, ["gerencia", "administrador"]);
  const [{ data: servicios }, { data: historial }, { data: avances }, { data: archivos }, nombres, tecnicos, servCatalogo, asesores] = await Promise.all([
    supabase.from("orden_servicios").select("id, descripcion, es_adicional").eq("orden_id", id).order("creado_en"),
    supabase.from("orden_estados_historial").select("id, estado_anterior, estado_nuevo, nota, cambiado_por, cambiado_en").eq("orden_id", id).order("cambiado_en", { ascending: false }),
    supabase.from("orden_avances").select("id, texto, autor_id, creado_en").eq("orden_id", id).order("creado_en", { ascending: false }),
    supabase.from("archivos").select("id, ruta, etapa, creado_en").eq("orden_id", id).eq("tipo", "foto").order("creado_en"),
    nombresPersonal(ctx.taller.id),
    tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]) ? tecnicosMecanicos(ctx.taller.id) : Promise.resolve([]),
    tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]) ? catalogo(ctx.taller.id) : Promise.resolve([]),
    esGestorOrden ? responsablesDeOrden(ctx.taller.id) : Promise.resolve([] as { id: string; nombre: string }[]),
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
  // Precios en la lista de Servicios (solo para quien ve dinero): salen de las cotizaciones vigentes.
  const ponePrecios = verDinero && !o.anulada && estado !== "entregado";
  const [{ data: catPrecios }, { data: repPrecios }] = ponePrecios
    ? await Promise.all([
        supabase.from("catalogo_servicios").select("nombre, precio_referencial").eq("empresa_id", ctx.taller.id).eq("activo", true).order("nombre"),
        supabase.from("repuestos").select("nombre, precio_venta_sin_igv").eq("empresa_id", ctx.taller.id).eq("activo", true).order("nombre").limit(500),
      ])
    : [{ data: [] as { nombre: string; precio_referencial: number | null }[] }, { data: [] as { nombre: string; precio_venta_sin_igv: number | null }[] }];
  const tasa = config?.tasaIgv ?? 0.18;
  const sugerenciasPrecio = [
    ...(catPrecios ?? []).map((x) => ({ nombre: x.nombre, tipo: "servicio" as const, precio: x.precio_referencial == null ? null : Number(x.precio_referencial) })),
    ...(repPrecios ?? []).map((x) => ({ nombre: x.nombre, tipo: "repuesto" as const, precio: x.precio_venta_sin_igv == null ? null : Math.round(Number(x.precio_venta_sin_igv) * (1 + tasa) * 100) / 100 })),
  ];
  // Servicios y productos con precio: de las cotizaciones vigentes (una sola fuente del total).
  const { data: cotsCrudas } = verDinero
    ? await supabase
        .from("cotizaciones")
        .select("id, estado, version, cotizacion_items (id, tipo, descripcion, cantidad, subtotal_sin_igv, total, creado_en)")
        .eq("orden_id", o.id)
        .in("estado", ["borrador", "enviada", "aprobada"])
        .order("version")
    : { data: [] as never[] };
  type ItemCot = { id: string; tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; subtotal_sin_igv: number; total: number; creado_en: string | null };
  const lineas: LineaCaja[] = (cotsCrudas ?? []).flatMap((cot) =>
    ((cot.cotizacion_items ?? []) as ItemCot[])
      .sort((x, y) => String(x.creado_en).localeCompare(String(y.creado_en)) || x.id.localeCompare(y.id))
      .map((i) => ({
        cotizacion: cot.id,
        aprobada: cot.estado === "aprobada",
        tipo: i.tipo,
        descripcion: i.descripcion,
        cantidad: Number(i.cantidad),
        base: Math.round((Number(i.subtotal_sin_igv) / Number(i.cantidad)) * 100) / 100,
        subtotal: Number(i.subtotal_sin_igv),
        total: Number(i.total),
      })),
  );
  const conPrecio = new Set(lineas.filter((l) => l.tipo === "servicio").map((l) => l.descripcion.trim().toLowerCase()));
  const sinPrecio = (servicios ?? []).filter((sv) => !conPrecio.has(sv.descripcion.trim().toLowerCase()));
  const porAprobar = (cotsCrudas ?? []).filter((cot) => cot.estado !== "aprobada");
  const totalPorAprobar = lineas.filter((l) => !l.aprobada).reduce((x, l) => x + l.total, 0);
  const documentada = Boolean(dinero && (dinero.recibos.some((r) => r.estado !== "anulado") || dinero.comprobantes.some((cp) => cp.estado === "confirmado")));
  const pagada = Boolean(dinero && dinero.aCobrar > 0.009 && dinero.saldo <= 0.009 && dinero.pagado > 0.009);
  const preciosEditables = ponePrecios && !documentada && (esGestorOrden || !pagada);
  const bloqueoPrecios = !verDinero || o.anulada
    ? undefined
    : documentada
      ? "Ya tiene recibo, boleta o factura: para cambiar precios, primero anúlalo."
      : estado === "entregado"
        ? "El carro ya se entregó."
        : pagada && !esGestorOrden
          ? "La orden ya está pagada: el ajuste lo autoriza gerencia o administración."
          : undefined;
  const reciboVigente = dinero?.recibos.find((r) => r.estado !== "anulado") ?? null;

  const ahora = new Date();
  const prometida = o.entrega_prometida ? new Date(o.entrega_prometida) : null;
  const situacion = situacionEntrega({ entregaPrometida: prometida, estado, listoEn: o.listo_en ? new Date(o.listo_en) : null }, ahora, ctx.configuracion.minutosAvisoEntrega);
  const datosCarro = [
    v?.marca && v?.modelo ? `${v.marca} ${v.modelo}` : (v?.marca ?? v?.modelo),
    v?.anio ? String(v.anio) : null,
    v?.color,
    v?.carroceria ? (CARROCERIAS as Record<string, string>)[v.carroceria] : null,
    v?.combustible ? (NOMBRE_COMBUSTIBLE[v.combustible] ?? v.combustible) : null,
    v?.transmision ? `Caja ${v.transmision === "cvt" ? "CVT" : TRANSMISIONES[v.transmision as keyof typeof TRANSMISIONES].toLowerCase()}` : null,
  ].filter(Boolean);

  // La hora prometida la cambian recepción, gerencia y administración; los demás la ven.
  const cambiaHora = tieneAlguno(ctx.roles, ["gerencia", "administrador", "recepcion"]);
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
                Se cambió {o.entrega_reprogramada === 1 ? "una vez" : `${o.entrega_reprogramada} veces`}
                {o.entrega_cambiada_por ? `; la última, ${nombres.get(o.entrega_cambiada_por) ?? "alguien del taller"}${o.entrega_cambiada_en ? ` (${cuandoEntrega(new Date(o.entrega_cambiada_en), ahora)})` : ""}` : ""}. Todos los cambios quedan en Avances.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[15px] text-tinta-2">
            {cambiaHora ? "Todavía no hay hora prometida. Ponla apenas la sepas: así el sistema te avisa antes de que venza." : "Todavía no hay hora prometida. La ponen recepción o gerencia."}
          </p>
        )}
        {!cambiaHora && prometida && enTrabajo(estado) ? <p className="mt-3 text-[13px] text-tinta-3">Para cambiarla, pídeselo a recepción o gerencia.</p> : null}
        {cambiaHora && enTrabajo(estado) ? (
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

  const celularWa = c?.celular ? c.celular.replace(/\D/g, "") : "";
  const pago = verDinero && dinero && !o.anulada ? estadoPago(dinero) : null;
  const colorPago: Record<string, string> = { sin_precio: "bg-hundida text-tinta-2", pendiente: "bg-aviso-fondo text-aviso", parcial: "bg-aviso-fondo text-aviso", pagada: "bg-positivo-fondo text-positivo", a_favor: "bg-positivo-fondo text-positivo" };
  const firmaPendiente = tomaIngreso || tomaEntrega;
  const historialEstados = (
    <div className="flex flex-col gap-3">
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
      {v?.placa ? (
        <Link href={`/vehiculos/${v.placa}`} className="text-sm font-medium underline-offset-4 hover:underline">
          Ver todo el historial del carro
        </Link>
      ) : null}
    </div>
  );
  const sinTarjeta = "[&>section]:rounded-none [&>section]:bg-transparent [&>section]:p-0 [&>section]:shadow-none";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Link href={ctx.roles.includes("tecnico") && !gestiona ? "/mis-trabajos" : "/ordenes"} className="inline-flex w-fit items-center gap-1.5 text-sm text-tinta-2 hover:text-tinta">
        <ArrowLeft className="size-4" aria-hidden />
        {ctx.roles.includes("tecnico") && !gestiona ? "Mis trabajos" : "Órdenes"}
      </Link>

      {/* 1. Franja superior: lo esencial de la orden y accesos rápidos */}
      <Tarjeta aria-labelledby="t-orden" className="flex flex-col gap-3 py-4 md:py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 id="t-orden" className="rounded-xl bg-interna px-3 py-1.5 text-[20px] leading-tight font-semibold tracking-[-0.02em] md:text-[22px]">
            {numeroOrden(o.numero)}
          </h1>
          <Placa placa={v?.placa ?? ""} className="h-9 px-3 text-[16px]" />
          <Estado color={COLOR_ESTADO[estado]} texto={nombreEstado(estado, o.facturado_en)} className="rounded-full bg-interna px-3 py-1.5 text-[14px]" />
          {o.es_reingreso_garantia ? <GarantiaChip /> : null}
          {prometida && estado !== "entregado" ? (
            <span className="flex items-center gap-2 text-[14px]">
              <Clock className="size-4 text-tinta-2" aria-hidden />
              <Estado color={colorSituacion(situacion)} texto={`Entrega ${cuandoEntrega(prometida, ahora)}`} />
            </span>
          ) : null}
          {c ? (
            <span className="flex min-w-0 items-center gap-2 text-[14px] text-tinta-2">
              <span className="truncate">
                <Link href={`/clientes/${c.id}`} className="font-medium text-tinta underline-offset-4 hover:underline">
                  {c.nombre}
                </Link>
              </span>
              <span className="num select-all">{formatearCelular(c.celular)}</span>
            </span>
          ) : null}
          <span className="flex flex-wrap gap-2 md:ml-auto">
            {celularWa ? (
              <Boton asChild variante="secundario" tamano="chico">
                <a href={`https://wa.me/${celularWa.length === 9 ? `51${celularWa}` : celularWa}`} target="_blank" rel="noreferrer">
                  <MessageCircle />
                  WhatsApp
                </a>
              </Boton>
            ) : null}
            {v?.placa ? (
              <Boton asChild variante="secundario" tamano="chico">
                <Link href={`/vehiculos/${v.placa}`}>
                  <Car />
                  Ficha vehículo
                </Link>
              </Boton>
            ) : null}
          </span>
        </div>
        <p className="text-[14px] text-tinta-2">
          {datosCarro.join(" · ") || "Carro sin datos"} · Ingresó {formatearMomento(new Date(o.ingresado_en), ahora).toLowerCase()}
          {o.kilometraje_ingreso != null ? ` con ${o.kilometraje_ingreso.toLocaleString("es-PE")} km` : ""}
          {o.tecnico_id ? ` · Lo trabaja ${nombres.get(o.tecnico_id) ?? "un técnico"}` : " · Sin técnico"}
          {o.cita_id ? " · Llegó por una cita de redes" : ""}
        </p>
        {o.anulada ? (
          <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-[15px] text-negativo">
            Orden anulada{o.motivo_anulacion ? `: ${o.motivo_anulacion}` : ""}. Ya no sale en las listas ni cuenta en reportes.
          </p>
        ) : null}
        {fallidas ? (
          <p role="alert" className="rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
            {fallidas} {fallidas === "1" ? "foto no se pudo subir" : "fotos no se pudieron subir"}. Agrégalas de nuevo en Fotos.
          </p>
        ) : null}
      </Tarjeta>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        {/* 2. Columna principal: lo operativo */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
          {puedeTrabajar ? (
            <Tarjeta aria-labelledby="t-estado">
              <CabeceraTarjeta id="t-estado" titulo="Estado y responsables" />
              {gestiona && estado !== "entregado" ? (
                <div className="mb-4 grid gap-4 sm:grid-cols-2">
                  <AsignarTecnico ordenId={o.id} tecnicoId={o.tecnico_id ?? ""} tecnicos={tecnicos} />
                  {esGestorOrden ? <AsignarAsesor ordenId={o.id} asesorId={o.asesor_id ?? ""} asesores={asesores} /> : null}
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

          <Tarjeta aria-labelledby="t-servicios" className="flex flex-col gap-3">
            <CabeceraTarjeta
              id="t-servicios"
              titulo="Servicios"
              detalle={verDinero ? "Con el precio que paga el cliente (IGV incluido)" : `${servicios?.length ?? 0} ${servicios?.length === 1 ? "servicio" : "servicios"}`}
            />
            {verDinero ? (
              <>
                {sinPrecio.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {sinPrecio.map((sv) => (
                      <li key={sv.id} className="flex items-center justify-between gap-3 rounded-xl bg-interna px-3 py-2.5 text-[15px]">
                        <span className="min-w-0">
                          {sv.descripcion}
                          <span className="ml-1.5 text-[12px] text-tinta-3">Sin precio</span>
                        </span>
                        {preciosEditables ? (
                          <PonerPrecio ordenId={o.id} descripcion={sv.descripcion} base={sugerenciasPrecio.find((x) => x.tipo === "servicio" && x.nombre.toLowerCase() === sv.descripcion.toLowerCase())?.precio ?? null} />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <TablaLineas ordenId={o.id} lineas={lineas} conIgv editable={preciosEditables} motivoBloqueo={bloqueoPrecios} preciosConIgv sugerencias={sugerenciasPrecio} />
                {porAprobar.length ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-aviso-fondo px-3 py-2 text-[14px] text-aviso">
                    Por aprobar: {formatearSoles(totalPorAprobar)} (no cuenta en el total hasta que el cliente lo apruebe).
                    {porAprobar.map((cot) => (
                      <AprobarEnCaja key={cot.id} cotizacion={cot.id} />
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {(servicios ?? []).map((sv) => (
                    <li key={sv.id} className="flex items-center justify-between gap-3 rounded-xl bg-interna px-4 py-3 text-[15px]">
                      {sv.descripcion}
                      {sv.es_adicional ? <span className="rounded-full bg-tarjeta px-2.5 py-0.5 text-[12px] text-tinta-2">Adicional</span> : null}
                    </li>
                  ))}
                </ul>
                {gestiona && estado !== "entregado" ? <AgregarServicio ordenId={o.id} sugerencias={servCatalogo.map((sv) => sv.nombre)} /> : null}
              </>
            )}
          </Tarjeta>

          <Plegable titulo="Diagnóstico y observaciones" detalle={o.diagnostico ? (o.diagnostico_en ? `Actualizado ${formatearMomento(new Date(o.diagnostico_en), ahora).toLowerCase()}` : "Con diagnóstico") : "Sin diagnóstico todavía"} abierto={!verDinero}>
            {o.observaciones_ingreso ? (
              <div className="mb-4">
                <h3 className="mb-1 text-sm font-medium text-tinta-2">Observaciones de ingreso</h3>
                <p className="text-[15px] whitespace-pre-line">{o.observaciones_ingreso}</p>
              </div>
            ) : null}
            <h3 className="mb-1 text-sm font-medium text-tinta-2">Diagnóstico</h3>
            {o.diagnostico ? <p className="text-[15px] whitespace-pre-line">{o.diagnostico}</p> : <p className="text-sm text-tinta-2">Todavía no hay diagnóstico.</p>}
            {puedeTrabajar && estado !== "entregado" ? <FormDiagnostico ordenId={o.id} actual={o.diagnostico} /> : null}
          </Plegable>

          <Plegable titulo="Avances" detalle={`${(avances ?? []).length} ${(avances ?? []).length === 1 ? "avance" : "avances"}`} abierto={!verDinero}>
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
          </Plegable>

          <Plegable titulo="Fotos" detalle={`${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"}`} abierto={Boolean(fallidas)}>
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
          </Plegable>
        </div>

        {/* 3. Columna lateral: dinero y lo secundario */}
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
          {dinero && verDinero ? (
            <Tarjeta aria-labelledby="t-dinero-resumen" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="t-dinero-resumen" className="text-[17px] font-semibold">
                  Dinero
                </h2>
                {pago ? <span className={cn("rounded-full px-3 py-1 text-[13px] font-medium", colorPago[pago])}>{NOMBRE_ESTADO_PAGO[pago]}</span> : null}
              </div>
              <dl className="num grid grid-cols-3 divide-x divide-regla rounded-2xl bg-interna py-3">
                {[
                  ["A cobrar", dinero.aCobrar, ""],
                  ["Pagado", dinero.pagado, "text-positivo"],
                  [dinero.saldo < -0.009 ? "A favor" : "Saldo", Math.abs(dinero.saldo), dinero.saldo > 0.009 ? "text-negativo" : "text-positivo"],
                ].map(([nombre, valor, clase]) => (
                  <div key={String(nombre)} className="min-w-0 px-3">
                    <dt className="text-[13px] text-tinta-2">{nombre}</dt>
                    <dd className={cn("text-[17px] font-semibold tracking-[-0.01em] sm:text-[19px]", String(clase))}>{formatearSoles(Number(valor))}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[13px] text-tinta-3">
                {dinero.comprobantes.some((cp) => cp.estado === "confirmado")
                  ? "El monto a cobrar sale de la boleta o factura registrada."
                  : dinero.aCobrar > 0
                    ? "El monto a cobrar sale de los servicios y productos aprobados."
                    : "Todavía no hay precios aprobados: ponlos en Servicios."}
              </p>
              {!o.anulada ? (
                <div className="grid grid-cols-2 gap-2">
                  <Boton asChild className="w-full">
                    <Link href={`/caja/cobro?orden=${o.id}`}>
                      <Banknote />
                      {pago === "pagada" || pago === "a_favor" ? "Ver cobro" : "Registrar pago"}
                    </Link>
                  </Boton>
                  {reciboVigente ? (
                    <Boton asChild variante="secundario" className="w-full">
                      <a href={`/pdf/recibo/${reciboVigente.id}`} target="_blank" rel="noreferrer">
                        <FileText />
                        Ver comprobante
                      </a>
                    </Boton>
                  ) : dinero.aCobrar > 0 && !dinero.comprobantes.some((cp) => cp.estado === "confirmado") ? (
                    <span className="[&>button]:h-12 [&>button]:w-full">
                      <EmitirRecibo ordenId={o.id} total={formatearSoles(dinero.aCobrar)} />
                    </span>
                  ) : null}
                </div>
              ) : null}
            </Tarjeta>
          ) : null}

          {tarjetaEntrega("t-entrega")}
          {firmaPendiente ? tarjetaFirmas : null}

          <Tarjeta aria-label="Más de la orden">
            <Pestanas
              etiqueta="Más de la orden"
              pestanas={[
                ...(dinero && verDinero
                  ? [
                      {
                        id: "cotizaciones",
                        titulo: "Cotizaciones y pagos",
                        contenido: (
                          <TarjetaDinero
                            soloDetalle
                            puedeCotizar={verDinero}
                            d={dinero}
                            ordenId={o.id}
                            etiqueta={etiquetaOrden({ numero: o.numero, placa: v?.placa ?? "", cliente: c?.nombre })}
                            entregada={estado === "entregado"}
                            hoy={diaEnLima(ahora)}
                          />
                        ),
                      },
                    ]
                  : []),
                ...(dinero && (gestiona || ctx.roles.includes("almacen"))
                  ? [
                      {
                        id: "repuestos",
                        titulo: "Repuestos",
                        contenido: (
                          <div className={sinTarjeta}>
                            <TarjetaRepuestos
                              d={dinero}
                              ordenId={o.id}
                              registra={mueveInventario}
                              delInventario={o.estado !== "entregado" ? <SacarDelInventario ordenId={o.id} repuestos={conStock.map((r) => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, stock: r.stock, unidad: r.unidad }))} /> : undefined}
                            />
                          </div>
                        ),
                      },
                    ]
                  : []),
                { id: "historial", titulo: "Historial", contenido: historialEstados },
                ...(!firmaPendiente && tarjetaFirmas ? [{ id: "firmas", titulo: "Firmas", contenido: <div className={sinTarjeta}>{tarjetaFirmas}</div> }] : []),
                ...(dinero && config && verUtilidad ? [{ id: "utilidad", titulo: "Utilidad", contenido: <div className={sinTarjeta}><TarjetaUtilidad d={dinero} margenMinimo={config.margenMinimo} /></div> }] : []),
              ]}
            />
          </Tarjeta>

          <Plegable titulo="Más acciones" detalle="Editar, imprimir o anular la orden">
            <div className="flex flex-wrap gap-2">
              {tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]) && !o.anulada && estado !== "entregado" ? (
                <Boton asChild variante="secundario">
                  <Link href={`/ordenes/${o.id}/editar`}>
                    <Pencil />
                    Editar orden
                  </Link>
                </Boton>
              ) : null}
              <EnlacePdf href={`/pdf/orden/${o.id}`} texto="Orden de trabajo" boton />
              {esGestorOrden && !o.anulada ? <AnularOrden ordenId={o.id} /> : null}
            </div>
            {!gestiona || estado === "entregado" ? <p className="mt-3 text-[14px] text-tinta-2">Lo trabajó: {o.tecnico_id ? (nombres.get(o.tecnico_id) ?? "Asignado") : "Sin asignar"}</p> : null}
          </Plegable>
        </div>
      </div>
    </div>
  );
}

/** Bloque plegable con el mismo aspecto que una tarjeta: para lo que no se usa a cada rato. */
function Plegable({ titulo, detalle, abierto, children }: { titulo: string; detalle?: string; abierto?: boolean; children: React.ReactNode }) {
  return (
    <details open={abierto} className="group rounded-tarjeta bg-tarjeta shadow-reposo">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 md:px-6 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-[16px] font-semibold tracking-[-0.01em]">{titulo}</span>
          {detalle ? <span className="block text-[13px] text-tinta-3">{detalle}</span> : null}
        </span>
        <ChevronDown className="size-5 shrink-0 text-tinta-2 transition-transform duration-200 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-5 pb-5 md:px-6">{children}</div>
    </details>
  );
}
