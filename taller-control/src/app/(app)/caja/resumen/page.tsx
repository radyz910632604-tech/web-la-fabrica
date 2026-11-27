import Link from "next/link";
import { notFound } from "next/navigation";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, montoNeto, type MedioPago } from "@/lib/dinero";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { CAJA, esGestor, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes, nombresPersonal } from "@/lib/taller/consultas";
import { cuentasDeOrdenes } from "@/lib/taller/dinero-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { instantesPeriodo, PERIODOS, rangoPeriodo } from "@/lib/taller/periodo";
import { cn } from "@/lib/utils";

export const metadata = { title: "Resumen de caja" };

const n = (x: unknown) => Number(x ?? 0);
const momento = (f: string) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit" }).format(new Date(f));
const MEDIOS_ORDEN: MedioPago[] = ["efectivo", "yape", "plin", "transferencia", "tarjeta"];

function Cifra({ titulo, valor, nota, clase }: { titulo: string; valor: number; nota: string; clase?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-3xl bg-tarjeta px-5 py-4 shadow-reposo">
      <span className="text-[14px] text-tinta-2">{titulo}</span>
      <span className={cn("num truncate text-[26px] leading-tight font-semibold tracking-[-0.02em]", clase)}>{formatearSoles(valor)}</span>
      <span className="text-[13px] text-tinta-3">{nota}</span>
    </div>
  );
}

type Busqueda = { periodo?: string; desde?: string; hasta?: string; quien?: string };

/**
 * Panel del dinero: lo vendido (boletas, facturas y recibos), lo cobrado (pagos que
 * entraron de verdad), lo que falta cobrar y las salidas, por periodo, por medio y por persona.
 * Una cotización no es venta y una orden sin pagar no es dinero recibido.
 */
