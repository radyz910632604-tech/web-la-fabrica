"use client";

import { useState, useTransition } from "react";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Casilla } from "@/components/ui/casilla";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";

type Resultado = { ok?: string; error?: string };

/**
 * Revisar y confirmar montos leídos por IA (o llegados por WhatsApp).
 * Muestra el original y pide marcar que se revisó antes de confirmar.
 */
export function ConfirmarMontos({
  id,
  titulo,
  filas,
  archivo,
  accion,
}: {
  id: string;
  titulo: string;
  filas: [string, string][];
  archivo?: string | null;
  accion: (id: string) => Promise<Resultado>;
}) {
  const [abierta, setAbierta] = useState(false);
  const [revisado, setRevisado] = useState(false);
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <Ventana
      open={abierta}
      onOpenChange={(v) => {
        setAbierta(v);
        if (v) {
          setRevisado(false);
          setR({});
        }
      }}
    >
      <DisparadorVentana asChild>
        <Boton variante="secundario" tamano="chico">
          <BadgeCheck />
          Revisar
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo={titulo} descripcion="Compara cada dato con el original. Si algo está mal, anúlalo y regístralo de nuevo.">
        <dl className="num flex flex-col rounded-2xl bg-interna px-4 py-2">
          {filas.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-t border-regla py-2 text-[15px] first:border-t-0">
              <dt className="text-tinta-2">{k}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        {archivo ? (
          <a href={archivo} target="_blank" rel="noreferrer" className="presionable mt-3 flex h-12 items-center justify-center gap-2 rounded-full bg-hundida text-[15px] font-medium hover:bg-control/70">
            <ExternalLink className="size-[18px]" aria-hidden />
            Ver el comprobante original
          </a>
        ) : (
          <p className="mt-3 text-sm text-tinta-3">No se guardó el archivo original.</p>
        )}
        <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-[15px]">
          <Casilla className="mt-0.5" checked={revisado} onCheckedChange={(x) => setRevisado(x === true)} />
          <span>Revisé los montos con el original y están bien.</span>
        </label>
        {r.error ? <p role="alert" className="mt-3 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{r.error}</p> : null}
        <Boton
          className="mt-4 w-full"
          disabled={!revisado || pendiente}
          onClick={() =>
            iniciar(async () => {
              const res = await accion(id);
              setR(res);
              if (res.ok) setAbierta(false);
            })
          }
        >
          <BadgeCheck />
          {pendiente ? "Confirmando…" : "Confirmar montos"}
        </Boton>
      </ContenidoVentana>
    </Ventana>
  );
}
