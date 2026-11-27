"use client";

import { useActionState, useState, useTransition } from "react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { formatearSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Pie } from "./formularios";
import { cambiarReglaComision, crearReglaComision, guardarCostos, guardarManoObraServicios, guardarReglaManoObra } from "./dinero-acciones";

const EVENTO: Record<string, string> = { cita_llego_y_pago: "Cita que llegó y pagó (para quien la agendó)", trabajo_entregado: "Orden entregada y cobrada (para el asesor)" };

function Soles({ nombre, valor, etiqueta }: { nombre: string; valor: number | null; etiqueta: string }) {
  return (
    <div className="relative w-36 shrink-0">
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] text-tinta-3">S/</span>
      <Entrada aria-label={etiqueta} name={nombre} type="number" inputMode="decimal" min={0} step="0.01" defaultValue={valor ?? ""} className="num h-11 pl-11" />
    </div>
  );
}

export function FormManoObra({ regla }: { regla: string }) {
  const [estado, accion, enviando] = useActionState(guardarReglaManoObra, {});
  const [valor, setValor] = useState(regla);
  return (
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="regla" value={valor} />
      {[
        ["prorrateo_mensual", "Prorrateo mensual", "El costo mensual del técnico se reparte entre las órdenes que entregó ese mes."],
        ["fijo_por_servicio", "Fijo por servicio", "Cada servicio tiene un monto de mano de obra (abajo)."],
      ].map(([v, t, d]) => (
        <button
          key={v}
          type="button"
          aria-pressed={valor === v}
          onClick={() => setValor(v)}
          className={cn("presionable cursor-pointer rounded-2xl border px-4 py-3 text-left", valor === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
        >
          <span className="block text-[15px] font-medium">{t}</span>
          <span className="block text-sm text-tinta-2">{d}</span>
        </button>
      ))}
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

export function FormCostos({ personas }: { personas: { id: string; nombre: string; roles: string; costo: number | null }[] }) {
  const [estado, accion, enviando] = useActionState(guardarCostos, {});
  return (
    <form action={accion}>
      <ul className="flex flex-col">
        {personas.map((p) => (
          <li key={p.id} className="flex items-center gap-3 border-t border-regla py-2.5 first:border-t-0 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium">{p.nombre}</p>
              <p className="truncate text-[13px] text-tinta-3">{p.roles}</p>
            </div>
            <input type="hidden" name={`antes_${p.id}`} value={p.costo ?? ""} />
            <Soles nombre={`costo_${p.id}`} valor={p.costo} etiqueta={`Costo mensual de ${p.nombre}`} />
          </li>
        ))}
      </ul>
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

export function FormManoObraServicios({ servicios }: { servicios: { id: string; nombre: string; monto: number | null }[] }) {
  const [estado, accion, enviando] = useActionState(guardarManoObraServicios, {});
  return (
    <form action={accion}>
      <ul className="flex flex-col">
        {servicios.map((s) => (
          <li key={s.id} className="flex items-center gap-3 border-t border-regla py-2.5 first:border-t-0 first:pt-0">
            <p className="min-w-0 flex-1 text-[15px]">{s.nombre}</p>
            <Soles nombre={`mo_${s.id}`} valor={s.monto} etiqueta={`Mano de obra de ${s.nombre}`} />
          </li>
        ))}
      </ul>
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

export function FormComisiones({ reglas }: { reglas: { id: string; nombre: string; evento: string; tipo: string; valor: number; activa: boolean }[] }) {
  const [estado, accion, enviando] = useActionState(crearReglaComision, {});
  const [pendiente, iniciar] = useTransition();
  const e = estado.errores ?? {};
  return (
    <div className="flex flex-col gap-5">
      {reglas.length ? (
        <ul className="flex flex-col">
          {reglas.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 border-t border-regla py-2.5 first:border-t-0 first:pt-0">
              <div className={cn("min-w-0 flex-1", !r.activa && "opacity-60")}>
                <p className="text-[15px] font-medium">{r.nombre}</p>
                <p className="text-[13px] text-tinta-3">
                  {EVENTO[r.evento]} · {r.tipo === "fijo" ? formatearSoles(r.valor) : `${r.valor} % de la venta sin IGV`}
                </p>
              </div>
              <Boton variante="secundario" tamano="chico" disabled={pendiente} onClick={() => iniciar(async () => void (await cambiarReglaComision(r.id, !r.activa)))}>
                {r.activa ? "Pausar" : "Activar"}
              </Boton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-tinta-2">Todavía no hay reglas de comisión.</p>
      )}
      <form action={accion} className="flex flex-col gap-3 rounded-2xl bg-interna p-4">
        <p className="text-[15px] font-medium">Nueva regla</p>
        <Campo etiqueta="Nombre" error={e.nombre}>
          {(p) => <Entrada {...p} name="nombre" placeholder="Ejemplo: S/ 20 por cita que llegó y pagó" />}
        </Campo>
        <Campo etiqueta="Cuándo se gana">
          {(p) => (
            <Selector {...p} name="evento" defaultValue="cita_llego_y_pago">
              {Object.entries(EVENTO).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </Selector>
          )}
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Tipo">
            {(p) => (
              <Selector {...p} name="tipo_monto" defaultValue="fijo">
                <option value="fijo">Monto fijo (S/)</option>
                <option value="porcentaje">Porcentaje (%)</option>
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Valor" error={e.valor}>
            {(p) => <Entrada {...p} name="valor" type="number" inputMode="decimal" min={0} step="0.01" className="num" required />}
          </Campo>
        </div>
        <Pie estado={estado} enviando={enviando} texto="Crear regla" />
      </form>
    </div>
  );
}
