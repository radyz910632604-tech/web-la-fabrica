import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronRight, Pencil, Search, X } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { EmitirRecibo } from "@/components/caja/controles";
import { AprobarEnCaja, CobroConComprobante, DevolverPago, InterruptorIgv, TablaLineas, type LineaCaja } from "@/components/caja/panel-cobro";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { MEDIOS, NOMBRE_ESTADO_PAGO, TIPO_PAGO_CORTO, estadoPago, type MedioPago } from "@/lib/dinero";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { CAJA, esGestor, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { filtrarOrdenes, grupoPago, type FiltroPago, type OrdenCaja } from "@/lib/taller/caja-cobro";
import { listarOrdenes, nombresPersonal } from "@/lib/taller/consultas";
import { cuentasDeOrdenes, dineroDeOrden } from "@/lib/taller/dinero-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { rangoPeriodo } from "@/lib/taller/periodo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Órdenes y cobro" };

type Busqueda = { q?: string; e?: string; f?: string; orden?: string };
const DOC: Record<string, string> = { dni: "DNI", ruc: "RUC", ce: "C.E." };
const FILTROS: [FiltroPago, string][] = [
  ["todas", "Todas"],
  ["pendientes", "Pendientes"],
  ["abonadas", "Abonadas"],
  ["pagadas", "Pagadas"],
];
const PERIODOS: [string, string][] = [
  ["activas", "En el taller o con deuda"],
  ["hoy", "Ingresadas hoy"],
  ["semana", "Esta semana"],
  ["mes", "Este mes"],
];
const CHIP: Record<string, string> = {
  pendientes: "bg-aviso-fondo text-aviso",
  abonadas: "bg-[color-mix(in_oklab,var(--acento)_14%,transparent)] text-tinta",
  pagadas: "bg-positivo-fondo text-positivo",
};
const NOMBRE_GRUPO: Record<string, string> = { pendientes: "Pendiente", abonadas: "Abonada", pagadas: "Pagada" };
const n = (x: unknown) => Number(x ?? 0);
const hora = (f: string) => new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" }).format(new Date(f));

/**
 * Caja – Órdenes y Cobro: las órdenes a la izquierda y, a la derecha, la orden elegida con
 * sus servicios editables, IGV, abonos, saldo y el cobro. Todo sin salir de la pantalla.
 */
export default async function CajaCobro({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const q = await searchParams;
  const texto = (q.q ?? "").slice(0, 60);
  const filtro = (FILTROS.some(([f]) => f === q.e) ? q.e : "todas") as FiltroPago;
  const periodo = PERIODOS.some(([p]) => p === q.f) ? q.f! : "activas";
  const gestor = esGestor(ctx.roles);
  const hoy = diaEnLima(new Date());
  const supabase = await clienteServidor();

  // Lista: órdenes con su cuenta (total, abonado, saldo) y el DNI/RUC del cliente para buscar.
  const filas = await listarOrdenes(ctx.taller.id, { limite: 500, orden: "reciente" });
  const cuentas = await cuentasDeOrdenes(ctx.taller.id, filas.map((o) => ({ id: o.id, numero: o.numero, placa: o.placa, cliente: o.cliente, estado: o.estado })));
  const { data: docs } = filas.length
    ? await supabase.from("ordenes_trabajo").select("id, clientes (numero_documento)").in("id", filas.map((o) => o.id))
    : { data: [] as { id: string; clientes: unknown }[] };
  const docDe = new Map((docs ?? []).map((d) => {
    const c = (Array.isArray(d.clientes) ? d.clientes[0] : d.clientes) as { numero_documento: string | null } | null;
    return [d.id, c?.numero_documento ?? null];
  }));
  const porId = new Map(cuentas.map((c) => [c.id, c]));
  const rango = periodo === "activas" ? null : rangoPeriodo(periodo, hoy);
  const ordenes: OrdenCaja[] = filas
    .map((o) => {
      const c = porId.get(o.id);
      return { id: o.id, numero: o.numero, placa: o.placa, vehiculo: o.vehiculo, cliente: o.cliente, documento: docDe.get(o.id) ?? null, estado: o.estado, ingresadoEn: o.ingresadoEn, aCobrar: c?.aCobrar ?? 0, pagado: c?.pagado ?? 0, saldo: c?.saldo ?? 0 };
    })
    .filter((o) => {
      if (!rango) return o.estado !== "entregado" || o.saldo > 0.009;
      const dia = diaEnLima(new Date(o.ingresadoEn));
      return dia >= rango.desde && dia <= rango.hasta;
    });
  const { lista, conteo } = filtrarOrdenes(ordenes, texto, filtro);
  const elegidaId = q.orden && /^[0-9a-f-]{36}$/.test(q.orden) ? q.orden : null;
  const enlace = (cambios: Partial<Busqueda>) => {
    const p = new URLSearchParams();
    const todo = { q: texto || undefined, e: filtro !== "todas" ? filtro : undefined, f: periodo !== "activas" ? periodo : undefined, orden: elegidaId ?? undefined, ...cambios };
    for (const [k, v] of Object.entries(todo)) if (v) p.set(k, v);
    const s = p.toString();
    return `/caja/cobro${s ? `?${s}` : ""}`;
  };

  const detalle = elegidaId ? await cargarDetalle(ctx.taller.id, elegidaId, gestor) : null;
  const fecha = new Intl.DateTimeFormat("es-PE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "America/Lima" }).format(new Date());

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja titulo="Órdenes y cobro" detalle={`Elige una orden, revisa, cobra y entrega su constancia · ${fecha}`} />
      <SubnavCaja actual="/caja/cobro" roles={ctx.roles} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        {/* Panel izquierdo: órdenes */}
        <Tarjeta aria-labelledby="t-lista" className={cn("flex min-w-0 flex-col gap-3 xl:col-span-5", detalle && "hidden xl:flex")}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="t-lista" className="text-[17px] font-semibold">
              Órdenes
            </h2>
            <span className="num rounded-full bg-interna px-3 py-1 text-[13px] font-medium">{lista.length} {lista.length === 1 ? "orden" : "órdenes"}</span>
          </div>
          <form action="/caja/cobro" className="flex gap-2">
            {filtro !== "todas" ? <input type="hidden" name="e" value={filtro} /> : null}
            {periodo !== "activas" ? <input type="hidden" name="f" value={periodo} /> : null}
            <span className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-tinta-3" aria-hidden />
              <Entrada name="q" defaultValue={texto} placeholder="Cliente, DNI/RUC, placa o N.° de orden" aria-label="Buscar orden" className="pl-10" autoComplete="off" />
            </span>
            <Boton type="submit" variante="secundario">
              Buscar
            </Boton>
          </form>
          <nav aria-label="Estado de pago" className="flex flex-wrap gap-1.5">
            {FILTROS.map(([f, t]) => (
              <Link
                key={f}
                href={enlace({ e: f === "todas" ? undefined : f, orden: undefined })}
                aria-current={filtro === f ? "page" : undefined}
                className={cn("num inline-flex min-h-10 items-center rounded-full border px-3.5 text-[14px]", filtro === f ? "border-primario bg-primario font-medium text-primario-tinta" : "border-borde bg-tarjeta hover:bg-interna")}
              >
                {t} ({conteo[f]})
              </Link>
            ))}
          </nav>
          <nav aria-label="Fecha" className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
            {PERIODOS.map(([p, t]) => (
              <Link key={p} href={enlace({ f: p === "activas" ? undefined : p, orden: undefined })} aria-current={periodo === p ? "page" : undefined} className={cn("min-h-8 underline-offset-4", periodo === p ? "font-medium text-tinta underline" : "text-tinta-2 hover:text-tinta")}>
                {t}
              </Link>
            ))}
          </nav>
          {lista.length === 0 ? (
            <p className="rounded-2xl bg-interna px-4 py-6 text-center text-[15px] text-tinta-2">No hay órdenes con esa búsqueda.</p>
          ) : (
            <ul className="-mx-1 flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-1 pb-1">
              {lista.map((o) => {
                const g = grupoPago(o);
                const activa = o.id === elegidaId;
                return (
                  <li key={o.id} className={cn("flex items-stretch gap-1 rounded-2xl border bg-tarjeta", activa ? "border-primario ring-2 ring-primario/15" : "border-borde")}>
                    <Link href={enlace({ orden: o.id })} aria-current={activa ? "true" : undefined} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3.5 py-3 hover:bg-interna/60">
                      <span className="text-[15px] font-semibold">{numeroOrden(o.numero)}</span>
                      <span className="num text-right text-[15px] font-semibold">{o.aCobrar > 0 ? formatearSoles(o.aCobrar) : "Sin precio"}</span>
                      <span className="truncate text-[14px] text-tinta-2">{o.cliente ?? "Sin cliente"}</span>
                      <span className={cn("justify-self-end rounded-full px-2.5 py-0.5 text-[12px] font-medium", CHIP[g])}>{o.aCobrar <= 0.009 && o.pagado <= 0.009 ? "Sin precio" : NOMBRE_GRUPO[g]}</span>
                      <span className="truncate text-[13px] text-tinta-3">
                        {o.vehiculo ? `${o.vehiculo} · ` : ""}
                        {o.placa.replace(/^([A-Z0-9]{3})([A-Z0-9]{3})$/, "$1-$2")}
                      </span>
                      <span className="num text-right text-[12px] text-tinta-3">{o.pagado > 0.009 ? `abonó ${formatearSoles(o.pagado)} · debe ${formatearSoles(Math.max(o.saldo, 0))}` : ""}</span>
                    </Link>
                    <span className="flex flex-col justify-center gap-1 pr-2">
                      <Link href={`/ordenes/${o.id}/editar`} aria-label={`Editar datos de ${numeroOrden(o.numero)}`} className="grid size-9 place-items-center rounded-lg text-tinta-2 hover:bg-interna hover:text-tinta">
                        <Pencil className="size-4" />
                      </Link>
                      <Link href={enlace({ orden: o.id })} aria-label={`Cobrar ${numeroOrden(o.numero)}`} className="grid size-9 place-items-center rounded-lg text-tinta-2 hover:bg-interna hover:text-tinta">
                        <ChevronRight className="size-4" />
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>

        {/* Panel derecho: detalle y cobro */}
        <div className={cn("min-w-0 xl:col-span-7", !detalle && "hidden xl:block")}>
          {detalle ? (
            <Detalle d={detalle} cerrar={enlace({ orden: undefined })} gestor={gestor} />
          ) : (
            <Tarjeta className="grid min-h-80 place-items-center text-center">
              <p className="max-w-xs text-[15px] text-tinta-2">Elige una orden de la izquierda para ver sus servicios, el saldo y cobrarla.</p>
            </Tarjeta>
          )}
        </div>
      </div>
    </div>
  );
}

async function cargarDetalle(empresaId: string, id: string, gestor: boolean) {
  const supabase = await clienteServidor();
  const { data: o } = await supabase
    .from("ordenes_trabajo")
    .select("id, numero, estado, anulada, tecnico_id, entregado_en, vehiculos (placa, marca, modelo, anio), clientes (nombre, celular, tipo_documento, numero_documento)")
    .eq("id", id)
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (!o) return null;
  const [d, nombres, { data: cots }, { data: pagosQuien }, { data: caja }] = await Promise.all([
    dineroDeOrden(empresaId, o.id, { verVentas: true, verUtilidad: false }, { tecnicoId: o.tecnico_id, entregadoEn: o.entregado_en }),
    nombresPersonal(empresaId),
    supabase
      .from("cotizaciones")
      .select("id, version, estado, tasa_igv, subtotal_sin_igv, igv, total, descuento, descuento_motivo, cotizacion_items (id, tipo, descripcion, cantidad, subtotal_sin_igv, total, creado_en)")
      .eq("orden_id", o.id)
      .in("estado", ["borrador", "enviada", "aprobada"])
      .order("version"),
    supabase.from("pagos").select("id, creado_por, devuelve_pago_id, monto, estado").eq("orden_id", o.id),
    supabase.from("cajas").select("id").eq("empresa_id", empresaId).eq("tipo_caja", "recepcion").eq("estado", "abierta").maybeSingle(),
  ]);
  type Item = { id: string; tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; subtotal_sin_igv: number; total: number; creado_en: string | null };
  const vigentes = (cots ?? []).map((c) => ({ ...c, items: ((c.cotizacion_items ?? []) as Item[]).sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)) || a.id.localeCompare(b.id)) }));
  const lineas: LineaCaja[] = vigentes.flatMap((c) =>
    c.items.map((i) => ({ cotizacion: c.id, aprobada: c.estado === "aprobada", tipo: i.tipo, descripcion: i.descripcion, cantidad: n(i.cantidad), base: Math.round((n(i.subtotal_sin_igv) / n(i.cantidad)) * 100) / 100, subtotal: n(i.subtotal_sin_igv), total: n(i.total) })),
  );
  const aprobadas = vigentes.filter((c) => c.estado === "aprobada");
  const porAprobar = vigentes.filter((c) => c.estado !== "aprobada");
  const documentada = d.recibos.some((r) => r.estado !== "anulado") || d.comprobantes.some((c) => c.estado === "confirmado");
  const pagada = d.aCobrar > 0.009 && d.saldo <= 0.009;
  const entregada = o.estado === "entregado";
  const editable = !o.anulada && !documentada && (gestor || (!entregada && !(pagada && d.pagado > 0.009)));
  const motivoBloqueo = o.anulada
    ? "La orden está anulada."
    : documentada
      ? "Ya tiene recibo, boleta o factura: para cambiar importes, primero anúlalo."
      : !editable
        ? entregada
          ? "El carro ya se entregó: el ajuste lo autoriza gerencia o administración."
          : "La orden ya está pagada: el ajuste lo autoriza gerencia o administración."
        : undefined;
  const conIgv = vigentes.length ? vigentes.every((c) => n(c.tasa_igv) > 0) : true;
  const devuelto = new Map<string, number>();
  for (const p of pagosQuien ?? []) if (p.devuelve_pago_id && p.estado === "confirmado") devuelto.set(p.devuelve_pago_id, (devuelto.get(p.devuelve_pago_id) ?? 0) + n(p.monto));
  const quien = new Map((pagosQuien ?? []).map((p) => [p.id, p.creado_por as string | null]));
  return {
    o,
    v: Array.isArray(o.vehiculos) ? o.vehiculos[0] : o.vehiculos,
    cl: Array.isArray(o.clientes) ? o.clientes[0] : o.clientes,
    d,
    nombres,
    quien,
    devuelto,
    lineas,
    porAprobar,
    // Subtotal (sin IGV) − descuento (sin IGV) + IGV = total.
    subtotal: lineas.filter((l) => l.aprobada).reduce((a, l) => a + l.subtotal, 0),
    descuento: aprobadas.reduce((a, c) => a + Math.round((n(c.descuento) / (1 + n(c.tasa_igv))) * 100) / 100, 0),
    igv: aprobadas.reduce((a, c) => a + n(c.igv), 0),
    totalAprobado: aprobadas.reduce((a, c) => a + n(c.total), 0),
    documentada,
    pagada,
    editable,
    motivoBloqueo,
    conIgv,
    cajaAbierta: Boolean(caja),
    reciboId: d.recibos.find((r) => r.estado !== "anulado")?.id ?? null,
  };
}

type DetalleOrden = NonNullable<Awaited<ReturnType<typeof cargarDetalle>>>;

function Detalle({ d: x, cerrar, gestor }: { d: DetalleOrden; cerrar: string; gestor: boolean }) {
  const { o, v, cl, d } = x;
  const estado = estadoPago(d);
  const vehiculo = [v?.marca, v?.modelo, v?.anio].filter(Boolean).join(" ");
  return (
    <Tarjeta aria-labelledby="t-detalle" className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href={cerrar} className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-tinta-2 hover:text-tinta xl:hidden">
          <ArrowLeft className="size-4" aria-hidden />
          Órdenes
        </Link>
        <h2 id="t-detalle" className="text-[22px] font-semibold tracking-[-0.02em]">
          {numeroOrden(o.numero)}
        </h2>
        <span className={cn("rounded-full px-3 py-1 text-[13px] font-medium", estado === "pagada" || estado === "a_favor" ? "bg-positivo-fondo text-positivo" : estado === "sin_precio" ? "bg-hundida text-tinta-2" : "bg-aviso-fondo text-aviso")}>
          {NOMBRE_ESTADO_PAGO[estado]}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <Boton asChild variante="secundario" tamano="chico">
            <Link href={`/ordenes/${o.id}/editar`}>
              <Pencil />
              Editar datos
            </Link>
          </Boton>
          <Link href={cerrar} aria-label="Cerrar detalle" className="hidden size-10 place-items-center rounded-full text-tinta-2 hover:bg-interna xl:grid">
            <X className="size-5" />
          </Link>
        </span>
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-b border-regla pb-4 text-[15px] sm:grid-cols-2">
        <div className="flex gap-2"><dt className="w-20 shrink-0 text-tinta-2">Cliente</dt><dd className="min-w-0 font-medium">{cl?.nombre ?? "—"}</dd></div>
        <div className="flex gap-2"><dt className="w-20 shrink-0 text-tinta-2">Vehículo</dt><dd className="min-w-0">{vehiculo || "—"}</dd></div>
        <div className="flex gap-2"><dt className="w-20 shrink-0 text-tinta-2">{DOC[cl?.tipo_documento ?? ""] ?? "DNI/RUC"}</dt><dd className="num">{cl?.numero_documento ?? "—"}</dd></div>
        <div className="flex items-center gap-2"><dt className="w-20 shrink-0 text-tinta-2">Placa</dt><dd><Placa placa={v?.placa ?? ""} /></dd></div>
        <div className="flex gap-2"><dt className="w-20 shrink-0 text-tinta-2">Teléfono</dt><dd className="num">{cl?.celular ? formatearCelular(cl.celular) : "—"}</dd></div>
        <div className="flex gap-2"><dt className="w-20 shrink-0 text-tinta-2">Orden</dt><dd><Link href={`/ordenes/${o.id}`} className="underline underline-offset-4">Ver la orden completa</Link></dd></div>
      </dl>

      <section aria-labelledby="t-lineas" className="flex flex-col gap-3">
        <h3 id="t-lineas" className="text-[16px] font-semibold">Servicios de la orden</h3>
        <TablaLineas ordenId={o.id} lineas={x.lineas} conIgv={x.conIgv} editable={x.editable} motivoBloqueo={x.motivoBloqueo} />
        {x.porAprobar.length && x.editable ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-aviso-fondo px-3 py-2 text-[14px] text-aviso">
            Hay líneas por aprobar ({formatearSoles(x.porAprobar.reduce((a, c) => a + n(c.total), 0))}): no cuentan en el total hasta que el cliente las apruebe.
            {x.porAprobar.map((c) => (
              <AprobarEnCaja key={c.id} cotizacion={c.id} />
            ))}
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <dl className="num flex flex-col rounded-2xl bg-interna px-4 py-3 text-[15px]">
          <div className="flex justify-between gap-3 py-1"><dt>Subtotal</dt><dd>{formatearSoles(x.subtotal)}</dd></div>
          {x.descuento > 0 ? <div className="flex justify-between gap-3 py-1 text-positivo"><dt>Descuento</dt><dd>−{formatearSoles(x.descuento)}</dd></div> : null}
          <div className="flex items-center justify-between gap-3 py-1">
            <dt className="flex items-center gap-3">
              IGV (18 %)
              <InterruptorIgv ordenId={o.id} conIgv={x.conIgv} puedeQuitar={gestor} editable={x.editable && x.lineas.length > 0} />
              <span className={cn("text-[12px] font-medium", x.conIgv ? "text-positivo" : "text-tinta-3")}>{x.conIgv ? "Activado" : "Sin IGV"}</span>
            </dt>
            <dd>{formatearSoles(x.igv)}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-regla pt-2">
            <dt className="text-[16px] font-semibold">Total a pagar</dt>
            <dd className="text-[24px] font-semibold tracking-[-0.02em]">{formatearSoles(d.aCobrar)}</dd>
          </div>
          {d.comprobantes.some((c) => c.estado === "confirmado") ? <p className="text-[12px] text-tinta-3">El total sale de la boleta o factura registrada.</p> : null}
        </dl>
        <dl className="num flex flex-col justify-center gap-1 rounded-2xl bg-interna px-4 py-3 text-[15px]">
          <div className="flex justify-between gap-3"><dt>Abonos realizados</dt><dd>{formatearSoles(d.pagado)}</dd></div>
          <div className={cn("flex items-baseline justify-between gap-3", d.saldo > 0.009 ? "text-negativo" : "text-positivo")}>
            <dt className="font-semibold">{d.saldo < -0.009 ? "Saldo a favor" : "Saldo pendiente"}</dt>
            <dd className="text-[20px] font-semibold">{formatearSoles(Math.abs(d.saldo))}</dd>
          </div>
        </dl>
      </div>

      {!o.anulada ? (
        <section aria-labelledby="t-pago" className="flex flex-col gap-3 border-t border-regla pt-4">
          <h3 id="t-pago" className="text-[16px] font-semibold">Registro de pago</h3>
          {!x.cajaAbierta ? (
            <p className="rounded-xl bg-aviso-fondo px-3 py-2 text-[14px] text-aviso">
              La caja de Recepción está cerrada: el pago se guarda en la orden pero no entra al cuadre del día.{" "}
              <Link href="/caja?area=recepcion" className="font-medium underline underline-offset-4">Abrir caja</Link>
            </p>
          ) : null}
          <CobroConComprobante ordenId={o.id} saldo={Math.max(d.saldo, 0)} conPrecio={d.aCobrar > 0.009} pagada={x.pagada} reciboId={x.reciboId} puedeEmitirRecibo={!x.reciboId && x.totalAprobado > 0} />
          {!x.reciboId && x.totalAprobado > 0 && !d.comprobantes.some((c) => c.estado === "confirmado") ? (
            <div className="flex flex-wrap items-center gap-3 text-[14px] text-tinta-2">
              Recibo interno (no es boleta ni factura electrónica):
              <EmitirRecibo ordenId={o.id} total={formatearSoles(x.totalAprobado)} />
            </div>
          ) : null}
        </section>
      ) : null}

      <section aria-labelledby="t-pagos" className="flex flex-col gap-2 border-t border-regla pt-4">
        <div className="flex items-center justify-between gap-2">
          <h3 id="t-pagos" className="text-[16px] font-semibold">Pagos anteriores</h3>
          <EnlacePdf href={`/pdf/cuenta/${o.id}`} texto="Estado de cuenta" />
        </div>
        {d.pagos.length === 0 ? (
          <p className="text-[15px] text-tinta-2">Todavía no hay pagos.</p>
        ) : (
          <ul className="flex flex-col">
            {d.pagos.map((p) => {
              const maximo = Math.min(p.monto - (x.devuelto.get(p.id) ?? 0), -d.saldo);
              return (
                <li key={p.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-b border-regla py-2.5 last:border-0", p.estado === "anulado" && "opacity-60")}>
                  <span className="min-w-0">
                    <span className={cn("text-[15px] font-medium", p.estado === "anulado" && "line-through")}>
                      {MEDIOS[p.medio as MedioPago]} · {TIPO_PAGO_CORTO[p.tipo]}
                    </span>
                    <span className="num block text-[13px] text-tinta-3">
                      {hora(p.pagadoEn)} · {x.nombres.get(x.quien.get(p.id) ?? "") ?? "—"}
                      {p.operacion ? ` · ${p.operacion}` : ""}
                      {p.estado === "anulado" ? " · anulado" : p.estado === "por_confirmar" ? " · por confirmar" : ""}
                    </span>
                  </span>
                  <span className={cn("num text-[16px] font-semibold", p.tipo === "devolucion" && "text-negativo")}>{formatearSoles(p.tipo === "devolucion" ? -p.monto : p.monto)}</span>
                  <span className="flex items-center gap-1">
                    <EnlacePdf href={`/pdf/pago/${p.id}`} texto="Constancia" />
                    {p.estado === "confirmado" && p.tipo !== "devolucion" && maximo > 0.009 ? <DevolverPago pagoId={p.id} maximo={maximo} /> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Tarjeta>
  );
}
