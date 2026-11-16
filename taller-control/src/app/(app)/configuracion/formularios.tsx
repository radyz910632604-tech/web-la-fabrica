"use client";

import { useActionState, useTransition, type ReactNode } from "react";
import { Switch } from "radix-ui";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada } from "@/components/ui/campo";
import { Tarjeta } from "@/components/ui/tarjeta";
import {
  agregarServicioCatalogo,
  cambiarServicioCatalogo,
  crearTaller,
  guardarMeta,
  guardarPermisosAdmin,
  guardarReglas,
  guardarTaller,
  subirLogo,
  type Resultado,
} from "./acciones";

/** Una sección: título y explicación a la izquierda, el panel a la derecha (apilados en celular). */
export function Seccion({ titulo, descripcion, children }: { titulo: string; descripcion: string; children: ReactNode }) {
  const id = `seccion-${titulo.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:gap-10">
      <div className="lg:pt-6">
        <h2 id={id} className="text-[17px] font-semibold tracking-[-0.01em]">
          {titulo}
        </h2>
        <p className="mt-1 text-sm text-tinta-2">{descripcion}</p>
      </div>
      <Tarjeta>{children}</Tarjeta>
    </section>
  );
}

export function Pie({ estado, enviando, texto = "Guardar" }: { estado: Resultado; enviando: boolean; texto?: string }) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
      {estado.error ? (
        <p role="alert" className="mr-auto text-sm text-negativo">
          {estado.error}
        </p>
      ) : estado.ok ? (
        <p role="status" className="mr-auto text-sm text-positivo">
          {estado.ok}
        </p>
      ) : null}
      <Boton type="submit" disabled={enviando} className="w-full sm:w-auto">
        {enviando ? "Guardando…" : texto}
      </Boton>
    </div>
  );
}

type ValoresTaller = { nombre: string; razon_social: string | null; ruc: string | null; direccion: string | null; telefono: string | null; correo: string | null; lema: string | null };

export function FormTaller({ valores }: { valores: ValoresTaller }) {
  const [estado, accion, enviando] = useActionState(guardarTaller, {});
  const e = estado.errores ?? {};
  return (
    <form action={accion}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Nombre del taller" error={e.nombre}>
          {(p) => <Entrada {...p} name="nombre" defaultValue={valores.nombre} required />}
        </Campo>
        <Campo etiqueta="RUC" error={e.ruc}>
          {(p) => <Entrada {...p} name="ruc" inputMode="numeric" maxLength={11} defaultValue={valores.ruc ?? ""} className="num" />}
        </Campo>
        <Campo etiqueta="Razón social" error={e.razon_social} className="sm:col-span-2">
          {(p) => <Entrada {...p} name="razon_social" defaultValue={valores.razon_social ?? ""} />}
        </Campo>
        <Campo etiqueta="Dirección" error={e.direccion}>
          {(p) => <Entrada {...p} name="direccion" defaultValue={valores.direccion ?? ""} />}
        </Campo>
        <Campo etiqueta="Teléfono" error={e.telefono}>
          {(p) => <Entrada {...p} name="telefono" type="tel" defaultValue={valores.telefono ?? ""} />}
        </Campo>
        <Campo etiqueta="Correo" error={e.correo}>
          {(p) => <Entrada {...p} name="correo" type="email" defaultValue={valores.correo ?? ""} />}
        </Campo>
        <Campo etiqueta="Frase del taller" error={e.lema} ayuda="Sale bajo los datos del taller en los PDF.">
          {(p) => <Entrada {...p} name="lema" defaultValue={valores.lema ?? ""} placeholder="Siempre dispuestos a sus sugerencias…" />}
        </Campo>
      </div>
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

type ValoresReglas = {
  tolerancia_cita_minutos: number;
  dias_garantia_defecto: number;
  dias_cliente_inactivo: number;
  horas_orden_sin_cambio: number;
  minutos_aviso_entrega: number;
  margen_minimo_pct: number;
  igv_pct: number;
  hora_resumen_mediodia: string;
  hora_cierre: string;
  recibo_inicial: number;
};

function Numero({ nombre, etiqueta, unidad, valor, error, paso = 1 }: { nombre: string; etiqueta: string; unidad: string; valor: number; error?: string; paso?: number }) {
  return (
    <Campo etiqueta={etiqueta} error={error}>
      {(p) => (
        <div className="relative">
          <Entrada {...p} name={nombre} type="number" inputMode="decimal" step={paso} defaultValue={valor} className="num pr-24" required />
          <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-tinta-3">{unidad}</span>
        </div>
      )}
    </Campo>
  );
}

export function FormReglas({ valores }: { valores: ValoresReglas }) {
  const [estado, accion, enviando] = useActionState(guardarReglas, {});
  const e = estado.errores ?? {};
  return (
    <form action={accion}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Numero nombre="tolerancia_cita_minutos" etiqueta="Tolerancia de una cita" unidad="minutos" valor={valores.tolerancia_cita_minutos} error={e.tolerancia_cita_minutos} />
        <Numero nombre="dias_garantia_defecto" etiqueta="Plazo de garantía" unidad="días" valor={valores.dias_garantia_defecto} error={e.dias_garantia_defecto} />
        <Numero nombre="horas_orden_sin_cambio" etiqueta="Avisar si una orden no avanza en" unidad="horas" valor={valores.horas_orden_sin_cambio} error={e.horas_orden_sin_cambio} />
        <Numero nombre="dias_cliente_inactivo" etiqueta="Cliente inactivo después de" unidad="días" valor={valores.dias_cliente_inactivo} error={e.dias_cliente_inactivo} />
        <Numero nombre="minutos_aviso_entrega" etiqueta="Avisar antes de la hora prometida" unidad="minutos" valor={valores.minutos_aviso_entrega} error={e.minutos_aviso_entrega} paso={15} />
        <Numero nombre="recibo_inicial" etiqueta="Seguir los recibos desde el número" unidad="N°" valor={valores.recibo_inicial} error={e.recibo_inicial} />
        <Numero nombre="margen_minimo_pct" etiqueta="Margen mínimo por orden" unidad="%" valor={valores.margen_minimo_pct} error={e.margen_minimo_pct} paso={0.5} />
        <Numero nombre="igv_pct" etiqueta="IGV" unidad="%" valor={valores.igv_pct} error={e.igv_pct} paso={0.01} />
        <Campo etiqueta="Resumen del mediodía" error={e.hora_resumen_mediodia}>
          {(p) => <Entrada {...p} name="hora_resumen_mediodia" type="time" defaultValue={valores.hora_resumen_mediodia} className="num" required />}
        </Campo>
        <Campo etiqueta="Hora de cierre" error={e.hora_cierre}>
          {(p) => <Entrada {...p} name="hora_cierre" type="time" defaultValue={valores.hora_cierre} className="num" required />}
        </Campo>
      </div>
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

export function FormMeta({ valor }: { valor: number | null }) {
  const [estado, accion, enviando] = useActionState(guardarMeta, {});
  return (
    <form action={accion}>
      <Campo etiqueta="Meta del mes, sin IGV" error={estado.errores?.meta} ayuda={valor === null ? "Todavía no hay meta para este mes." : undefined}>
        {(p) => (
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-[15px] text-tinta-3">S/</span>
            <Entrada {...p} name="meta" type="number" inputMode="decimal" min={0} step={100} defaultValue={valor ?? ""} className="num pl-11" required />
          </div>
        )}
      </Campo>
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

function Interruptor({ nombre, titulo, descripcion, valor }: { nombre: string; titulo: string; descripcion: string; valor: boolean }) {
  const id = `interruptor-${nombre}`;
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[15px] font-medium">{titulo}</span>
        <span className="block text-sm text-tinta-2">{descripcion}</span>
      </label>
      <Switch.Root
        id={id}
        name={nombre}
        defaultChecked={valor}
        className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-control transition-colors duration-150 data-[state=checked]:bg-primario"
      >
        <Switch.Thumb className="block size-6 translate-x-0.5 rounded-full bg-white transition-transform duration-200 ease-[var(--ease-salida)] data-[state=checked]:translate-x-[22px] dark:data-[state=checked]:bg-[#121212]" />
      </Switch.Root>
    </div>
  );
}

export function FormPermisosAdmin({ utilidad, sueldos }: { utilidad: boolean; sueldos: boolean }) {
  const [estado, accion, enviando] = useActionState(guardarPermisosAdmin, {});
  return (
    <form action={accion}>
      <div className="divide-y divide-regla">
        <Interruptor nombre="admin_ve_utilidad" titulo="Ver la utilidad" descripcion="Utilidad del mes y el gráfico de ventas contra costos." valor={utilidad} />
        <Interruptor nombre="admin_ve_sueldos" titulo="Ver los sueldos" descripcion="Costo mensual del personal y comisiones (Fase 3)." valor={sueldos} />
      </div>
      <Pie estado={estado} enviando={enviando} />
    </form>
  );
}

export function FormNuevoTaller() {
  const [estado, accion, enviando] = useActionState(crearTaller, {});
  return (
    <form action={accion}>
      <Campo etiqueta="Nombre del nuevo taller" error={estado.errores?.nombre}>
        {(p) => <Entrada {...p} name="nombre" placeholder="Por ejemplo: Taller Chorrillos" required />}
      </Campo>
      <Pie estado={estado} enviando={enviando} texto="Crear taller" />
    </form>
  );
}

const NOMBRE_CATEGORIA: Record<string, string> = {
  transmision: "Transmisión",
  gnv_glp: "GNV y GLP",
  aire_acondicionado: "Aire acondicionado",
  frenos: "Frenos",
  aceite: "Aceite",
  otro: "Otros",
};

export function FormServicios({ servicios }: { servicios: { id: string; nombre: string; categoria: string; activo: boolean }[] }) {
  const [estado, accion, enviando] = useActionState(agregarServicioCatalogo, {});
  const [pendiente, iniciar] = useTransition();
  const e = estado.errores ?? {};
  return (
    <div>
      <ul className="flex flex-wrap gap-2">
        {servicios.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              disabled={pendiente}
              onClick={() => iniciar(async () => void (await cambiarServicioCatalogo(s.id, !s.activo)))}
              aria-pressed={s.activo}
              title={s.activo ? "Toca para ocultarlo al registrar ingresos" : "Toca para volver a mostrarlo"}
              className={
                s.activo
                  ? "presionable min-h-11 cursor-pointer rounded-full border border-borde bg-tarjeta px-4 text-[14px] hover:bg-interna"
                  : "presionable min-h-11 cursor-pointer rounded-full border border-dashed border-control px-4 text-[14px] text-tinta-3 line-through"
              }
            >
              {s.nombre}
              <span className="sr-only"> ({NOMBRE_CATEGORIA[s.categoria]}{s.activo ? "" : ", oculto"})</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-tinta-2">Toca un servicio para ocultarlo o volver a mostrarlo. Los ocultos no aparecen al registrar ingresos.</p>
      <form action={accion} className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Campo etiqueta="Nuevo servicio" error={e.nombre}>
          {(p) => <Entrada {...p} name="nombre" placeholder="Por ejemplo: Cambio de bujías" required />}
        </Campo>
        <Campo etiqueta="Tipo">
          {(p) => (
            <select
              {...p}
              name="categoria"
              defaultValue="otro"
              className="h-12 w-full rounded-2xl border border-borde bg-tarjeta px-4 text-[15px] text-tinta outline-none focus-visible:border-tinta"
            >
              {Object.entries(NOMBRE_CATEGORIA).map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Garantía (días)" error={e.dias_garantia} ayuda="Vacío = la general">
          {(p) => <Entrada {...p} name="dias_garantia" type="number" inputMode="numeric" min={0} className="num" />}
        </Campo>
        <div className="sm:col-span-3">
          <Pie estado={estado} enviando={enviando} texto="Agregar servicio" />
        </div>
      </form>
    </div>
  );
}

/** Logo del taller: vista previa y subir uno nuevo. */
export function FormLogo({ url }: { url: string | null }) {
  const [estado, accion, enviando] = useActionState(subirLogo, {});
  return (
    <form action={accion}>
      <div className="flex flex-wrap items-center gap-5">
        <div className="grid size-28 shrink-0 place-items-center overflow-hidden rounded-2xl border border-borde bg-white">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Logo del taller" className="max-h-full max-w-full object-contain p-2" />
          ) : (
            <span className="px-3 text-center text-[13px] text-tinta-3">Sin logo</span>
          )}
        </div>
        <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm font-medium">
          Imagen del logo (PNG o JPG, hasta 1 MB)
          <input name="logo" type="file" accept="image/png,image/jpeg" required className="text-sm font-normal text-tinta-2 file:mr-3 file:h-10 file:cursor-pointer file:rounded-full file:border-0 file:bg-interna file:px-4 file:text-sm file:font-medium file:text-tinta" />
        </label>
      </div>
      <Pie estado={estado} enviando={enviando} texto="Subir logo" />
    </form>
  );
}
