"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { registrarCobro } from "@/app/(app)/cobros/acciones";
import { Chips, MEDIOS_CHIP } from "@/components/caja/eleccion-rapida";
import { Boton } from "@/components/ui/boton";
import { Entrada } from "@/components/ui/campo";
import { formatearSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";

type Medio = (typeof MEDIOS_CHIP)[number][0];
type Linea = { clave: string; medio: Medio | ""; monto: string; operacion: string };

const nuevaLinea = (monto = ""): Linea => ({ clave: crypto.randomUUID(), medio: "", monto, operacion: "" });
const aNumero = (t: string) => {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Cobrar una orden: uno o varios medios a la vez (pago mixto). La suma se ve en vivo,
 * pero quien decide es la base (saldo real, todo o nada, sin duplicar).
 */
export function FormCobro({ ordenId, saldo, conPrecio }: { ordenId: string; saldo: number; conPrecio: boolean }) {
  const router = useRouter();
  const [lineas, setLineas] = useState<Linea[]>(() => [nuevaLinea(saldo > 0 ? saldo.toFixed(2) : "")]);
  // Un código por cobro: si se envía dos veces (doble toque, conexión lenta), la base no lo repite.
  const [cobroId, setCobroId] = useState(() => crypto.randomUUID());
  const [mensaje, setMensaje] = useState<{ ok?: string; error?: string }>({});
  const [enviando, iniciar] = useTransition();

  const suma = Math.round(lineas.reduce((a, l) => a + aNumero(l.monto), 0) * 100) / 100;
  const queda = Math.round((saldo - suma) * 100) / 100;
  const cambiar = (clave: string, cambio: Partial<Linea>) => {
    setMensaje({});
    setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, ...cambio } : l)));
  };

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setMensaje({});
    if (lineas.some((l) => !l.medio)) return setMensaje({ error: "Toca cómo pagó en cada monto." });
    if (lineas.some((l) => aNumero(l.monto) <= 0)) return setMensaje({ error: "Cada monto debe ser mayor que cero." });
    if (conPrecio && queda < -0.009) return setMensaje({ error: `Es más de lo que falta cobrar (${formatearSoles(saldo)}).` });
    iniciar(async () => {
      const r = await registrarCobro({
        orden: ordenId,
        cobro: cobroId,
        lineas: lineas.map((l) => ({ medio: l.medio, monto: aNumero(l.monto), operacion: l.operacion })),
      });
      setMensaje({ ok: r.ok, error: r.error });
      if (r.ok) {
        const nuevoSaldo = r.saldo ?? 0;
        setCobroId(crypto.randomUUID());
        setLineas([nuevaLinea(nuevoSaldo > 0 ? nuevoSaldo.toFixed(2) : "")]);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
      <ol className="flex flex-col gap-3">
        {lineas.map((l, i) => (
          <li key={l.clave} className="flex flex-col gap-3 rounded-2xl bg-interna p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-tinta-2">{lineas.length > 1 ? `Pago ${i + 1}` : "¿Cómo pagó?"}</span>
              {lineas.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                  className="grid size-9 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-tarjeta"
                  aria-label={`Quitar pago ${i + 1}`}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <Chips etiqueta={`Medio del pago ${i + 1}`} opciones={MEDIOS_CHIP} valor={l.medio} alElegir={(v) => cambiar(l.clave, { medio: v })} tamano="chico" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Monto</span>
                <span className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
                  <Entrada
                    value={l.monto}
                    onChange={(ev) => cambiar(l.clave, { monto: ev.target.value.replace(/[^\d.,]/g, "") })}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="num pl-11 text-[17px]"
                    aria-label={`Monto del pago ${i + 1}`}
                  />
                </span>
              </label>
              {l.medio && l.medio !== "efectivo" ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">N° de operación</span>
                  <Entrada
                    value={l.operacion}
                    onChange={(ev) => cambiar(l.clave, { operacion: ev.target.value })}
                    maxLength={40}
                    placeholder={l.medio === "tarjeta" ? "Voucher" : "Opcional"}
                    autoComplete="off"
                    aria-label={`Número de operación del pago ${i + 1}`}
                  />
                </label>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {lineas.length < 6 ? (
        <button
          type="button"
          onClick={() => setLineas((ls) => [...ls, nuevaLinea(queda > 0 ? queda.toFixed(2) : "")])}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-full px-3 text-[15px] font-medium text-tinta hover:bg-interna"
        >
          <Plus className="size-4" />
          Pagó con otro medio más (pago mixto)
        </button>
      ) : null}

      <dl className="num grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-interna px-4 py-3">
          <dt className="text-[13px] text-tinta-2">Cobras ahora</dt>
          <dd className="text-[20px] font-semibold tracking-[-0.01em]">{formatearSoles(suma)}</dd>
        </div>
        <div className={cn("rounded-2xl px-4 py-3", !conPrecio ? "bg-interna" : queda > 0.009 ? "bg-aviso-fondo" : queda < -0.009 ? "bg-negativo-fondo" : "bg-positivo-fondo")}>
          <dt className="text-[13px] text-tinta-2">{conPrecio ? (queda < -0.009 ? "Te pasaste por" : "Quedará debiendo") : "Sin precio aún"}</dt>
          <dd className={cn("text-[20px] font-semibold tracking-[-0.01em]", conPrecio && (queda > 0.009 ? "text-aviso" : queda < -0.009 ? "text-negativo" : "text-positivo"))}>
            {conPrecio ? formatearSoles(Math.abs(queda)) : "Adelanto"}
          </dd>
        </div>
      </dl>

      {mensaje.error ? (
        <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
          {mensaje.error}
        </p>
      ) : null}
      {mensaje.ok ? (
        <p role="status" className="rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">
          {mensaje.ok}
        </p>
      ) : null}
      <Boton type="submit" disabled={enviando || suma <= 0} className="h-14 w-full text-[16px]">
        {enviando ? "Registrando…" : `Registrar cobro de ${formatearSoles(suma)}`}
      </Boton>
    </form>
  );
}
