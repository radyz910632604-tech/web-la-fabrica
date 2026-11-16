import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { Anular } from "@/components/caja/controles";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { Boton } from "@/components/ui/boton";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { enSoles } from "@/lib/dinero";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes } from "@/lib/taller/consultas";
import { etiquetaOrden, numeroOrden } from "@/lib/taller/estados";
import { cn } from "@/lib/utils";
import { anularCompra } from "./acciones";
import { EntregarRepuesto } from "./controles";

export const metadata = { title: "Compras" };

const TIPO: Record<string, string> = { factura: "Factura", boleta: "Boleta", nota_venta: "Nota de venta", ticket: "Ticket", sin_comprobante: "Sin comprobante" };

type Item = { id: string; descripcion: string; cantidad: number; total: number; destino: string; orden_id: string | null };

export default async function Compras({ searchParams }: { searchParams: Promise<{ ver?: string; registrada?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen"])) notFound();
  const { ver, registrada } = await searchParams;
  const verStock = ver === "stock";
  const registra = tieneAlguno(ctx.roles, ["gerencia", "administrador", "almacen"]);
  const supabase = await clienteServidor();
  const hoy = diaEnLima(new Date());
  const [{ data }, ordenes] = await Promise.all([
    supabase
      .from("compras")
      .select("id, tipo_comprobante, serie, numero, fecha_emision, moneda, tipo_cambio, subtotal_sin_igv, total, estado, motivo_anulacion, origen_datos, proveedores (razon_social), compra_items (id, descripcion, cantidad, total, destino, orden_id)")
      .eq("empresa_id", ctx.taller.id)
      .order("fecha_emision", { ascending: false })
      .order("creado_en", { ascending: false })
      .limit(80),
    listarOrdenes(ctx.taller.id, { limite: 300, orden: "reciente" }),
  ]);
  const porId = new Map(ordenes.map((o) => [o.id, o]));
  const activas = ordenes.filter((o) => o.estado !== "entregado").map((o) => ({ id: o.id, etiqueta: etiquetaOrden(o) }));
  const compras = (data ?? []).map((c) => ({
    ...c,
    proveedor: (Array.isArray(c.proveedores) ? c.proveedores[0] : c.proveedores)?.razon_social ?? "Proveedor",
    items: (c.compra_items ?? []) as Item[],
  }));
  const vigentes = compras.filter((c) => c.estado !== "anulado");
  const delMes = vigentes.filter((c) => c.fecha_emision.slice(0, 7) === hoy.slice(0, 7));
  const totalMes = delMes.reduce((a, c) => a + enSoles(Number(c.total), c.moneda as "PEN" | "USD", Number(c.tipo_cambio)), 0);
  const enStock = vigentes.flatMap((c) => c.items.filter((i) => i.destino === "stock").map((i) => ({ ...i, proveedor: c.proveedor, fecha: c.fecha_emision })));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Compras"
        detalle={`${delMes.length} este mes por ${formatearSoles(totalMes)} · ${enStock.length} ${enStock.length === 1 ? "repuesto" : "repuestos"} en stock sin orden.`}
        accion={
          registra ? (
            <Boton asChild>
              <Link href="/compras/nueva">
                <Plus />
                Registrar compra
              </Link>
            </Boton>
          ) : undefined
        }
      />
      <SubnavCaja actual="/compras" roles={ctx.roles} />
      {registrada ? <p className="rounded-2xl bg-positivo-fondo px-4 py-3 text-[15px] text-positivo">Compra registrada.</p> : null}

      <div className="flex gap-1 self-start rounded-full bg-hundida p-1">
        {[
          ["Todas las compras", "/compras", !verStock],
          [`Stock sin orden (${enStock.length})`, "/compras?ver=stock", verStock],
        ].map(([n, href, activo]) => (
          <Link
            key={String(href)}
            href={String(href)}
            aria-current={activo ? "page" : undefined}
            className={cn("presionable flex h-10 items-center rounded-full px-4 text-sm", activo ? "bg-tarjeta font-medium shadow-reposo" : "text-tinta-2 hover:text-tinta")}
          >
            {n}
          </Link>
        ))}
      </div>

      {verStock ? (
        <Tarjeta aria-labelledby="t-stock">
          <CabeceraTarjeta id="t-stock" titulo="Entregar repuesto" detalle="Repuestos comprados para el stock. Al entregarlos a una orden, su costo pasa a esa orden." />
          {enStock.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">No hay repuestos en stock sin orden.</p>
          ) : (
            <ul className="flex flex-col">
              {enStock.map((i) => (
                <li key={i.id} className="flex flex-col gap-3 border-t border-regla py-3 first:border-t-0 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-medium">{i.descripcion}</p>
                    <p className="num text-[13px] text-tinta-3">
                      {Number(i.cantidad)} u. · {formatearSoles(Number(i.total))} · {i.proveedor} · {i.fecha.split("-").reverse().join("/")}
                    </p>
                  </div>
                  {registra ? (
                    <div className="w-full md:w-80">
                      <EntregarRepuesto id={i.id} ordenes={activas} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      ) : (
        <Tarjeta aria-labelledby="t-compras">
          <CabeceraTarjeta id="t-compras" titulo="Últimas compras" />
          {compras.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Todavía no hay compras registradas.</p>
          ) : (
            <ul className="flex flex-col">
              {compras.map((c) => {
                const anulado = c.estado === "anulado";
                const destinos = [...new Set(c.items.map((i) => (i.orden_id ? numeroOrden(porId.get(i.orden_id)?.numero ?? 0) : "stock")))];
                return (
                  <li key={c.id} className="flex items-start gap-3 border-t border-regla py-3 first:border-t-0">
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-[15px] font-medium", anulado && "text-tinta-3 line-through")}>
                        {c.proveedor}
                        <span className="num ml-2 font-normal text-tinta-2">
                          {c.moneda === "USD" ? `US$ ${Number(c.total).toFixed(2)}` : formatearSoles(Number(c.total))}
                        </span>
                      </p>
                      <p className="text-[13px] text-tinta-3">
                        {TIPO[c.tipo_comprobante]}
                        {c.serie ? ` ${c.serie}-${c.numero}` : ""} · {c.fecha_emision.split("-").reverse().join("/")}
                        {c.origen_datos === "xml_sunat" ? " · leído del XML" : ""}
                        {anulado ? ` · Anulada: ${c.motivo_anulacion}` : ""}
                      </p>
                      <p className="mt-1 text-[13px] text-tinta-2">
                        {c.items.map((i) => i.descripcion).join(", ")}
                        {destinos.length ? (
                          <span className="text-tinta-3">
                            {" → "}
                            {c.items.some((i) => i.orden_id)
                              ? [...new Set(c.items.filter((i) => i.orden_id).map((i) => i.orden_id as string))].map((id, k) => (
                                  <span key={id}>
                                    {k > 0 ? ", " : ""}
                                    <Link href={`/ordenes/${id}`} className="underline-offset-4 hover:underline">
                                      {numeroOrden(porId.get(id)?.numero ?? 0)}
                                    </Link>
                                  </span>
                                ))
                              : null}
                            {c.items.some((i) => !i.orden_id) ? `${c.items.some((i) => i.orden_id) ? ", " : ""}stock` : ""}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <EnlacePdf href={`/pdf/compra/${c.id}`} />
                    {!anulado && registra ? <Anular id={c.id} accion={anularCompra} que="compra" /> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
      )}
    </div>
  );
}
