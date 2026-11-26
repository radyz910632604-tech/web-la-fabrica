"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { completarComprobante, registrarGasto } from "./acciones";
import { CATEGORIAS_GASTO } from "./categorias";

/** Botón y ventana para registrar un gasto del taller. */
export function RegistrarGasto({ hoy }: { hoy: string }) {
  const [abierta, setAbierta] = useState(false);
  const [estado, accion, enviando] = useActionState(async (previo: Awaited<ReturnType<typeof registrarGasto>>, form: FormData) => {
    const r = await registrarGasto(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const e = estado.errores ?? {};
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <Plus />
          Registrar gasto
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Registrar gasto" descripcion="Lo que cuesta tener el taller abierto. Se resta para la utilidad neta.">
        <form action={accion} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Fecha" error={e.fecha}>
              {(p) => <Entrada {...p} name="fecha" type="date" defaultValue={hoy} max={hoy} className="num" required />}
            </Campo>
            <Campo etiqueta="Monto (S/)" error={e.monto}>
              {(p) => <Entrada {...p} name="monto" inputMode="decimal" placeholder="0.00" className="num" required />}
            </Campo>
          </div>
          <Campo etiqueta="Categoría" error={e.categoria}>
            {(p) => (
              <Selector {...p} name="categoria" defaultValue="" required>
                <option value="" disabled>
                  Elige una
                </option>
                {Object.entries(CATEGORIAS_GASTO).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Detalle" error={e.descripcion}>
            {(p) => <Entrada {...p} name="descripcion" placeholder="Alquiler de noviembre" maxLength={200} required />}
          </Campo>
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="¿Cómo se pagó?">
              {(p) => (
                <Selector {...p} name="medio" defaultValue="">
                  <option value="">Sin dato</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="yape">Yape</option>
                  <option value="plin">Plin</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="transferencia">Transferencia</option>
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Comprobante">
              {(p) => (
                <Selector {...p} name="tipo_comprobante" defaultValue="boleta">
                  <option value="boleta">Boleta</option>
                  <option value="factura">Factura</option>
                  <option value="recibo">Recibo</option>
                  <option value="otro">Otro</option>
                  <option value="sin_comprobante">Sin comprobante</option>
                </Selector>
              )}
            </Campo>
          </div>
          <Campo etiqueta="Número de comprobante" error={e.comprobante} ayuda="Si no lo tienes a la mano, déjalo vacío: queda «pendiente» y lo completas después.">
            {(p) => <Entrada {...p} name="comprobante" placeholder="B001-4521" maxLength={40} autoComplete="off" />}
          </Campo>
          {estado.error ? <p role="alert" className="text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="h-12 w-full">
            {enviando ? "Guardando…" : "Guardar gasto"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Completar el número de un comprobante que quedó pendiente (rápido, en la misma fila). */
export function CompletarComprobante({ id }: { id: string }) {
  const [abierto, setAbierto] = useState(false);
  const [numero, setNumero] = useState("");
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();
  if (!abierto)
    return (
      <button type="button" onClick={() => setAbierto(true)} className="mt-1 inline-flex cursor-pointer rounded-full bg-aviso-fondo px-2.5 py-0.5 text-[12px] font-medium text-aviso hover:bg-aviso-fondo/70">
        Comprobante pendiente · completar
      </button>
    );
  return (
    <form
      className="mt-1.5 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await completarComprobante(id, numero);
          if (r.error) setError(r.error);
        });
      }}
    >
      <Entrada aria-label="Número de comprobante" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="B001-4521" maxLength={40} autoFocus className="h-10 w-40 text-sm" />
      <Boton type="submit" tamano="chico" disabled={pendiente || numero.trim().length < 2}>
        {pendiente ? "Guardando…" : "Guardar"}
      </Boton>
      {error ? <span className="text-[13px] text-negativo">{error}</span> : null}
    </form>
  );
}