export default async function ResumenCaja({ searchParams }: { searchParams: Promise<Busqueda> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const q = await searchParams;
  const hoy = diaEnLima(new Date());
  const r = rangoPeriodo(q.periodo, hoy, q.desde, q.hasta);
  const { inicio, fin } = instantesPeriodo(r.desde, r.hasta);
  const gestor = esGestor(ctx.roles);
  // Quien no es gerencia o administración ve solo sus propias operaciones.
  const quien = gestor ? (q.quien && /^[0-9a-f-]{36}$/.test(q.quien) ? q.quien : null) : ctx.perfil.id;
  const supabase = await clienteServidor();

  let consultaPagos = supabase
    .from("pagos")
    .select("id, orden_id, monto, tipo, medio, numero_operacion, pagado_en, creado_por, ordenes_trabajo (numero, vehiculos (placa))")
    .eq("empresa_id", ctx.taller.id)
    .eq("estado", "confirmado")
    .gte("pagado_en", inicio)
    .lt("pagado_en", fin)
    .order("pagado_en", { ascending: false })
    .limit(2000);
  if (quien) consultaPagos = consultaPagos.eq("creado_por", quien);

  const [{ data: pagosCrudos }, { data: comps }, { data: notas }, { data: recibos }, { data: salidas }, nombres, ordenes] = await Promise.all([
    consultaPagos,
    supabase.from("comprobantes_venta").select("orden_id, total").eq("empresa_id", ctx.taller.id).eq("estado", "confirmado").gte("fecha_emision", r.desde).lte("fecha_emision", r.hasta),
    supabase.from("notas_credito").select("total").eq("empresa_id", ctx.taller.id).eq("estado", "confirmado").gte("fecha_emision", r.desde).lte("fecha_emision", r.hasta),
    supabase.from("recibos").select("orden_id, total").eq("empresa_id", ctx.taller.id).neq("estado", "anulado").gte("emitido_en", inicio).lt("emitido_en", fin),
    gestor
      ? supabase.from("movimientos_caja").select("monto, clase").eq("empresa_id", ctx.taller.id).eq("tipo", "egreso").eq("estado", "confirmado").gte("creado_en", inicio).lt("creado_en", fin)
      : Promise.resolve({ data: [] as { monto: number; clase: string | null }[] }),
    nombresPersonal(ctx.taller.id),
    listarOrdenes(ctx.taller.id, { limite: 400, orden: "reciente" }),
  ]);

  // Vendido: boletas y facturas (menos notas de crédito) y recibos de órdenes sin boleta ni factura.
  const conComprobante = new Set((comps ?? []).map((c) => c.orden_id));
  const { data: compsDeRecibos } = (recibos ?? []).length
    ? await supabase.from("comprobantes_venta").select("orden_id").eq("estado", "confirmado").in("orden_id", (recibos ?? []).map((x) => x.orden_id))
    : { data: [] as { orden_id: string }[] };
  for (const c of compsDeRecibos ?? []) conComprobante.add(c.orden_id);
  const vendido =
    (comps ?? []).reduce((a, c) => a + n(c.total), 0) - (notas ?? []).reduce((a, x) => a + n(x.total), 0) + (recibos ?? []).filter((x) => !conComprobante.has(x.orden_id)).reduce((a, x) => a + n(x.total), 0);

  type PagoFila = { id: string; orden_id: string; monto: number; tipo: string; medio: string; numero_operacion: string | null; pagado_en: string; creado_por: string | null; ordenes_trabajo: unknown };
  const pagos = (pagosCrudos ?? []) as PagoFila[];
  const cobrado = pagos.reduce((a, p) => a + montoNeto({ tipo: p.tipo, monto: n(p.monto) }), 0);
  const porMedio = new Map<string, { total: number; cantidad: number }>();
  const porPersona = new Map<string, { total: number; cantidad: number }>();
  for (const p of pagos) {
    const neto = montoNeto({ tipo: p.tipo, monto: n(p.monto) });
    const m = porMedio.get(p.medio) ?? { total: 0, cantidad: 0 };
    porMedio.set(p.medio, { total: m.total + neto, cantidad: m.cantidad + 1 });
    const k = p.creado_por ?? "";
    const x = porPersona.get(k) ?? { total: 0, cantidad: 0 };
    porPersona.set(k, { total: x.total + neto, cantidad: x.cantidad + 1 });
  }
  const egresos = (salidas ?? []).filter((s) => !(s.clase ?? "").includes("fondo")).reduce((a, s) => a + n(s.monto), 0);

  // Pendiente de cobro: lo que deben hoy las órdenes con precio (no depende del periodo).
  const cuentas = await cuentasDeOrdenes(
    ctx.taller.id,
    ordenes.map((o) => ({ id: o.id, numero: o.numero, placa: o.placa, cliente: o.cliente, estado: o.estado })),
  );
  const deudas = cuentas.filter((c) => c.saldo > 0.009 && c.aCobrar > 0);
  const pendiente = deudas.reduce((a, c) => a + c.saldo, 0);

  const enlace = (cambios: Partial<Busqueda>) => {
    const p = new URLSearchParams();
    const todo = { periodo: r.periodo, desde: r.periodo === "rango" ? r.desde : undefined, hasta: r.periodo === "rango" ? r.hasta : undefined, quien: gestor ? (quien ?? undefined) : undefined, ...cambios };
    for (const [k, v] of Object.entries(todo)) if (v) p.set(k, v);
    return `/caja/resumen?${p.toString()}`;
  };
  const textoPeriodo = r.desde === r.hasta ? r.desde.split("-").reverse().join("/") : `${r.desde.split("-").reverse().join("/")} al ${r.hasta.split("-").reverse().join("/")}`;
  const personas = gestor ? [...new Map([...porPersona.keys()].filter(Boolean).map((id) => [id, nombres.get(id) ?? "—"])).entries()] : [];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja titulo="Resumen de caja" detalle={`${textoPeriodo}${quien && gestor ? ` · ${nombres.get(quien) ?? ""}` : !gestor ? " · tus operaciones" : ""}`} />
      <SubnavCaja actual="/caja/resumen" roles={ctx.roles} />

      <div className="flex flex-col gap-3">
        <nav aria-label="Periodo" className="flex flex-wrap gap-2">
          {PERIODOS.filter(([p]) => p !== "rango").map(([p, texto]) => (
            <Link
              key={p}
              href={enlace({ periodo: p, desde: undefined, hasta: undefined })}
              aria-current={r.periodo === p ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-[15px]",
                r.periodo === p ? "border-primario bg-primario font-medium text-primario-tinta" : "border-borde bg-tarjeta hover:bg-interna",
              )}
            >
              {texto}
            </Link>
          ))}
        </nav>
        <form action="/caja/resumen" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="periodo" value="rango" />
          {gestor && quien ? <input type="hidden" name="quien" value={quien} /> : null}
          <label className="flex flex-col gap-1 text-sm">
            Desde
            <Entrada type="date" name="desde" defaultValue={r.desde} max={hoy} className="num w-44" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Hasta
            <Entrada type="date" name="hasta" defaultValue={r.hasta} max={hoy} className="num w-44" />
          </label>
          <Boton type="submit" variante="secundario">
            Ver fechas
          </Boton>
        </form>
      </div>

      <section aria-label="Cifras del periodo" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Cifra titulo="Total vendido" valor={vendido} nota={gestor || !quien ? "Boletas, facturas y recibos emitidos" : "Del taller en el periodo"} />
        <Cifra titulo="Total cobrado" valor={cobrado} nota={`${pagos.length} ${pagos.length === 1 ? "operación" : "operaciones"} · dinero que sí entró`} clase="text-positivo" />
        <Cifra titulo="Pendiente de cobro" valor={pendiente} nota={`${deudas.length} ${deudas.length === 1 ? "orden debe" : "órdenes deben"} (a hoy)`} clase={pendiente > 0 ? "text-aviso" : undefined} />
        {gestor ? <Cifra titulo="Salidas de caja" valor={egresos} nota="Gastos y retiros (aparte de los ingresos)" clase={egresos > 0 ? "text-negativo" : undefined} /> : null}
      </section>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <Tarjeta aria-labelledby="t-medios" className="xl:col-span-5">
          <CabeceraTarjeta id="t-medios" titulo="Ingresos por medio de pago" detalle="Lo cobrado en el periodo" />
          <dl className="flex flex-col">
            {MEDIOS_ORDEN.map((m) => {
              const x = porMedio.get(m) ?? { total: 0, cantidad: 0 };
              return (
                <div key={m} className="flex items-baseline justify-between gap-3 border-b border-regla py-2.5 last:border-0">
                  <dt className="text-[15px]">
                    {MEDIOS[m]} <span className="text-[13px] text-tinta-3">· {x.cantidad}</span>
                  </dt>
                  <dd className={cn("num text-[16px] font-semibold", x.total === 0 && "text-tinta-3")}>{formatearSoles(x.total)}</dd>
                </div>
              );
            })}
            <div className="flex items-baseline justify-between gap-3 pt-3">
              <dt className="text-[16px] font-semibold">Total cobrado</dt>
              <dd className="num text-[18px] font-semibold">{formatearSoles(cobrado)}</dd>
            </div>
          </dl>
          {gestor && personas.length ? (
            <div className="mt-5 border-t border-regla pt-4">
              <h3 className="mb-2 text-[15px] font-semibold">Por trabajador</h3>
              <ul className="flex flex-col">
                {personas.map(([id, nombre]) => {
                  const x = porPersona.get(id)!;
                  return (
                    <li key={id}>
                      <Link href={enlace({ quien: quien === id ? undefined : id })} className={cn("flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 hover:bg-interna", quien === id && "bg-interna font-medium")}>
                        <span>
                          {nombre} <span className="text-[13px] text-tinta-3">· {x.cantidad}</span>
                        </span>
                        <span className="num">{formatearSoles(x.total)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {quien ? (
                <Link href={enlace({ quien: undefined })} className="mt-2 inline-flex min-h-11 items-center text-[14px] text-tinta-2 underline-offset-4 hover:underline">
                  Ver a todos
                </Link>
              ) : null}
            </div>
          ) : null}
          <p className="mt-4 text-[13px] text-tinta-3">
            La utilidad (venta menos costos) está en{" "}
            <Link href="/reportes" className="underline underline-offset-4">
              Reportes
            </Link>
            . El cuadre del efectivo con apertura y conteo, en{" "}
            <Link href="/caja" className="underline underline-offset-4">
              Caja del día
            </Link>
            .
          </p>
        </Tarjeta>

        <Tarjeta aria-labelledby="t-ops" className="xl:col-span-7">
          <CabeceraTarjeta id="t-ops" titulo="Operaciones" detalle="Cada cobro con su orden, medio y quién lo registró" />
          {pagos.length === 0 ? (
            <p className="text-[15px] text-tinta-2">No hay cobros en este periodo.</p>
          ) : (
            <ul className="flex flex-col">
              {pagos.slice(0, 300).map((p) => {
                const o = (Array.isArray(p.ordenes_trabajo) ? p.ordenes_trabajo[0] : p.ordenes_trabajo) as { numero: number; vehiculos: { placa: string } | { placa: string }[] | null } | null;
                const placa = o ? (Array.isArray(o.vehiculos) ? o.vehiculos[0]?.placa : o.vehiculos?.placa) : null;
                const neto = montoNeto({ tipo: p.tipo, monto: n(p.monto) });
                return (
                  <li key={p.id} className="flex items-center gap-3 border-b border-regla py-2.5 last:border-0">
                    <Link href={`/ordenes/${p.orden_id}/cobrar`} className="min-w-0 flex-1 hover:underline">
                      <span className="block text-[15px] font-medium">
                        {o ? numeroOrden(o.numero) : "Orden"}
                        {placa ? ` · ${placa}` : ""} · {MEDIOS[p.medio as MedioPago]}
                      </span>
                      <span className="num block text-[13px] text-tinta-3">
                        {momento(p.pagado_en)} · {nombres.get(p.creado_por ?? "") ?? "—"}
                        {p.numero_operacion ? ` · Op. ${p.numero_operacion}` : ""}
                      </span>
                    </Link>
                    <span className={cn("num shrink-0 text-[16px] font-semibold", neto < 0 && "text-negativo")}>{formatearSoles(neto)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
      </div>
    </div>
  );
}
