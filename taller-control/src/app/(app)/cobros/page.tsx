import Link from "next/link";
import { notFound } from "next/navigation";
import { Placa } from "@/components/marca/placa";
import { Anular, RegistrarPago } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, TIPO_PAGO_CORTO, type MedioPago } from "@/lib/dinero";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { cuentasDeOrdenes } from "@/lib/taller/dinero-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { ConfirmarMontos } from "@/components/ia/confirmar-montos";
import { anularPago, confirmarPago } from "./acciones";

export const metadata = { title: "Cobros y deudas" };

export default async function Cobros({ searchParams }: { searchParams: Promise<{ nuevo?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { nuevo } = await searchParams;
  const supabase = await clienteServidor();

  const ordenes = await listarOrdenes(ctx.taller.id, { limite: 400, orden: "reciente" });
  const cuentas = await cuentasDeOrdenes(
    ctx.taller.id,
    ordenes.map((o) => ({ id: o.id, numero: o.numero, placa: o.placa, cliente: o.cliente, estado: o.estado })),
  );
  const deudas = cuentas.filter((c) => c.saldo > 0.009 && c.aCobrar > 0).sort((a, b) => Number(b.estado === "entregado") - Number(a.estado === "entregado") || b.saldo - a.saldo);
  const totalDeuda = deudas.reduce((a, c) => a + c.saldo, 0);
  const entregadasConDeuda = deudas.filter((d) => d.estado === "entregado");
  const aFavor = cuentas.filter((c) => c.saldo < -0.009);

  const { data: pagos } = await supabase
    .from("pagos")
    .select("id, orden_id, monto, tipo, medio, pagado_en, estado, numero_operacion, motivo_anulacion")
    .eq("empresa_id", ctx.taller.id)
    .order("pagado_en", { ascending: false })
    .limit(25);
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const opciones = cuentas
    .filter((c) => c.estado !== "entregado" || Math.abs(c.saldo) > 0.009)
    .map((c) => ({
      id: c.id,
      etiqueta: `${numeroOrden(c.numero)} · ${c.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}${c.cliente ? ` · ${c.cliente}` : ""}${c.saldo > 0.009 ? ` · debe S/ ${c.saldo.toFixed(2)}` : c.saldo < -0.009 ? ` · a favor S/ ${(-c.saldo).toFixed(2)}` : ""}`,
      saldo: c.saldo,
      entregada: c.estado === "entregado",
    }));
  const ahora = new Date();
  // Pagos que llegaron por WhatsApp: esperan que alguien de caja los revise.
  const { data: porConfirmar } = await supabase
    .from("pagos")
    .select("id, orden_id, monto, tipo, medio, pagado_en, creado_por")
    .eq("empresa_id", ctx.taller.id)
    .eq("estado", "por_confirmar")
    .order("pagado_en", { ascending: false })
    .limit(50);
  const quienes = [...new Set((porConfirmar ?? []).map((p) => p.creado_por).filter(Boolean))] as string[];
  const { data: perfiles } = quienes.length ? await supabase.from("perfiles").select("id, nombre").in("id", quienes) : { data: [] };
  const nombreDe = new Map((perfiles ?? []).map((p) => [p.id, p.nombre as string]));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Cobros y deudas"
        detalle={`${deudas.length} ${deudas.length === 1 ? "orden con saldo" : "órdenes con saldo"} por ${formatearSoles(totalDeuda)}${entregadasConDeuda.length ? `; ${entregadasConDeuda.length} ya se entregaron` : ""}.`}
        accion={<RegistrarPago ordenes={opciones} abrir={nuevo === "1"} />}
      />
      <SubnavCaja actual="/cobros" roles={ctx.roles} />
      {porConfirmar?.length ? (
        <Tarjeta aria-labelledby="t-por-confirmar" className="border border-aviso-borde">
          <CabeceraTarjeta id="t-por-confirmar" titulo={`Pagos por confirmar (${porConfirmar.length})`} detalle="Llegaron por WhatsApp. No cuentan en el saldo ni en la caja hasta que los confirmes." />
          <ul className="flex flex-col">
            {porConfirmar.map((p) => {
              const o = porId.get(p.orden_id);
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 border-t border-regla py-3 first:border-t-0">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="num text-[15px] font-medium">
                      {formatearSoles(Number(p.monto))} · {MEDIOS[p.medio as MedioPago]} · {TIPO_PAGO_CORTO[p.tipo] ?? p.tipo}
                    </p>
                    <p className="text-[13px] text-tinta-3">
                      {o ? `${numeroOrden(o.numero)} · ${o.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}` : "Orden"} · {formatearMomento(new Date(p.pagado_en), ahora)}
                      {p.creado_por ? ` · lo envió ${nombreDe.get(p.creado_por) ?? "alguien del taller"}` : ""}
                    </p>
                  </div>
                  <ConfirmarMontos
                    id={p.id}
                    titulo="Pago por WhatsApp"
                    accion={confirmarPago}
                    filas={[
                      ["Orden", o ? `${numeroOrden(o.numero)} · ${o.cliente ?? ""}` : "—"],
                      ["Monto", formatearSoles(Number(p.monto))],
                      ["Medio", MEDIOS[p.medio as MedioPago]],
                      ["Tipo", TIPO_PAGO_CORTO[p.tipo] ?? p.tipo],
                    ]}
                  />
                  <Anular id={p.id} accion={anularPago} que="pago" />
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-sm text-tinta-3">Antes de confirmar, revisa que el dinero llegó (Yape, Plin o la caja). Si no llegó, anúlalo.</p>
        </Tarjeta>
      ) : null}
      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <Tarjeta aria-labelledby="t-deudas" className="min-w-0 xl:col-span-7">
          <CabeceraTarjeta id="t-deudas" titulo="Deudas" detalle="Lo que falta cobrar, según comprobantes o cotizaciones aprobadas" />
          {deudas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">No hay deudas. Todo está cobrado.</p>
          ) : (
            <ul className="flex flex-col">
              {deudas.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 border-t border-regla py-3 first:border-t-0">
                  <Placa placa={d.placa} />
                  <Link href={`/ordenes/${d.id}`} className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-[15px] font-medium hover:underline">{d.cliente ?? numeroOrden(d.numero)}</p>
                    <p className="num text-[13px] text-tinta-3">
                      {numeroOrden(d.numero)} · pagó {formatearSoles(d.pagado)} de {formatearSoles(d.aCobrar)}
                      {d.estado === "entregado" ? " · ya entregado" : ""}
                    </p>
                  </Link>
                  <span className={`num text-[15px] font-semibold ${d.estado === "entregado" ? "text-negativo" : ""}`}>{formatearSoles(d.saldo)}</span>
                  <RegistrarPago ordenes={opciones} ordenFija={d.id} texto="Cobrar" variante="secundario" />
                </li>
              ))}
            </ul>
          )}
          {aFavor.length ? (
            <div className="mt-5 border-t border-regla pt-4">
              <h3 className="text-[15px] font-semibold">Saldo a favor del cliente</h3>
              <p className="mb-2 text-[13px] text-tinta-3">Pagaron de más o tuvieron nota de crédito. Devuélveles o úsalo en su próxima visita.</p>
              <ul className="flex flex-col">
                {aFavor.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 border-t border-regla py-3 first:border-t-0">
                    <Placa placa={d.placa} />
                    <Link href={`/ordenes/${d.id}`} className="min-w-0 flex-1 basis-40">
                      <p className="truncate text-[15px] font-medium hover:underline">{d.cliente ?? numeroOrden(d.numero)}</p>
                      <p className="num text-[13px] text-tinta-3">{numeroOrden(d.numero)} · pagó {formatearSoles(d.pagado)} de {formatearSoles(d.aCobrar)}</p>
                    </Link>
                    <span className="num text-[15px] font-semibold text-positivo">{formatearSoles(-d.saldo)}</span>
                    <RegistrarPago ordenes={opciones} ordenFija={d.id} texto="Devolver" variante="secundario" />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Tarjeta>
        <Tarjeta aria-labelledby="t-pagos" className="min-w-0 xl:col-span-5">
          <CabeceraTarjeta id="t-pagos" titulo="Últimos pagos" />
          {(pagos ?? []).length === 0 ? (
            <p className="text-sm text-tinta-2">Todavía no hay pagos registrados.</p>
          ) : (
            <ul className="flex flex-col">
              {(pagos ?? []).map((p) => {
                const o = porId.get(p.orden_id);
                const anulado = p.estado === "anulado";
                return (
                  <li key={p.id} className="flex items-center gap-3 border-t border-regla py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className={`num text-[15px] font-medium ${anulado ? "text-tinta-3 line-through" : ""}`}>
                        {formatearSoles(p.tipo === "devolucion" ? -Number(p.monto) : Number(p.monto))} · {MEDIOS[p.medio as MedioPago]}
                      </p>
                      <p className="truncate text-[13px] text-tinta-3">
                        {o ? `${numeroOrden(o.numero)} · ` : ""}
                        {TIPO_PAGO_CORTO[p.tipo]} · {formatearMomento(new Date(p.pagado_en), ahora)}
                        {p.numero_operacion ? ` · Op. ${p.numero_operacion}` : ""}
                        {anulado ? ` · Anulado: ${p.motivo_anulacion}` : ""}
                      </p>
                    </div>
                    <EnlacePdf href={`/pdf/pago/${p.id}`} texto="Recibo" />
                    {!anulado ? <Anular id={p.id} accion={anularPago} que="pago" /> : null}
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
