"use client";

import { useState, useTransition } from "react";
import { Calculator, Check, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { MEDIOS } from "@/lib/dinero";
import { cn } from "@/lib/utils";
import { aprobarTodas, calcularDelMes, cambiarEstadoComision, crearComision, eliminarComision, modificarComision, type Resultado } from "./acciones";

function Mensaje({ r }: { r: Resultado }) {
  if (!r.error && !r.ok) return null;
  return (
    <p role={r.error ? "alert" : "status"} className={cn("rounded-2xl px-4 py-3 text-sm", r.error ? "bg-negativo-fondo text-negativo" : "bg-positivo-fondo text-positivo")}>
      {r.error ?? r.ok}
    </p>
  );
}

function Aviso({ r }: { r: Resultado }) {
  if (!r.error && !r.ok) return null;
  return (
    <p
      role={r.error ? "alert" : "status"}
      className={cn(
        "fixed bottom-24 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl px-4 py-3 text-sm shadow-flotante md:bottom-8",
        r.error ? "bg-negativo-fondo text-negativo" : "bg-positivo-fondo text-positivo",
      )}
    >
      {r.error ?? r.ok}
    </p>
  );
}

export function BotonCalcular({ mes }: { mes: string }) {
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <>
      <Boton
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            setR(await calcularDelMes(mes));
            setTimeout(() => setR({}), 5000);
          })
        }
      >
        <Calculator />
        {pendiente ? "Calculando…" : "Calcular del mes"}
      </Boton>
      <Aviso r={r} />
    </>
  );
}

export function BotonAprobarTodas({ mes, cuantas }: { mes: string; cuantas: number }) {
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  if (cuantas < 2) return null;
  return (
    <>
      <Boton
        variante="secundario"
        tamano="chico"
        disabled={pendiente}
        onClick={() =>
          iniciar(async () => {
            setR(await aprobarTodas(mes));
            setTimeout(() => setR({}), 4500);
          })
        }
      >
        <Check />
        {pendiente ? "Aprobando…" : `Aprobar las ${cuantas} pendientes`}
      </Boton>
      <Aviso r={r} />
    </>
  );
}

