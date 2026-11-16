"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatearSoles } from "@/lib/formato";

type Mes = { etiqueta: string; ventas: number; costos: number; utilidad: number; enCurso: boolean };

/**
 * Ventas vs. costos por mes: cada barra es la venta del mes (sin IGV),
 * partida en costos (negro) y utilidad (naranja con trama).
 * El mes en curso va más tenue porque todavía no termina.
 */
export function GraficoVentas({ meses }: { meses: Mes[] }) {
  // Sin ventas todavía, el eje va de 0 a 4k en vez de mostrar decimales cortados.
  const sinDatos = meses.every((m) => !m.ventas && !m.costos);
  return (
    <div className="h-[216px] w-full" role="img" aria-label={descripcion(meses)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={meses} margin={{ top: 12, right: 0, bottom: 0, left: -8 }} barCategoryGap="26%">
          <defs>
            <pattern id="trama-utilidad" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--acento-suave)" />
              <rect width="3.5" height="7" fill="var(--acento)" />
            </pattern>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--rejilla)" />
          <XAxis
            dataKey="etiqueta"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--tinta-3)", fontSize: 12 }}
            dy={6}
            interval={0}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--tinta-3)", fontSize: 12 }}
            tickFormatter={(v: number) => (Math.abs(v) < 1000 ? String(Math.round(v)) : `${Math.round(v / 1000)}k`)}
            domain={sinDatos ? [0, 4000] : undefined}
            tickCount={5}
            width={44}
            allowDecimals={false}
          />
          <Tooltip cursor={{ fill: "var(--interna)", radius: 8 }} content={<Globo />} />
          <Bar dataKey="costos" stackId="mes" fill="var(--serie-1)" radius={6} stroke="var(--tarjeta)" strokeWidth={2} isAnimationActive={false}>
            {meses.map((m) => (
              <Cell key={m.etiqueta} fillOpacity={m.enCurso ? 0.45 : 1} />
            ))}
          </Bar>
          <Bar dataKey="utilidad" stackId="mes" fill="url(#trama-utilidad)" radius={6} stroke="var(--tarjeta)" strokeWidth={2} isAnimationActive={false}>
            {meses.map((m) => (
              <Cell key={m.etiqueta} fillOpacity={m.enCurso ? 0.45 : 1} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function descripcion(meses: Mes[]) {
  const ultimo = meses.filter((m) => !m.enCurso).at(-1);
  if (!ultimo) return "Ventas contra costos por mes";
  return `Ventas contra costos por mes. ${ultimo.etiqueta}: ventas ${formatearSoles(ultimo.ventas, { sinDecimales: true })}, costos ${formatearSoles(ultimo.costos, { sinDecimales: true })}, utilidad ${formatearSoles(ultimo.utilidad, { sinDecimales: true })}.`;
}

type CargaGlobo = { payload?: Mes };

function Globo({ active, payload }: { active?: boolean; payload?: CargaGlobo[] }) {
  const mes = payload?.[0]?.payload;
  if (!active || !mes) return null;
  const filas = [
    ["Ventas", mes.ventas],
    ["Costos", mes.costos],
    ["Utilidad", mes.utilidad],
  ] as const;
  return (
    <div className="rounded-xl bg-tarjeta px-3 py-2.5 text-[13px] shadow-flotante ring-1 ring-borde">
      <p className="mb-1 font-medium">
        {mes.etiqueta}
        {mes.enCurso ? " (en curso)" : ""}
      </p>
      {filas.map(([nombre, valor]) => (
        <p key={nombre} className="flex justify-between gap-6 text-tinta-2">
          <span>{nombre}</span>
          <span className="num text-tinta">{formatearSoles(valor, { sinDecimales: true })}</span>
        </p>
      ))}
    </div>
  );
}

/** Leyenda: cada muestra es la misma marca de la barra, en chico. */
export function LeyendaVentas() {
  return (
    <ul className="flex items-center gap-4 text-[13px] text-tinta-2">
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="size-3 rounded-[3px] bg-[var(--serie-1)]" />
        Costos
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="trama-acento size-3 rounded-[3px]" />
        Utilidad
      </li>
    </ul>
  );
}
