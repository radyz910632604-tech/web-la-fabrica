"use client";

import { useActionState, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Lock, LockOpen } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { MEDIOS } from "@/lib/dinero";
import { formatearSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { abrirCaja, cerrarCaja, registrarMovimiento, type Resultado } from "./acciones";

function CampoSoles({ nombre, etiqueta, error, ayuda, valor, onChange, autoFocus }: { nombre: string; etiqueta: string; error?: string; ayuda?: string; valor?: string; onChange?: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Campo etiqueta={etiqueta} error={error} ayuda={ayuda}>
      {(p) => (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
          <Entrada
            {...p}
            name={nombre}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            autoFocus={autoFocus}
            {...(onChange ? { value: valor ?? "", onChange: (e) => onChange(e.target.value) } : {})}
            className="num pl-11 text-lg"
          />
        </div>
      )}
    </Campo>
  );
}

export function AbrirCaja() {
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(abrirCaja, {});
  return (
    <form action={accion} className="flex flex-col gap-4 sm:max-w-sm">
      <CampoSoles nombre="monto" etiqueta="¿Con cuánto sencillo empiezas?" error={estado.errores?.monto} ayuda="El efectivo que hay en la caja ahora. Puede ser cero." />
      {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
      <Boton type="submit" disabled={enviando}>
        <LockOpen />
        {enviando ? "Abriendo…" : "Abrir caja"}
      </Boton>
    </form>
  );
}

export function Movimiento({ caja }: { caja: string }) {
  const [abierta, setAbierta] = useState(false);
  const [tipo, setTipo] = useState<"egreso" | "ingreso">("egreso");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarMovimiento(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const e = estado.errores ?? {};
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante="secundario">
          <ArrowUpRight />
          Gasto o ingreso
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Gasto o ingreso de caja" descripcion="Lo que entra o sale de la caja y no es pago de una orden.">
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="caja" value={caja} />
          <input type="hidden" name="tipo" value={tipo} />
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["egreso", "Sale dinero", "Gasto, movilidad, retiro", ArrowUpRight],
                ["ingreso", "Entra dinero", "Sencillo, otro ingreso", ArrowDownLeft],
              ] as const
            ).map(([v, t, d, Icono]) => (
              <button
                key={v}
                type="button"
                aria-pressed={tipo === v}
                onClick={() => setTipo(v)}
                className={cn("presionable cursor-pointer rounded-2xl border px-4 py-3 text-left", tipo === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
              >
                <Icono className="mb-1 size-5" aria-hidden />
                <span className="block text-[15px] font-medium">{t}</span>
                <span className="block text-[13px] text-tinta-2">{d}</span>
              </button>
            ))}
          </div>
          <Campo etiqueta="¿Para qué?" error={e.concepto}>
            {(p) => <Entrada {...p} name="concepto" placeholder={tipo === "egreso" ? "Ejemplo: movilidad para recoger repuesto" : "Ejemplo: sencillo traído por gerencia"} required />}
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <CampoSoles nombre="monto" etiqueta="Monto" error={e.monto} />
            <Campo etiqueta="Medio">
              {(p) => (
                <Selector {...p} name="medio" defaultValue="efectivo">
                  {Object.entries(MEDIOS).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
          </div>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : tipo === "egreso" ? "Registrar gasto" : "Registrar ingreso"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

export function CerrarCaja({ caja, esperado }: { caja: string; esperado: number }) {
  const [abierta, setAbierta] = useState(false);
  const [contado, setContado] = useState("");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await cerrarCaja(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const diferencia = contado === "" ? null : Math.round((Number(contado) - esperado) * 100) / 100;
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante="secundario">
          <Lock />
          Cerrar caja
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Cerrar caja" descripcion="Cuenta el efectivo que hay en la caja y escríbelo. Yape, Plin, tarjeta y transferencias no se cuentan: quedan en el resumen.">
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="caja" value={caja} />
          <CampoSoles nombre="contado" etiqueta="Efectivo contado" error={estado.errores?.contado} valor={contado} onChange={setContado} autoFocus />
          <dl className="num grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-interna px-4 py-3">
              <dt className="text-[13px] text-tinta-2">Debería haber</dt>
              <dd className="text-[17px] font-semibold">{formatearSoles(esperado)}</dd>
            </div>
            <div className={cn("rounded-2xl px-4 py-3", diferencia === null ? "bg-interna" : diferencia === 0 ? "bg-positivo-fondo" : diferencia > 0 ? "bg-aviso-fondo" : "bg-negativo-fondo")}>
              <dt className="text-[13px] text-tinta-2">{diferencia === null ? "Diferencia" : diferencia === 0 ? "Cuadra" : diferencia > 0 ? "Sobra" : "Falta"}</dt>
              <dd className={cn("text-[17px] font-semibold", diferencia !== null && diferencia < 0 && "text-negativo")}>{diferencia === null ? "—" : formatearSoles(Math.abs(diferencia))}</dd>
            </div>
          </dl>
          <Campo etiqueta="Observaciones" ayuda={diferencia ? "Explica la diferencia, si sabes por qué." : "Opcional."}>
            {(p) => <textarea {...p} name="observaciones" rows={2} className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta" />}
          </Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando || contado === ""} className="w-full">
            {enviando ? "Cerrando…" : "Cerrar caja"}
          </Boton>
          <p className="text-sm text-tinta-3">Una caja cerrada ya no se cambia. Lo que cobres después entra a la caja de mañana.</p>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}