export function NuevaComision({ asesores, mes }: { asesores: { id: string; nombre: string }[]; mes: string }) {
  const [abierta, setAbierta] = useState(false);
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <Ventana open={abierta} onOpenChange={(v) => (setAbierta(v), setR({}))}>
      <DisparadorVentana asChild>
        <Boton variante="secundario">
          <Plus />
          Agregar comisión
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Agregar comisión" descripcion="Un bono o una comisión puesta a mano para un asesor. Queda pendiente de aprobar.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            iniciar(async () => {
              const res = await crearComision({ asesorId: f.get("asesor"), concepto: f.get("concepto"), monto: f.get("monto"), mes });
              setR(res);
              if (res.ok) setAbierta(false);
            });
          }}
        >
          <Campo etiqueta="Asesor">
            {(p) => (
              <Selector {...p} name="asesor" defaultValue="" required>
                <option value="" disabled>
                  Elige al asesor
                </option>
                {asesores.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Concepto" ayuda="Por ejemplo: «Bono por meta de noviembre».">
            {(p) => <Entrada {...p} name="concepto" maxLength={160} required autoComplete="off" />}
          </Campo>
          <Campo etiqueta="Monto (S/)">
            {(p) => <Entrada {...p} name="monto" type="number" min="0.01" step="0.01" inputMode="decimal" className="num" required />}
          </Campo>
          <Mensaje r={r} />
          <Boton type="submit" disabled={pendiente} className="w-full">
            {pendiente ? "Guardando…" : "Agregar"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

type Datos = { id: string; estado: string; concepto: string; monto: number; asesor: string };

/** Botones de cada comisión según su estado: modificar, aprobar, pagar y eliminar. */
export function AccionesComision({ comision: c }: { comision: Datos }) {
  const [ventana, setVentana] = useState<"modificar" | "pagar" | "eliminar" | null>(null);
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const avisar = (res: Resultado) => {
    setR(res);
    setTimeout(() => setR({}), 4500);
  };
  return (
    <div className="flex shrink-0 flex-wrap gap-1.5">
      {c.estado === "pendiente" ? (
        <>
          <Boton variante="fantasma" tamano="chico" onClick={() => setVentana("modificar")} aria-label={`Modificar comisión de ${c.asesor}`}>
            <Pencil />
            Modificar
          </Boton>
          <Boton variante="secundario" tamano="chico" disabled={pendiente} onClick={() => iniciar(async () => avisar(await cambiarEstadoComision(c.id, "aprobada")))}>
            <Check />
            Aprobar
          </Boton>
        </>
      ) : null}
      {c.estado === "aprobada" ? (
        <Boton tamano="chico" onClick={() => setVentana("pagar")}>
          <Wallet />
          Pagar
        </Boton>
      ) : null}
      <Boton variante="fantasma" tamano="chico" className="text-negativo [&_svg]:text-negativo" onClick={() => setVentana("eliminar")} aria-label={`${c.estado === "pendiente" ? "Eliminar" : "Anular"} comisión de ${c.asesor}`}>
        <Trash2 />
        {c.estado === "pendiente" ? "Eliminar" : "Anular"}
      </Boton>

      {ventana === null ? <Aviso r={r} /> : null}

      <Ventana open={ventana === "modificar"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana titulo={`Modificar comisión de ${c.asesor}`} descripcion="Solo mientras está pendiente. Una vez aprobada, ya no cambia.">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              iniciar(async () => {
                const res = await modificarComision(c.id, { concepto: f.get("concepto"), monto: f.get("monto") });
                if (res.ok) {
                  setVentana(null);
                  avisar(res);
                } else setR(res);
              });
            }}
          >
            <Campo etiqueta="Concepto">{(p) => <Entrada {...p} name="concepto" defaultValue={c.concepto} maxLength={160} required />}</Campo>
            <Campo etiqueta="Monto (S/)">{(p) => <Entrada {...p} name="monto" type="number" min="0.01" step="0.01" defaultValue={c.monto} className="num" required />}</Campo>
            <Mensaje r={r} />
            <Boton type="submit" disabled={pendiente} className="w-full">
              {pendiente ? "Guardando…" : "Guardar"}
            </Boton>
          </form>
        </ContenidoVentana>
      </Ventana>

      <Ventana open={ventana === "pagar"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana titulo={`Pagar S/ ${c.monto.toFixed(2)} a ${c.asesor}`} descripcion="Al pagarla se registra un solo gasto en Gastos del taller. Si luego la anulas, su gasto también se anula.">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const medio = String(new FormData(e.currentTarget).get("medio") ?? "");
              iniciar(async () => {
                const res = await cambiarEstadoComision(c.id, "pagada", medio);
                if (res.ok) {
                  setVentana(null);
                  avisar(res);
                } else setR(res);
              });
            }}
          >
            <Campo etiqueta="¿Cómo se pagó?">
              {(p) => (
                <Selector {...p} name="medio" defaultValue="efectivo">
                  {Object.entries(MEDIOS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            <Mensaje r={r} />
            <Boton type="submit" disabled={pendiente} className="w-full">
              {pendiente ? "Pagando…" : "Marcar pagada"}
            </Boton>
          </form>
        </ContenidoVentana>
      </Ventana>

      <Ventana open={ventana === "eliminar"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana
          titulo={c.estado === "pendiente" ? "Eliminar comisión" : "Anular comisión"}
          descripcion={
            c.estado === "pendiente"
              ? `Se borra la comisión de ${c.asesor} por S/ ${c.monto.toFixed(2)}. Aún no se aprobó ni pagó.`
              : c.estado === "pagada"
                ? "Ya se pagó: queda anulada con su motivo, y su gasto también se anula."
                : "Queda anulada con su motivo, a la vista."
          }
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const motivo = String(new FormData(e.currentTarget).get("motivo") ?? "");
              iniciar(async () => {
                const res = await eliminarComision(c.id, c.estado, motivo);
                if (res.ok) {
                  setVentana(null);
                  avisar(res);
                } else setR(res);
              });
            }}
          >
            {c.estado === "pendiente" ? null : <Campo etiqueta="Motivo">{(p) => <Entrada {...p} name="motivo" minLength={5} required autoComplete="off" />}</Campo>}
            <Mensaje r={r} />
            <Boton type="submit" variante="peligro" disabled={pendiente} className="w-full">
              {pendiente ? "Guardando…" : c.estado === "pendiente" ? "Eliminar" : "Anular"}
            </Boton>
          </form>
        </ContenidoVentana>
      </Ventana>
    </div>
  );
}
