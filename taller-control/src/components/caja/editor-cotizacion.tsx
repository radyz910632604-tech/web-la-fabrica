"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Package, Percent, Plus, Wrench, X } from "lucide-react";
import { guardarCotizacion } from "@/app/(app)/cotizaciones/acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Casilla } from "@/components/ui/casilla";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearSoles } from "@/lib/formato";
import { lineasConIgv, totalesCotizacion } from "@/lib/taller/cotizacion";
import { cn } from "@/lib/utils";

type Linea = { clave: number; tipo: "servicio" | "repuesto"; descripcion: string; cantidad: string; precio: string };
export type InicialCotizacion = {
  id: string;
  ordenId: string | null;
  conIgv: boolean;
  cliente: { nombre: string; celular: string; documento: string; placa: string; vehiculo: string };
  items: { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; precio: number }[];
  descuento: { tipo: "monto" | "porcentaje"; valor: number; motivo: string } | null;
};

function Opcion({ activo, onClick, titulo, detalle }: { activo: boolean; onClick: () => void; titulo: string; detalle: string }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn("presionable cursor-pointer rounded-2xl border px-4 py-2.5 text-left", activo ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
    >
      <span className="block text-[15px] font-medium">{titulo}</span>
      <span className="block text-[13px] text-tinta-2">{detalle}</span>
    </button>
  );
}

/**
 * Editor de cotización: de una orden o suelta (cliente que aún no trae el carro), con productos y
 * servicios, IGV sí o no, y descuento con su motivo. El total se ve al instante.
 */
