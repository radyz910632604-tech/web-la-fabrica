"use client";

import { useActionState, useState, useTransition } from "react";
import { Banknote } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { registrarPago, type Resultado } from "@/app/(app)/cobros/acciones";
import { cn } from "@/lib/utils";

const MEDIOS = [
  ["efectivo", "Efectivo"],
  ["yape", "Yape"],
  ["plin", "Plin"],
  ["tarjeta", "Tarjeta"],
  ["transferencia", "Transferencia"],
] as const;

export type OpcionOrden = { id: string; etiqueta: string; saldo: number; entregada: boolean };

/** Registrar un pago: orden, monto, adelanto o saldo, medio y número de operación. */
export function RegistrarPago({
  ordenes,
  ordenFija,
  abrir = false,
  texto = "Registrar pago",
  variante = "primario",
  tamano = "normal",
}: {
  ordenes: OpcionOrden[];
  ordenFija?: string;
  abrir?: boolean;
  texto?: string;
  variante?: "primario" | "secundario";
  tamano?: "normal" | "chico";
}) {
  const [abierta, setAbierta] = useState(abrir);
  const [orden, setOrden] = useState(ordenFija ?? "");
  const [medio, setMedio] = useState("");
  const elegida = ordenes.find((o) => o.id === orden);
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarPago(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const e = estado.errores ?? {};
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante={variante} tamano={tamano}>
          <Banknote />
          {texto}
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Registrar pago" descripcion="Adelanto o saldo de una orden.">
        <form action={accion} className="flex flex-col gap-4">
          {ordenFija ? (
            <input type="hidden" name="orden" value={ordenFija} />
          ) : (
            <Campo etiqueta="Orden" error={e.orden}>
              {(p) => (
                <Selector {...p} name="orden" value={orden} onChange={(ev) => setOrden(ev.target.value)} required>
                  <option value="" disabled>
                    Elige la orden
                  </option>
                  {ordenes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.etiqueta}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
          )}
          <Campo etiqueta="Monto" error={e.monto} ayuda={elegida && elegida.saldo > 0 ? `Saldo pendiente: S/ ${elegida.saldo.toFixed(2)}` : undefined}>
            {(p) => (
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
                <Entrada {...p} name="monto" type="number" inputMode="decimal" step="0.01" min="0.01" defaultValue={elegida && elegida.saldo > 0 ? elegida.saldo.toFixed(2) : ""} key={orden} className="num pl-11" required />
              </div>
            )}
          </Campo>
          <Campo etiqueta="Tipo">
            {(p) => (
              <Selector {...p} name="tipo" defaultValue={elegida?.entregada ? "saldo" : "adelanto"} key={`t-${orden}`}>
                <option value="adelanto">Adelanto</option>
                <option value="saldo">Saldo (pago final)</option>
              </Selector>
            )}
          </Campo>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">¿Cómo pagó?</legend>
            <input type="hidden" name="medio" value={medio} />
            <div className="flex flex-wrap gap-2">
              {MEDIOS.map(([v, n]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={medio === v}
                  onClick={() => setMedio(v)}
                  className={cn(
                    "presionable min-h-11 cursor-pointer rounded-full border px-4 text-[15px]",
                    medio === v ? "border-primario bg-primario text-primario-tinta" : "border-borde bg-tarjeta hover:bg-interna",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            {e.medio ? <p className="mt-2 text-sm text-negativo">{e.medio}</p> : null}
          </fieldset>
          <Campo etiqueta="Número de operación" ayuda="Opcional (Yape, Plin, transferencia o voucher)." error={e.operacion}>
            {(p) => <Entrada {...p} name="operacion" />}
          </Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : "Registrar pago"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Anular un registro de dinero (nunca se borra): pide el motivo. */
export function Anular({ id, accion, que }: { id: string; accion: (id: string, motivo: string) => Promise<Resultado>; que: string }) {
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <button type="button" className="cursor-pointer rounded-full px-2 py-1 text-[13px] text-negativo hover:bg-negativo-fondo">
          Anular
        </button>
      </DisparadorVentana>
      <ContenidoVentana titulo={`Anular ${que}`} descripcion="No se borra: queda anulado con el motivo, y se puede ver en la auditoría.">
        <Campo etiqueta="Motivo">{(p) => <Entrada {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ejemplo: se registró dos veces" />}</Campo>
        {r.error ? <p role="alert" className="mt-3 text-sm text-negativo">{r.error}</p> : null}
        <Boton
          variante="peligro"
          className="mt-4 w-full"
          disabled={pendiente || motivo.trim().length < 5}
          onClick={() =>
            iniciar(async () => {
              const res = await accion(id, motivo);
              setR(res);
              if (res.ok) setAbierta(false);
            })
          }
        >
          Anular {que}
        </Boton>
      </ContenidoVentana>
    </Ventana>
  );
}
