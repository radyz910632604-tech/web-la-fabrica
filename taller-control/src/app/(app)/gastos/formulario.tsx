"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { Chips, MEDIOS_CHIP } from "@/components/caja/eleccion-rapida";
import { completarComprobante, registrarGasto } from "./acciones";
import { CATEGORIAS_GASTO } from "./categorias";

/** Botón y ventana para registrar un gasto del taller: monto, un toque y listo; lo demás es opcional. */
export function RegistrarGasto({ hoy }: { hoy: string }) {
  const [abierta, setAbierta] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [detalle, setDetalle] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [otraFecha, setOtraFecha] = useState(false);
  const [conComprobante, setConComprobante] = useState(false);
  const [estado, accion, enviando] = useActionState(async (previo: Awaited<ReturnType<typeof registrarGasto>>, form: FormData) => {
    const r = await registrarGasto(previo, form);
    if (r.ok) {
      setAbierta(false);
      setCategoria("");
      setDetalle("");
      setConComprobante(false);
      setOtraFecha(false);
    }
    return r;
  }, {});
  const e = estado.errores ?? {};
  const descripcion = detalle.trim() || ((CATEGORIAS_GASTO as Record<string, string>)[categoria] ?? "");
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <Plus />
          Registrar gasto
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Registrar gasto" descripcion="Monto y un toque. Lo demás es opcional.">
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="categoria" value={categoria} />
          <input type="hidden" name="descripcion" value={descripcion} />
          <input type="hidden" name="medio" value={medio} />
          {!otraFecha ? <input type="hidden" name="fecha" value={hoy} /> : null}
          {!conComprobante ? <input type="hidden" name="tipo_comprobante" value="sin_comprobante" /> : null}
          <Campo etiqueta="Monto (S/)" error={e.monto}>
            {(p) => <Entrada {...p} name="monto" inputMode="decimal" placeholder="0.00" className="num text-lg" autoFocus required />}
          </Campo>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">¿En qué?</p>
            <Chips etiqueta="Categoría" opciones={Object.entries(CATEGORIAS_GASTO) as [string, string][]} valor={categoria} alElegir={setCategoria} tamano="chico" />
            {e.categoria ? <p className="text-sm text-negativo">{e.categoria}</p> : null}
          </div>
          <Campo etiqueta="Detalle (opcional)" error={e.descripcion}>
            {(p) => <Entrada {...p} value={detalle} onChange={(ev) => setDetalle(ev.target.value)} placeholder="Ejemplo: recibo de luz de noviembre" maxLength={200} autoComplete="off" />}
          </Campo>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Medio</p>
            <Chips etiqueta="Medio" opciones={MEDIOS_CHIP} valor={medio as never} alElegir={(v) => setMedio(v)} tamano="chico" />
          </div>
          {otraFecha ? (
            <Campo etiqueta="Fecha" error={e.fecha}>
              {(p) => <Entrada {...p} name="fecha" type="date" defaultValue={hoy} max={hoy} className="num" required />}
            </Campo>
          ) : null}
          {conComprobante ? (
            <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
              <Campo etiqueta="Comprobante">
                {(p) => (
                  <Selector {...p} name="tipo_comprobante" defaultValue="boleta">
                    <option value="boleta">Boleta</option>
                    <option value="factura">Factura</option>
                    <option value="recibo">Recibo</option>
                    <option value="otro">Otro</option>
                  </Selector>
                )}
              </Campo>
              <Campo etiqueta="Número" error={e.comprobante} ayuda="Si no lo tienes, déjalo: queda pendiente.">
                {(p) => <Entrada {...p} name="comprobante" placeholder="B001-4521" maxLength={40} autoComplete="off" />}
              </Campo>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {!otraFecha ? (
              <button type="button" onClick={() => setOtraFecha(true)} className="cursor-pointer text-[13px] text-tinta-2 underline-offset-4 hover:underline">
                + Fue otro día
              </button>
            ) : null}
            {!conComprobante ? (
              <button type="button" onClick={() => setConComprobante(true)} className="cursor-pointer text-[13px] text-tinta-2 underline-offset-4 hover:underline">
                + Tengo boleta, factura o recibo
              </button>
            ) : null}
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