export function EditorCotizacion({
  inicial,
  ordenes,
  ordenFija,
  tasaIgv,
  servicios = [],
}: {
  inicial?: InicialCotizacion;
  ordenes: { id: string; etiqueta: string }[];
  ordenFija?: string | null;
  tasaIgv: number;
  servicios?: string[];
}) {
  const router = useRouter();
  const editando = Boolean(inicial);
  const [para, setPara] = useState<"orden" | "suelta">(inicial ? (inicial.ordenId ? "orden" : "suelta") : ordenFija || ordenes.length ? "orden" : "suelta");
  const [orden, setOrden] = useState(inicial?.ordenId ?? ordenFija ?? "");
  const [cliente, setCliente] = useState(inicial?.cliente ?? { nombre: "", celular: "", documento: "", placa: "", vehiculo: "" });
  const [conIgv, setConIgv] = useState(inicial?.conIgv ?? true);
  const [preciosConIgv, setPreciosConIgv] = useState(true);
  const inicialLineas = (): Linea[] =>
    inicial?.items.length
      ? inicial.items.map((i, k) => ({ clave: k, tipo: i.tipo, descripcion: i.descripcion, cantidad: String(i.cantidad), precio: String(i.precio) }))
      : servicios.length
        ? servicios.map((s, k) => ({ clave: k, tipo: "servicio", descripcion: s, cantidad: "1", precio: "" }))
        : [{ clave: 0, tipo: "servicio", descripcion: "", cantidad: "1", precio: "" }];
  const [lineas, setLineas] = useState<Linea[]>(inicialLineas);
  const siguiente = useRef(lineas.length + 1);
  const [conDescuento, setConDescuento] = useState(Boolean(inicial?.descuento));
  const [descTipo, setDescTipo] = useState<"monto" | "porcentaje">(inicial?.descuento?.tipo ?? "monto");
  const [descValor, setDescValor] = useState(inicial?.descuento ? String(inicial.descuento.valor) : "");
  const [descMotivo, setDescMotivo] = useState(inicial?.descuento?.motivo ?? "");
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();

  const cambiar = (clave: number, campo: keyof Linea, valor: string) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));
  const agregar = (tipo: Linea["tipo"]) => setLineas((ls) => [...ls, { clave: siguiente.current++, tipo, descripcion: "", cantidad: "1", precio: "" }]);
  const validas = lineas.filter((l) => Number(l.cantidad) > 0 && l.precio !== "");
  const items = lineasConIgv(
    validas.map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad), precio: Number(l.precio) })),
    { conIgv, preciosConIgv },
    tasaIgv,
  );
  const descuento = conDescuento && Number(descValor) > 0 ? { tipo: descTipo, valor: Number(descValor), motivo: descMotivo } : null;
  const t = totalesCotizacion(items.reduce((a, i) => a + i.total, 0), descuento, conIgv ? tasaIgv : 0);

  const guardar = () =>
    iniciar(async () => {
      setError(undefined);
      try {
        const r = await guardarCotizacion({
          id: inicial?.id ?? null,
          ordenId: para === "orden" ? orden || null : null,
          cliente,
          lineas: lineas.map(({ tipo, descripcion, cantidad, precio }) => ({ tipo, descripcion, cantidad, precio })),
          conIgv,
          preciosConIgv,
          descuento,
        });
        if (r.error || !r.id) setError(r.error ?? "No se pudo guardar.");
        else router.push(`/cotizaciones/${r.id}`);
      } catch {
        setError("No se pudo guardar. Revisa tu conexión e intenta otra vez.");
      }
    });

  return (
    <div className="grid min-w-0 items-start gap-4 xl:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
        {!editando && !ordenFija ? (
          <Tarjeta aria-labelledby="t-para">
            <CabeceraTarjeta id="t-para" titulo="¿Para quién es?" />
            <div className="grid grid-cols-2 gap-2">
              <Opcion activo={para === "orden"} onClick={() => setPara("orden")} titulo="Un carro en el taller" detalle="De una orden abierta" />
              <Opcion activo={para === "suelta"} onClick={() => setPara("suelta")} titulo="Cliente sin orden" detalle="Por teléfono o de paso" />
            </div>
            {para === "orden" ? (
              <div className="mt-4">
                <Campo etiqueta="Orden">
                  {(p) => (
                    <Selector {...p} value={orden} onChange={(e) => setOrden(e.target.value)}>
                      <option value="">Elige la orden…</option>
                      {ordenes.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.etiqueta}
                        </option>
                      ))}
                    </Selector>
                  )}
                </Campo>
              </div>
            ) : null}
          </Tarjeta>
        ) : null}
        {para === "suelta" ? (
          <Tarjeta aria-labelledby="t-cliente">
            <CabeceraTarjeta id="t-cliente" titulo="Cliente" detalle="Cuando traiga el carro, la pasas a su orden." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Nombre">{(p) => <Entrada {...p} value={cliente.nombre} onChange={(e) => setCliente({ ...cliente, nombre: e.target.value })} autoComplete="off" />}</Campo>
              <Campo etiqueta="Celular (opcional)">{(p) => <Entrada {...p} type="tel" inputMode="tel" value={cliente.celular} onChange={(e) => setCliente({ ...cliente, celular: e.target.value })} placeholder="987 654 321" />}</Campo>
              <Campo etiqueta="Placa (opcional)">{(p) => <Entrada {...p} value={cliente.placa} onChange={(e) => setCliente({ ...cliente, placa: e.target.value.toUpperCase() })} placeholder="ABC-123" className="uppercase" />}</Campo>
              <Campo etiqueta="Carro (opcional)">{(p) => <Entrada {...p} value={cliente.vehiculo} onChange={(e) => setCliente({ ...cliente, vehiculo: e.target.value })} placeholder="Toyota Yaris 2018" />}</Campo>
              <Campo etiqueta="DNI o RUC (opcional)">{(p) => <Entrada {...p} value={cliente.documento} onChange={(e) => setCliente({ ...cliente, documento: e.target.value })} inputMode="numeric" className="num" />}</Campo>
            </div>
          </Tarjeta>
        ) : null}

        <Tarjeta aria-labelledby="t-lineas">
          <CabeceraTarjeta id="t-lineas" titulo="Productos y servicios" detalle={conIgv ? (preciosConIgv ? "Precios con IGV" : "Precios sin IGV (se suma el 18 %)") : "Sin IGV"} />
          <ul className="flex flex-col gap-3">
            {lineas.map((l, i) => (
              <li key={l.clave} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-end gap-2 rounded-2xl bg-interna p-3 sm:grid-cols-[8.5rem_minmax(0,1fr)_5rem_7.5rem_auto]">
                <Selector aria-label={`Tipo de la línea ${i + 1}`} value={l.tipo} onChange={(e) => cambiar(l.clave, "tipo", e.target.value)} className="col-span-3 h-12 text-sm sm:col-span-1">
                  <option value="repuesto">Producto</option>
                  <option value="servicio">Servicio</option>
                </Selector>
                <Campo etiqueta="Descripción" className="col-span-3 sm:col-span-1">
                  {(p) => <Entrada {...p} value={l.descripcion} onChange={(e) => cambiar(l.clave, "descripcion", e.target.value)} placeholder={l.tipo === "servicio" ? "Cambio de aceite" : "Filtro de aceite"} />}
                </Campo>
                <Campo etiqueta="Cant.">{(p) => <Entrada {...p} type="number" min="0.01" step="0.01" inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(l.clave, "cantidad", e.target.value)} className="num px-3" />}</Campo>
                <Campo etiqueta="Precio c/u">{(p) => <Entrada {...p} type="number" min="0" step="0.01" inputMode="decimal" value={l.precio} onChange={(e) => cambiar(l.clave, "precio", e.target.value)} className="num px-3" />}</Campo>
                <button
                  type="button"
                  aria-label={`Quitar línea ${i + 1}`}
                  disabled={lineas.length === 1}
                  onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                  className="grid size-12 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hundida disabled:invisible"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <Boton type="button" variante="secundario" tamano="chico" onClick={() => agregar("repuesto")}>
              <Package />
              Producto
            </Boton>
            <Boton type="button" variante="secundario" tamano="chico" onClick={() => agregar("servicio")}>
              <Wrench />
              Servicio
            </Boton>
          </div>
        </Tarjeta>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:col-span-4">
        <Tarjeta aria-labelledby="t-igv">
          <CabeceraTarjeta id="t-igv" titulo="IGV" />
          <div className="grid grid-cols-2 gap-2">
            <Opcion activo={conIgv} onClick={() => setConIgv(true)} titulo="Con IGV (18 %)" detalle="Boleta o factura" />
            <Opcion activo={!conIgv} onClick={() => setConIgv(false)} titulo="Sin IGV" detalle="El precio es el total" />
          </div>
          {conIgv ? (
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-[15px]">
              <Casilla checked={preciosConIgv} onCheckedChange={(v) => setPreciosConIgv(v === true)} />
              Los precios que escribo ya incluyen IGV
            </label>
          ) : null}
        </Tarjeta>
        <Tarjeta aria-labelledby="t-desc">
          <CabeceraTarjeta
            id="t-desc"
            titulo="Descuento"
            accion={
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Casilla checked={conDescuento} onCheckedChange={(v) => setConDescuento(v === true)} aria-label="Agregar descuento" />
                Agregar
              </label>
            }
          />
          {conDescuento ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2">
                <div className="grid grid-cols-2 gap-1 self-end rounded-full bg-hundida p-1" role="group" aria-label="Tipo de descuento">
                  {(
                    [
                      ["monto", "S/"],
                      ["porcentaje", "%"],
                    ] as const
                  ).map(([v, txt]) => (
                    <button key={v} type="button" aria-pressed={descTipo === v} onClick={() => setDescTipo(v)} className={cn("h-10 cursor-pointer rounded-full text-sm font-medium", descTipo === v ? "bg-tarjeta shadow-sm" : "text-tinta-2")}>
                      {txt}
                    </button>
                  ))}
                </div>
                <Campo etiqueta={descTipo === "monto" ? "Monto (S/)" : "Porcentaje"}>
                  {(p) => <Entrada {...p} type="number" min="0" step="0.01" max={descTipo === "porcentaje" ? 100 : undefined} inputMode="decimal" value={descValor} onChange={(e) => setDescValor(e.target.value)} className="num" />}
                </Campo>
              </div>
              <Campo etiqueta="Motivo">{(p) => <Entrada {...p} value={descMotivo} onChange={(e) => setDescMotivo(e.target.value)} placeholder="Cliente frecuente" maxLength={200} />}</Campo>
            </div>
          ) : (
            <p className="text-sm text-tinta-2">Sin descuento.</p>
          )}
        </Tarjeta>
        <Tarjeta aria-labelledby="t-total">
          <CabeceraTarjeta id="t-total" titulo="Total" />
          <dl className="num flex flex-col gap-1 text-[15px]">
            <div className="flex justify-between text-tinta-2">
              <dt>Subtotal</dt>
              <dd>{formatearSoles(t.lineas)}</dd>
            </div>
            {t.descuento ? (
              <div className="flex justify-between text-positivo">
                <dt className="flex items-center gap-1">
                  <Percent className="size-3.5" aria-hidden />
                  Descuento{descTipo === "porcentaje" && descuento ? ` ${descuento.valor} %` : ""}
                </dt>
                <dd>−{formatearSoles(t.descuento)}</dd>
              </div>
            ) : null}
            {conIgv ? (
              <>
                <div className="flex justify-between text-tinta-2">
                  <dt>Sin IGV</dt>
                  <dd>{formatearSoles(t.sinIgv)}</dd>
                </div>
                <div className="flex justify-between text-tinta-2">
                  <dt>IGV 18 %</dt>
                  <dd>{formatearSoles(t.igv)}</dd>
                </div>
              </>
            ) : null}
            <div className="mt-1 flex justify-between border-t border-regla pt-2 text-[22px] font-semibold tracking-[-0.02em]">
              <dt>Total</dt>
              <dd>{formatearSoles(t.total)}</dd>
            </div>
          </dl>
          {error ? (
            <p role="alert" className="mt-3 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
              {error}
            </p>
          ) : null}
          <Boton className="mt-4 w-full" disabled={pendiente} onClick={guardar}>
            <Plus />
            {pendiente ? "Guardando…" : editando ? "Guardar cambios" : "Guardar cotización"}
          </Boton>
        </Tarjeta>
      </div>
    </div>
  );
}
