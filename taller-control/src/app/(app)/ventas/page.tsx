import Link from "next/link";
import { notFound } from "next/navigation";
import { Anular } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { anularComprobante } from "./acciones";
import { AsignarOrden, RegistrarComprobante } from "./formulario";

export const metadata = { title: "Comprobantes de venta" };

export default async function Ventas() {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) notFound();
  const supabase = await clienteServidor();
  const hoy = diaEnLima(new Date());
  const [{ data }, ordenes] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, orden_id, tipo, serie, numero, fecha_emision, subtotal_sin_igv, igv, total, estado, origen_datos, motivo_anulacion")
      .eq("empresa_id", ctx.taller.id)
      .order("fecha_emision", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(60),
    listarOrdenes(ctx.taller.id, { limite: 200, orden: "reciente" }),
  ]);
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const opciones = ordenes.map((o) => ({ id: o.id, etiqueta: `${numeroOrden(o.numero)} · ${o.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}${o.cliente ? ` · ${o.cliente}` : ""}` }));
  const lista = data ?? [];
  const sinOrden = lista.filter((c) => !c.orden_id && c.estado !== "anulado");
  const delMes = lista.filter((c) => c.estado === "confirmado" && c.fecha_emision.slice(0, 7) === hoy.slice(0, 7));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Comprobantes de venta"
        detalle={`${delMes.length} este mes por ${formatearSoles(delMes.reduce((a, c) => a + Number(c.total), 0))}${sinOrden.length ? ` · ${sinOrden.length} sin orden asignada` : ""}. El sistema no emite comprobantes: registra los que ya entregaste.`}
        accion={<RegistrarComprobante ordenes={opciones} hoy={hoy} />}
      />
      <SubnavCaja actual="/ventas" roles={ctx.roles} />
      <Tarjeta aria-labelledby="t-comp">
        <CabeceraTarjeta id="t-comp" titulo="Últimos comprobantes" />
        {lista.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Todavía no hay comprobantes registrados.</p>
        ) : (
          <ul className="flex flex-col">
            {lista.map((c) => {
              const o = c.orden_id ? porId.get(c.orden_id) : null;
              const anulado = c.estado === "anulado";
              return (
                <li key={c.id} className="flex flex-col gap-3 border-t border-regla py-3 first:border-t-0 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className={`text-[15px] font-medium ${anulado ? "text-tinta-3 line-through" : ""}`}>
                      {c.tipo === "boleta" ? "Boleta" : "Factura"} {c.serie}-{c.numero}
                      <span className="num ml-2 font-normal text-tinta-2">{formatearSoles(Number(c.total))}</span>
                    </p>
                    <p className="text-[13px] text-tinta-3">
                      {c.fecha_emision.split("-").reverse().join("/")} · sin IGV {formatearSoles(Number(c.subtotal_sin_igv))}
                      {c.origen_datos === "xml_sunat" ? " · leído del XML" : ""}
                      {o ? (
                        <>
                          {" · "}
                          <Link href={`/ordenes/${o.id}`} className="underline-offset-4 hover:underline">
                            {numeroOrden(o.numero)}
                          </Link>
                        </>
                      ) : null}
                      {anulado ? ` · Anulado: ${c.motivo_anulacion}` : ""}
                    </p>
                  </div>
                  {!anulado && !c.orden_id ? (
                    <div className="w-full md:w-72">
                      <AsignarOrden id={c.id} ordenes={opciones} />
                    </div>
                  ) : null}
                  {!anulado ? <Anular id={c.id} accion={anularComprobante} que="comprobante" /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
