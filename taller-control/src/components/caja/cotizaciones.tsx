"use client";

import { useState, useTransition } from "react";
import { FilePlus2, Plus, X } from "lucide-react";
import { crearCotizacion, responderCotizacion, type Resultado } from "@/app/(app)/ordenes/[id]/dinero-acciones";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Casilla } from "@/components/ui/casilla";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { formatearSoles } from "@/lib/formato";

type Linea = { clave: number; tipo: "servicio" | "repuesto"; descripcion: string; cantidad: string; precio: string };
let siguiente = 1;
const nueva = (tipo: Linea["tipo"] = "servicio", descripcion = ""): Linea => ({ clave: siguiente++, tipo, descripcion, cantidad: "1", precio: "" });

/** Crear una cotización con sus líneas (servicios y repuestos), con precios que incluyen IGV. */
export function NuevaCotizacion({ ordenId, servicios, hayAprobada }: { ordenId: string; servicios: string[]; hayAprobada: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const [adicional, setAdicional] = useState(hayAprobada);
  const [lineas, setLineas] = useState<Linea[]>(() => (servicios.length ? servicios.map((s) => nueva("servicio", s)) : [nueva()]));
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const total = lineas.reduce((a, l) => a + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
  const cambiar = (clave: number, campo: keyof Linea, valor: string) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));

  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante="secundario" tamano="chico">
          <FilePlus2 />
          Nueva cotización
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Nueva cotización" descripcion="Precios como los ve el cliente, con IGV incluido.">
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {lineas.map((l, i) => (
              <li key={l.clave} className="grid grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_auto] items-end gap-2 rounded-2xl bg-interna p-3">
                <Selector aria-label={`Tipo de la línea ${i + 1}`} value={l.tipo} onChange={(ev) => cambiar(l.clave, "tipo", ev.target.value)} className="col-span-4 h-10 text-sm">
                  <option value="servicio">Servicio (mano de obra)</option>
                  <option value="repuesto">Repuesto</option>
                </Selector>
                <Campo etiqueta="Descripción">{(p) => <Entrada {...p} value={l.descripcion} onChange={(ev) => cambiar(l.clave, "descripcion", ev.target.value)} />}</Campo>
                <Campo etiqueta="Cant.">{(p) => <Entrada {...p} type="number" min="0.01" step="0.01" inputMode="decimal" value={l.cantidad} onChange={(ev) => cambiar(l.clave, "cantidad", ev.target.value)} className="num px-3" />}</Campo>
                <Campo etiqueta="Precio c/u">{(p) => <Entrada {...p} type="number" min="0" step="0.01" inputMode="decimal" value={l.precio} onChange={(ev) => cambiar(l.clave, "precio", ev.target.value)} className="num px-3" />}</Campo>
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
            <Boton type="button" variante="secundario" tamano="chico" onClick={() => setLineas((ls) => [...ls, nueva("servicio")])}>
              <Plus />
              Servicio
            </Boton>
            <Boton type="button" variante="secundario" tamano="chico" onClick={() => setLineas((ls) => [...ls, nueva("repuesto")])}>
              <Plus />
              Repuesto
            </Boton>
          </div>
          <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
            <Casilla checked={adicional} onCheckedChange={(v) => setAdicional(v === true)} />
            Es un trabajo adicional (lo encontrado al revisar)
          </label>
          <p className="num flex justify-between border-t border-regla pt-3 text-lg font-semibold">
            <span>Total</span>
            {formatearSoles(total)}
          </p>
          {r.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{r.error}</p> : null}
          <Boton
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                const res = await crearCotizacion(
                  ordenId,
                  adicional,
                  lineas.map(({ tipo, descripcion, cantidad, precio }) => ({ tipo, descripcion, cantidad, precio })),
                );
                setR(res);
                if (res.ok) setAbierta(false);
              })
            }
          >
            {pendiente ? "Guardando…" : "Crear cotización"}
          </Boton>
        </div>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Botones según el estado: enviar, aprobar (con el medio), rechazar. */
export function RespuestaCotizacion({ id, ordenId, estado }: { id: string; ordenId: string; estado: string }) {
  const [pendiente, iniciar] = useTransition();
  const [aprobando, setAprobando] = useState(false);
  const [r, setR] = useState<Resultado>({});
  const responder = (datos: Record<string, string>) => iniciar(async () => setR(await responderCotizacion(id, ordenId, datos)));
  if (estado !== "borrador" && estado !== "enviada") return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
