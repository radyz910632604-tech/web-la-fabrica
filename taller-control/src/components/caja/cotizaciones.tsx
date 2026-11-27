"use client";

import { useRef, useState, useTransition } from "react";
import { FilePlus2, Pencil, Plus, Send, X } from "lucide-react";
import { crearCotizacion, editarCotizacion, enviarCotizacionWhatsapp, responderCotizacion, type Resultado } from "@/app/(app)/ordenes/[id]/dinero-acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Casilla } from "@/components/ui/casilla";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { formatearSoles } from "@/lib/formato";

type Linea = { clave: number; tipo: "servicio" | "repuesto"; descripcion: string; cantidad: string; precio: string };
const nueva = (clave: number, tipo: Linea["tipo"] = "servicio", descripcion = ""): Linea => ({ clave, tipo, descripcion, cantidad: "1", precio: "" });

/** Cotización que se va a editar (sus líneas con el precio por unidad). */
export type CotizacionEditable = {
  id: string;
  version: number;
  estado: string;
  conIgv: boolean;
  items: { descripcion: string; tipo: string; cantidad: number; precio: number }[];
};

const desdeItems = (items: CotizacionEditable["items"]): Linea[] =>
  items.map((i, k) => ({ clave: k, tipo: i.tipo === "repuesto" ? "repuesto" : "servicio", descripcion: i.descripcion, cantidad: String(i.cantidad), precio: String(i.precio) }));

/**
 * Crear una cotización con sus líneas (servicios y repuestos), o editar una ya hecha.
 * Al editar se guarda una versión nueva y la anterior queda anulada, a la vista.
 */
export function NuevaCotizacion({ ordenId, servicios = [], hayAprobada = false, editar }: { ordenId: string; servicios?: string[]; hayAprobada?: boolean; editar?: CotizacionEditable }) {
  const [abierta, setAbierta] = useState(false);
  const [adicional, setAdicional] = useState(hayAprobada);
  const [conIgv, setConIgv] = useState(editar ? editar.conIgv : true);
  const [preciosConIgv, setPreciosConIgv] = useState(true);
  const inicial = () => (editar ? desdeItems(editar.items) : servicios.length ? servicios.map((s, i) => nueva(i, "servicio", s)) : [nueva(0)]);
  const siguiente = useRef(editar ? editar.items.length + 1 : servicios.length + 1);
  const [lineas, setLineas] = useState<Linea[]>(inicial);
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const bruto = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
  const total = conIgv && !preciosConIgv ? bruto * 1.18 : bruto;
  const sinIgv = conIgv ? total / 1.18 : total;
  const cambiar = (clave: number, campo: keyof Linea, valor: string) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));

  return (
    <Ventana
      open={abierta}
      onOpenChange={(v) => {
        // Al abrir para editar, siempre parte de lo que está guardado.
        if (v && editar) {
          setLineas(desdeItems(editar.items));
          setConIgv(editar.conIgv);
          setPreciosConIgv(true);
          setR({});
        }
        setAbierta(v);
      }}
    >
      <DisparadorVentana asChild>
        {editar ? (
          <Boton variante="fantasma" tamano="chico">
            <Pencil />
            Editar
          </Boton>
        ) : (
          <Boton variante="secundario" tamano="chico">
            <FilePlus2 />
            Nueva cotización
          </Boton>
        )}
      </DisparadorVentana>
      <ContenidoVentana
        titulo={editar ? `Editar cotización · versión ${editar.version}` : "Nueva cotización"}
        descripcion={
          editar
            ? `Cambia precios, cantidades o líneas. Se guarda como versión ${editar.version + 1}; la versión ${editar.version} queda anulada y a la vista.${editar.estado === "aprobada" ? " Sigue aprobada." : ""}`
            : "Servicios y repuestos. Elige si lleva IGV (18 %) y cómo escribes los precios."
        }
      >
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {lineas.map((l, i) => (
              <li key={l.clave} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-end gap-2 rounded-2xl bg-interna p-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_auto]">
                <Selector aria-label={`Tipo de la línea ${i + 1}`} value={l.tipo} onChange={(ev) => cambiar(l.clave, "tipo", ev.target.value)} className="col-span-3 h-10 text-sm sm:col-span-4">
                  <option value="servicio">Servicio (mano de obra)</option>
                  <option value="repuesto">Repuesto</option>
                </Selector>
                <Campo etiqueta="Descripción" className="col-span-3 sm:col-span-1">{(p) => <Entrada {...p} value={l.descripcion} onChange={(ev) => cambiar(l.clave, "descripcion", ev.target.value)} />}</Campo>
                <Campo etiqueta="Cant.">{(p) => <Entrada {...p} type="number" min="0.01" step="0.01" inputMode="decimal" value={l.cantidad} onChange={(ev) => cambiar(l.clave, "cantidad", ev.target.value)} className="num px-3" />}</Campo>
                <Campo etiqueta={conIgv ? (preciosConIgv ? "Precio c/u con IGV" : "Precio c/u sin IGV") : "Precio c/u"}>{(p) => <Entrada {...p} type="number" min="0" step="0.01" inputMode="decimal" value={l.precio} onChange={(ev) => cambiar(l.clave, "precio", ev.target.value)} className="num px-3" />}</Campo>
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
          <div className="flex flex-wrap gap-2">
            <Boton type="button" variante="secundario" tamano="chico" onClick={() => setLineas((ls) => [...ls, nueva(siguiente.current++, "servicio")])}>
              <Plus />
              Servicio
            </Boton>
            <Boton type="button" variante="secundario" tamano="chico" onClick={() => setLineas((ls) => [...ls, nueva(siguiente.current++, "repuesto")])}>
              <Plus />
              Repuesto
            </Boton>
          </div>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="IGV">
            {(
              [
                [true, "Con IGV (18 %)", "Boleta o factura"],
                [false, "Sin IGV", "Operación sin IGV"],
              ] as const
            ).map(([v, t, d]) => (
              <button
                key={t}
                type="button"
                aria-pressed={conIgv === v}
                onClick={() => setConIgv(v)}
                className={`presionable cursor-pointer rounded-2xl border px-4 py-2.5 text-left ${conIgv === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna"}`}
              >
                <span className="block text-[15px] font-medium">{t}</span>
                <span className="block text-[13px] text-tinta-2">{d}</span>
              </button>
            ))}
          </div>
          {conIgv ? (
            <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
              <Casilla checked={preciosConIgv} onCheckedChange={(v) => setPreciosConIgv(v === true)} />
              Los precios que escribo ya incluyen IGV
            </label>
          ) : null}
          {editar ? null : (
            <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
              <Casilla checked={adicional} onCheckedChange={(v) => setAdicional(v === true)} />
              Es un trabajo adicional (lo encontrado al revisar)
            </label>
          )}
          <dl className="num flex flex-col gap-1 border-t border-regla pt-3 text-[15px]">
            {conIgv ? (
              <>
                <div className="flex justify-between text-tinta-2">
                  <dt>Sin IGV</dt>
                  <dd>{formatearSoles(sinIgv)}</dd>
                </div>
                <div className="flex justify-between text-tinta-2">
                  <dt>IGV 18 %</dt>
                  <dd>{formatearSoles(total - sinIgv)}</dd>
                </div>
              </>
            ) : null}
            <div className="flex justify-between text-lg font-semibold">
              <dt>Total</dt>
              <dd>{formatearSoles(total)}</dd>
            </div>
          </dl>
          {r.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{r.error}</p> : null}
          <Boton
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                const datos = lineas.map(({ tipo, descripcion, cantidad, precio }) => ({ tipo, descripcion, cantidad, precio }));
                const res = editar
                  ? await editarCotizacion(editar.id, ordenId, datos, { conIgv, preciosConIgv })
                  : await crearCotizacion(ordenId, adicional, datos, { conIgv, preciosConIgv });
                setR(res);
                if (res.ok) setAbierta(false);
              })
            }
          >
            {pendiente ? "Guardando…" : editar ? `Guardar como versión ${editar.version + 1}` : "Crear cotización"}
          </Boton>
        </div>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Botones según el estado: enviar, aprobar (con el medio), rechazar. */
