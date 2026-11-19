"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { cerrarDia, type Resultado } from "./acciones";

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
