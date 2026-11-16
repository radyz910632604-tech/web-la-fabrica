"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { registrarGasto } from "./acciones";
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
            <Campo etiqueta="Comprobante (opcional)" error={e.comprobante}>
              {(p) => <Entrada {...p} name="comprobante" placeholder="Recibo de luz 123" maxLength={40} />}
            </Campo>
          </div>
          {estado.error ? <p role="alert" className="text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="h-12 w-full">
            {enviando ? "Guardando…" : "Guardar gasto"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}
