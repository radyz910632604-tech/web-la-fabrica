import Link from "next/link";
import { notFound } from "next/navigation";
import { Placa } from "@/components/marca/placa";
import { Anular, RegistrarPago } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { cuentasDeOrdenes } from "@/lib/taller/dinero-consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { anularPago } from "./acciones";

export const metadata = { title: "Cobros y deudas" };

export default async function Cobros({ searchParams }: { searchParams: Promise<{ nuevo?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) notFound();
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

  const { data: pagos } = await supabase
    .from("pagos")
    .select("id, orden_id, monto, tipo, medio, pagado_en, estado, numero_operacion, motivo_anulacion")
    .eq("empresa_id", ctx.taller.id)
    .order("pagado_en", { ascending: false })
    .limit(25);
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const opciones = cuentas
    .filter((c) => c.estado !== "entregado" || c.saldo > 0.009)
    .map((c) => ({
      id: c.id,
      etiqueta: `${numeroOrden(c.numero)} · ${c.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}${c.cliente ? ` · ${c.cliente}` : ""}${c.saldo > 0.009 ? ` · debe S/ ${c.saldo.toFixed(2)}` : ""}`,
      saldo: c.saldo,
      entregada: c.estado === "entregado",
    }));
  const ahora = new Date();

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Cobros y deudas"
        detalle={`${deudas.length} ${deudas.length === 1 ? "orden con saldo" : "órdenes con saldo"} por ${formatearSoles(totalDeuda)}${entregadasConDeuda.length ? `; ${entregadasConDeuda.length} ya se entregaron` : ""}.`}
        accion={<RegistrarPago ordenes={opciones} abrir={nuevo === "1"} />}
      />
      <SubnavCaja actual="/cobros" roles={ctx.roles} />
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
                  <Link href={`/ordenes/${d.id}`} className="min-w-0 flex-1">
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
                        {formatearSoles(Number(p.monto))} · {MEDIOS[p.medio as MedioPago]}
                      </p>
                      <p className="truncate text-[13px] text-tinta-3">
                        {o ? `${numeroOrden(o.numero)} · ` : ""}
                        {p.tipo === "adelanto" ? "Adelanto" : "Saldo"} · {formatearMomento(new Date(p.pagado_en), ahora)}
                        {p.numero_operacion ? ` · Op. ${p.numero_operacion}` : ""}
                        {anulado ? ` · Anulado: ${p.motivo_anulacion}` : ""}
                      </p>
                    </div>
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
