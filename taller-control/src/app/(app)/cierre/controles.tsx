"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { cerrarCajaDelDia, cerrarDia, type Resultado } from "./acciones";

export function ElegirDia({ dia, hoy }: { dia: string; hoy: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-[15px]">
      <span className="text-tinta-2">Día</span>
      <Entrada type="date" value={dia} max={hoy} onChange={(e) => e.target.value && router.push(`/cierre?dia=${e.target.value}`)} className="num h-11 w-auto" />
    </label>
  );
}

export function CerrarDia({ dia, descuadres }: { dia: string; descuadres: number }) {
  const [abierta, setAbierta] = useState(false);
  const [obs, setObs] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <Lock />
          Cerrar el día
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Cerrar el día" descripcion="Se guarda una copia de estos números tal como están ahora. Lo que registres después no la cambia.">
        {descuadres > 0 ? (
          <p className="mb-3 rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
            Hay {descuadres} {descuadres === 1 ? "cosa que no cuadra" : "cosas que no cuadran"}. Puedes cerrar igual y explicarlo abajo.
          </p>
        ) : null}
        <Campo etiqueta="Observaciones" ayuda="Opcional.">
          {(p) => (
            <textarea
              {...p}
              rows={3}
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta"
            />
          )}
        </Campo>
        {r.error ? <p role="alert" className="mt-3 text-sm text-negativo">{r.error}</p> : null}
        <Boton
          className="mt-4 w-full"
          disabled={pendiente}
          onClick={() =>
            iniciar(async () => {
              const res = await cerrarDia(dia, obs);
              setR(res);
              if (res.ok) setAbierta(false);
            })
          }
        >
          {pendiente ? "Cerrando…" : "Cerrar el día"}
        </Boton>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Cerrar caja desde el cierre diario: efectivo contado + observación, y se guarda el día. */
export function CerrarCajaDelDia({ dia, cajaId, esperado }: { dia: string; cajaId: string | null; esperado: number | null }) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const diferencia = esperado != null && contado !== "" ? Math.round((Number(contado.replace(",", ".")) - esperado) * 100) / 100 : null;
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton className="h-12 w-full">
          <Lock />
          Cerrar caja
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Cerrar caja" descripcion={cajaId ? "Cuenta el efectivo de la caja y escríbelo. Lo guardado queda como histórico." : "La caja ya está cerrada. Se guarda el cierre del día tal como está."}>
        <div className="flex flex-col gap-4">
          {cajaId ? (
            <>
              <p className="num flex justify-between rounded-2xl bg-interna px-4 py-3 text-[15px]">
                <span>Saldo esperado (sistema)</span>
                <span className="font-semibold">S/ {(esperado ?? 0).toFixed(2)}</span>
              </p>
              <Campo etiqueta="Efectivo contado (físico)">
                {(p) => <Entrada {...p} value={contado} onChange={(e) => setContado(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" placeholder="0.00" className="num text-lg" autoFocus />}
              </Campo>
              {diferencia !== null ? (
                <p className={`num text-[15px] font-medium ${diferencia === 0 ? "text-positivo" : "text-negativo"}`}>
                  {diferencia === 0 ? "Cuadra exacto." : diferencia > 0 ? `Sobran S/ ${diferencia.toFixed(2)}` : `Faltan S/ ${Math.abs(diferencia).toFixed(2)}`}
                </p>
              ) : null}
            </>
          ) : null}
          <Campo etiqueta="Observación" ayuda={diferencia ? "Explica la diferencia, si sabes por qué." : "Opcional."}>
            {(p) => <Entrada {...p} value={obs} onChange={(e) => setObs(e.target.value)} maxLength={1000} placeholder="Sin observaciones" />}
          </Campo>
          {r.error ? <p role="alert" className="text-sm text-negativo">{r.error}</p> : null}
          <Boton
            className="h-12 w-full"
            disabled={pendiente || (Boolean(cajaId) && contado === "")}
            onClick={() =>
              iniciar(async () => {
                const res = await cerrarCajaDelDia(dia, cajaId, contado, obs);
                setR(res);
                if (res.ok) {
                  setAbierta(false);
                  router.refresh();
                }
              })
            }
          >
            {pendiente ? "Cerrando…" : "Cerrar caja"}
          </Boton>
        </div>
      </ContenidoVentana>
    </Ventana>
  );
}