export function RespuestaCotizacion({ id, ordenId, estado }: { id: string; ordenId: string | null; estado: string }) {
  const [pendiente, iniciar] = useTransition();
  const [aprobando, setAprobando] = useState(false);
  const [r, setR] = useState<Resultado>({});
  const responder = (datos: Record<string, string>) => iniciar(async () => setR(await responderCotizacion(id, ordenId ?? "", datos)));
  if (estado !== "borrador" && estado !== "enviada") return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {ordenId ? (
          <Boton variante="secundario" tamano="chico" disabled={pendiente} onClick={() => iniciar(async () => setR(await enviarCotizacionWhatsapp(id, ordenId)))}>
            <Send />
            {estado === "enviada" ? "Reenviar por WhatsApp" : "Enviar por WhatsApp"}
          </Boton>
        ) : null}
        {estado === "borrador" ? (
          <Boton variante="secundario" tamano="chico" disabled={pendiente} onClick={() => responder({ estado: "enviada" })}>
            Marcar enviada
          </Boton>
        ) : null}
        {aprobando ? (
          (
            [
              ["whatsapp", "Por WhatsApp"],
              ["presencial", "En persona"],
              ["llamada", "Por llamada"],
            ] as const
          ).map(([m, texto]) => (
            <Boton key={m} tamano="chico" disabled={pendiente} onClick={() => responder({ estado: "aprobada", medio: m })}>
              {texto}
            </Boton>
          ))
        ) : (
          <Boton tamano="chico" disabled={pendiente} onClick={() => setAprobando(true)}>
            Aprobada
          </Boton>
        )}
        <Boton variante="fantasma" tamano="chico" disabled={pendiente} onClick={() => responder({ estado: "rechazada" })}>
          Rechazada
        </Boton>
      </div>
      {r.error ? <p className="text-sm text-negativo">{r.error}</p> : null}
      {r.ok ? <p role="status" className="text-sm text-positivo">{r.ok}</p> : null}
    </div>
  );
}
