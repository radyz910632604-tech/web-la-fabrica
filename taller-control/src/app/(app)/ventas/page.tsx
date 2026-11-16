import Link from "next/link";
import { notFound } from "next/navigation";
import { Anular } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { CAJA, tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { MOTIVOS_NOTA } from "@/lib/dinero";
import { anularComprobante, anularNotaCredito } from "./acciones";
import { AsignarOrden, RegistrarComprobante, RegistrarNota } from "./formulario";

export const metadata = { title: "Comprobantes de venta" };

export default async function Ventas({ searchParams }: { searchParams: Promise<{ nuevo?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, CAJA)) notFound();
  const { nuevo } = await searchParams;
  const supabase = await clienteServidor();
  const hoy = diaEnLima(new Date());
  const [{ data }, ordenes, { data: notasCrudas }] = await Promise.all([
    supabase
      .from("comprobantes_venta")
      .select("id, orden_id, tipo, serie, numero, fecha_emision, subtotal_sin_igv, igv, total, estado, origen_datos, motivo_anulacion")
      .eq("empresa_id", ctx.taller.id)
      .order("fecha_emision", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(60),
    listarOrdenes(ctx.taller.id, { limite: 200, orden: "reciente" }),
    supabase
      .from("notas_credito")
      .select("id, comprobante_id, serie, numero, fecha_emision, total, estado, motivo_codigo, motivo, motivo_anulacion")
      .eq("empresa_id", ctx.taller.id)
      .order("fecha_emision", { ascending: false })
      .limit(200),
  ]);
  const notas = notasCrudas ?? [];
  const notasDe = (id: string) => notas.filter((x) => x.comprobante_id === id);
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const opciones = ordenes.map((o) => ({ id: o.id, etiqueta: `${numeroOrden(o.numero)} · ${o.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}${o.cliente ? ` · ${o.cliente}` : ""}` }));
  const lista = data ?? [];
  const sinOrden = lista.filter((c) => !c.orden_id && c.estado !== "anulado");
  const delMes = lista.filter((c) => c.estado === "confirmado" && c.fecha_emision.slice(0, 7) === hoy.slice(0, 7));
  const notasMes = notas.filter((x) => x.estado === "confirmado" && x.fecha_emision.slice(0, 7) === hoy.slice(0, 7));
  const netoMes = delMes.reduce((a, c) => a + Number(c.total), 0) - notasMes.reduce((a, x) => a + Number(x.total), 0);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Comprobantes de venta"
        detalle={`${delMes.length} este mes por ${formatearSoles(netoMes)}${notasMes.length ? ` (ya restadas ${notasMes.length} ${notasMes.length === 1 ? "nota" : "notas"} de crédito)` : ""}${sinOrden.length ? ` · ${sinOrden.length} sin orden asignada` : ""}. El sistema no emite comprobantes: registra los que ya entregaste.`}
        accion={<RegistrarComprobante ordenes={opciones} hoy={hoy} abrir={nuevo === "1"} />}
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
                <li key={c.id} className="flex flex-col gap-3 border-t border-regla py-3 first:border-t-0 md:flex-row md:flex-wrap md:items-center">
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
                  {!anulado
                    ? (() => {
                        const usadas = notasDe(c.id).filter((x) => x.estado === "confirmado").reduce((a, x) => a + Number(x.total), 0);
                        const disponible = Math.round((Number(c.total) - usadas) * 100) / 100;
                        return (
                          <div className="flex items-center gap-1">
                            <EnlacePdf href={`/pdf/comprobante/${c.id}`} />
                            {disponible > 0.009 ? <RegistrarNota comprobante={c.id} etiqueta={`${c.serie}-${c.numero}`} disponible={disponible} hoy={hoy} /> : null}
                            <Anular id={c.id} accion={anularComprobante} que="comprobante" />
                          </div>
                        );
                      })()
                    : null}
                  {notasDe(c.id).length ? (
                    <ul className="w-full basis-full md:pl-0">
                      {notasDe(c.id).map((x) => (
                        <li key={x.id} className="mt-1 flex items-center gap-3 rounded-2xl bg-interna px-4 py-2">
                          <p className={`min-w-0 flex-1 text-[14px] ${x.estado === "anulado" ? "text-tinta-3 line-through" : ""}`}>
                            Nota de crédito {x.serie}-{x.numero}
                            <span className="num ml-2 text-negativo">−{formatearSoles(Number(x.total))}</span>
                            <span className="block text-[13px] text-tinta-3">
                              {x.fecha_emision.split("-").reverse().join("/")} · {MOTIVOS_NOTA[x.motivo_codigo]}
                              {x.motivo ? ` · ${x.motivo}` : ""}
                              {x.estado === "anulado" ? ` · Anulada: ${x.motivo_anulacion}` : ""}
                            </span>
                          </p>
                          {x.estado !== "anulado" ? <Anular id={x.id} accion={anularNotaCredito} que="nota de crédito" /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
