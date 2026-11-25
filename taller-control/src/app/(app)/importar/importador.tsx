"use client";

import { useMemo, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, FileSpreadsheet, Upload } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Selector } from "@/components/ui/campo";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { CAMPOS, detectarColumnas, faltanObligatorios, filaDeTitulos, TIPOS_IMPORTACION, validarFila, type Mapa, type TipoImportacion } from "@/lib/importar/reglas";
import { cn } from "@/lib/utils";
import { importarLote, leerArchivo, type Hoja, type ResultadoLote } from "./acciones";

const LOTE = 200;
const letra = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`);

export function Importador() {
  const [tipo, setTipo] = useState<TipoImportacion>("clientes");
  const [hojas, setHojas] = useState<Hoja[] | null>(null);
  const [nombreArchivo, setNombreArchivo] = useState("");
  const [hoja, setHoja] = useState(0);
  const [titulos, setTitulos] = useState(0);
  const [mapa, setMapa] = useState<Mapa>({});
  const [conIgv, setConIgv] = useState(true);
  const [error, setError] = useState("");
  const [leyendo, iniciarLectura] = useTransition();
  const [avance, setAvance] = useState<{ hechos: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<ResultadoLote | null>(null);

  const filas = useMemo(() => hojas?.[hoja]?.filas ?? [], [hojas, hoja]);
  const encabezados = filas[titulos] ?? [];
  const datos = useMemo(() => filas.slice(titulos + 1).map((celdas, i) => ({ numero: titulos + i + 2, celdas })), [filas, titulos]);
  const revisadas = useMemo(() => datos.map((f) => validarFila(tipo, f.celdas, mapa, f.numero, { costosConIgv: conIgv })).filter((v) => !v.errores.includes("Fila vacía")), [datos, tipo, mapa, conIgv]);
  const listas = revisadas.filter((v) => v.ok).length;
  const conAviso = revisadas.filter((v) => v.ok && v.avisos.length).length;
  const conError = revisadas.filter((v) => !v.ok);
  const faltan = faltanObligatorios(tipo, mapa);
  const columnas = Math.max(0, ...filas.slice(0, 30).map((f) => f.length));

  const prepararHoja = (h: Hoja[], i: number, t: TipoImportacion) => {
    const f = filaDeTitulos(h[i].filas, t);
    setHoja(i);
    setTitulos(f);
    setMapa(detectarColumnas(h[i].filas[f] ?? [], t));
    setResultado(null);
  };

  const elegirTipo = (t: TipoImportacion) => {
    setTipo(t);
    setResultado(null);
    if (hojas) prepararHoja(hojas, hoja, t);
  };

  const leer = (archivo: File) =>
    iniciarLectura(async () => {
      setError("");
      setResultado(null);
      const form = new FormData();
      form.append("archivo", archivo);
      const r = await leerArchivo(form);
      if (r.error || !r.hojas) {
        setError(r.error ?? "No se pudo leer el archivo.");
        setHojas(null);
        return;
      }
      setNombreArchivo(archivo.name);
      setHojas(r.hojas);
      prepararHoja(r.hojas, 0, tipo);
    });

  const importar = async () => {
    const total = datos.length;
    const suma: ResultadoLote = { creados: 0, actualizados: 0, sinCambios: 0, errores: [], avisos: [] };
    setAvance({ hechos: 0, total });
    for (let i = 0; i < total; i += LOTE) {
      const r = await importarLote(tipo, datos.slice(i, i + LOTE), mapa, { costosConIgv: conIgv });
      if (r.error) {
        suma.error = r.error;
        break;
      }
      suma.creados += r.creados;
      suma.actualizados += r.actualizados;
      suma.sinCambios += r.sinCambios;
      suma.errores.push(...r.errores);
      suma.avisos.push(...r.avisos);
      setAvance({ hechos: Math.min(total, i + LOTE), total });
    }
    setAvance(null);
    setResultado(suma);
  };

  const importando = avance !== null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* 1. Qué se importa */}
      <Tarjeta aria-labelledby="t-que">
        <CabeceraTarjeta id="t-que" titulo="1. ¿Qué vas a importar?" detalle="Importa un tipo a la vez. Si tu Excel tiene varias hojas, elige la que corresponde." />
        <div role="radiogroup" aria-label="Tipo de datos" className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(TIPOS_IMPORTACION) as TipoImportacion[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              disabled={importando}
              onClick={() => elegirTipo(t)}
              className={cn(
                "presionable rounded-2xl border px-4 py-3 text-left transition-colors",
                tipo === t ? "border-tinta bg-tarjeta ring-4 ring-acento/15" : "border-borde bg-interna hover:bg-tarjeta",
              )}
            >
              <span className="block text-[15px] font-medium text-tinta">{TIPOS_IMPORTACION[t].nombre}</span>
              <span className="mt-0.5 block text-[13px] text-tinta-2">{TIPOS_IMPORTACION[t].detalle}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-tinta-3">Historial de servicios, ventas y compras antiguas llegan en el siguiente paso.</p>
      </Tarjeta>

      {/* 2. Archivo */}
      <Tarjeta aria-labelledby="t-archivo">
        <CabeceraTarjeta id="t-archivo" titulo="2. Tu archivo" detalle="Excel (.xlsx) o CSV, de hasta 5 MB. No se guarda en ninguna parte: solo se leen los datos." />
        <label className={cn("presionable flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-control bg-interna px-4 py-7 text-center hover:bg-tarjeta", (leyendo || importando) && "pointer-events-none opacity-60")}>
          <input
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) leer(f);
              e.target.value = "";
            }}
          />
          {nombreArchivo && !leyendo ? <FileSpreadsheet className="size-6 text-tinta-2" aria-hidden /> : <Upload className="size-6 text-tinta-2" aria-hidden />}
          <span className="text-[15px] font-medium">{leyendo ? "Leyendo…" : nombreArchivo ? nombreArchivo : "Elegir archivo"}</span>
          <span className="text-[13px] text-tinta-3">{nombreArchivo ? "Toca para elegir otro" : "Desde tu computadora o tu celular"}</span>
        </label>
        {error ? <p role="alert" className="mt-3 text-sm text-negativo">{error}</p> : null}
      </Tarjeta>

      {/* 3. Columnas */}
      {hojas ? (
        <Tarjeta aria-labelledby="t-columnas">
          <CabeceraTarjeta id="t-columnas" titulo="3. ¿Qué columna es cada dato?" detalle="Lo reconocí por los títulos. Revisa y cambia lo que no esté bien." />
          <div className="grid gap-3 sm:grid-cols-2">
            {hojas.length > 1 ? (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Hoja
                <Selector value={hoja} disabled={importando} onChange={(e) => prepararHoja(hojas, Number(e.target.value), tipo)}>
                  {hojas.map((h, i) => (
                    <option key={i} value={i}>
                      {h.nombre} ({h.filas.length} filas)
                    </option>
                  ))}
                </Selector>
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Fila de los títulos
              <Selector
                value={titulos}
                disabled={importando}
                onChange={(e) => {
                  const f = Number(e.target.value);
                  setTitulos(f);
                  setMapa(detectarColumnas(filas[f] ?? [], tipo));
                }}
              >
                {filas.slice(0, 15).map((f, i) => (
                  <option key={i} value={i}>
                    Fila {i + 1}: {f.filter(Boolean).slice(0, 4).join(" · ").slice(0, 60) || "(vacía)"}
                  </option>
                ))}
              </Selector>
            </label>
          </div>
          <ul className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {CAMPOS[tipo].map((c) => (
              <li key={c.clave}>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span>
                    {c.nombre}
                    {c.obligatorio ? <span className="text-negativo"> *</span> : null}
                  </span>
                  <Selector
                    value={mapa[c.clave] ?? ""}
                    disabled={importando}
                    onChange={(e) => setMapa({ ...mapa, [c.clave]: e.target.value === "" ? null : Number(e.target.value) })}
                    className={cn(mapa[c.clave] == null && "text-tinta-3")}
                  >
                    <option value="">— No está en el Excel —</option>
                    {Array.from({ length: columnas }, (_, i) => (
                      <option key={i} value={i}>
                        {letra(i)} · {encabezados[i] || "(sin título)"}
                      </option>
                    ))}
                  </Selector>
                </label>
              </li>
            ))}
          </ul>
          {tipo === "inventario" ? (
            <label className="mt-4 flex items-center gap-3 text-[15px]">
              <input type="checkbox" checked={conIgv} onChange={(e) => setConIgv(e.target.checked)} className="size-5 accent-[var(--primario)]" />
              Los costos y precios del Excel incluyen IGV
            </label>
          ) : null}
          {faltan.length ? <p role="alert" className="mt-4 text-sm text-negativo">Falta elegir: {faltan.join(", ")}.</p> : null}
        </Tarjeta>
      ) : null}

      {/* 4. Vista previa e importación */}
      {hojas && !faltan.length ? (
        <Tarjeta aria-labelledby="t-previa">
          <CabeceraTarjeta
            id="t-previa"
            titulo="4. Revisa e importa"
            detalle={`${revisadas.length} filas con datos: ${listas} se importan${conAviso ? ` (${conAviso} con aviso)` : ""}${conError.length ? ` y ${conError.length} ${conError.length === 1 ? "tiene errores y se salta" : "tienen errores y se saltan"}` : ""}.`}
          />
          <div className="-mx-5 overflow-x-auto px-5 md:-mx-6 md:px-6">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="text-[13px] text-tinta-3">
                  <th className="py-2 pr-3 font-medium">Fila</th>
                  {CAMPOS[tipo].filter((c) => mapa[c.clave] != null).map((c) => (
                    <th key={c.clave} className="py-2 pr-3 font-medium">{c.nombre}</th>
                  ))}
                  <th className="min-w-56 py-2 font-medium">Revisión</th>
                </tr>
              </thead>
              <tbody>
                {revisadas.slice(0, 8).map((v) => (
                  <tr key={v.fila} className="border-t border-regla align-top">
                    <td className="num py-2 pr-3 text-tinta-3">{v.fila}</td>
                    {CAMPOS[tipo].filter((c) => mapa[c.clave] != null).map((c) => (
                      <td key={c.clave} className="max-w-48 truncate py-2 pr-3">{mostrar(v.datos[c.clave === "costo" ? "costo_sin_igv" : c.clave === "precio" ? "precio_sin_igv" : c.clave === "kilometraje" ? "kilometraje" : c.clave])}</td>
                    ))}
                    <td className={cn("min-w-56 py-2 text-[13px]", v.ok ? (v.avisos.length ? "text-aviso" : "text-positivo") : "text-negativo")}>{v.ok ? v.avisos[0] ?? "Lista" : v.errores.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {tipo === "inventario" ? <p className="mt-2 text-[13px] text-tinta-3">Costo y precio se muestran sin IGV, como los guarda el sistema.</p> : null}
          {conError.length ? (
            <details className="mt-4 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
              <summary className="cursor-pointer font-medium">{conError.length === 1 ? "1 fila con errores (se salta)" : `${conError.length} filas con errores (se saltan)`}</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {conError.slice(0, 50).map((v) => (
                  <li key={v.fila}>Fila {v.fila}: {v.errores.join("; ")}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-tinta-2">Si importas el mismo archivo dos veces, no se duplica: lo que ya existe se reconoce y solo se completa lo que faltaba.</p>
            <Boton type="button" disabled={!listas || importando} onClick={importar} className="w-full sm:w-auto">
              {importando ? `Importando ${avance.hechos} de ${avance.total}…` : `Importar ${listas} ${listas === 1 ? "fila" : "filas"}`}
            </Boton>
          </div>
          {importando ? (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-hundida" role="progressbar" aria-valuemin={0} aria-valuemax={avance.total} aria-valuenow={avance.hechos}>
              <div className="h-full rounded-full bg-acento transition-[width] duration-300" style={{ width: `${(avance.hechos / Math.max(1, avance.total)) * 100}%` }} />
            </div>
          ) : null}
        </Tarjeta>
      ) : null}

      {resultado ? <Resultado r={resultado} tipo={tipo} /> : null}
    </div>
  );
}

function mostrar(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "object" && v && "numero" in v) return String((v as { numero: string }).numero);
  if (typeof v === "string" && /^\+51\d{9}$/.test(v)) return v.slice(3).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  if (typeof v === "number") return v.toLocaleString("es-PE", { maximumFractionDigits: 2 });
  return String(v);
}

function Resultado({ r, tipo }: { r: ResultadoLote; tipo: TipoImportacion }) {
  const que = tipo === "clientes" ? "clientes y carros" : tipo === "inventario" ? "repuestos" : "gastos";
  return (
    <Tarjeta aria-labelledby="t-resultado" role="status">
      <CabeceraTarjeta id="t-resultado" titulo={r.error ? "La importación se detuvo" : "Importación terminada"} />
      {r.error ? <p className="text-[15px] text-negativo">{r.error}</p> : null}
      <ul className="grid gap-2 sm:grid-cols-3">
        <li className="rounded-2xl bg-positivo-fondo px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] text-positivo"><CircleCheck className="size-4" aria-hidden />Nuevos</span>
          <span className="num mt-1 block text-[22px] font-semibold">{r.creados}</span>
        </li>
        <li className="rounded-2xl bg-interna px-4 py-3">
          <span className="text-[13px] text-tinta-2">Completados (ya existían)</span>
          <span className="num mt-1 block text-[22px] font-semibold">{r.actualizados}</span>
        </li>
        <li className="rounded-2xl bg-interna px-4 py-3">
          <span className="text-[13px] text-tinta-2">Ya estaban, sin cambios</span>
          <span className="num mt-1 block text-[22px] font-semibold">{r.sinCambios}</span>
        </li>
      </ul>
      <p className="mt-3 text-sm text-tinta-2">Ya puedes ver los {que} en el sistema.</p>
      {r.errores.length ? (
        <details className="mt-4 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo" open>
          <summary className="cursor-pointer font-medium">
            <CircleAlert className="mr-1 inline size-4" aria-hidden />
            {r.errores.length === 1 ? "1 fila no se importó" : `${r.errores.length} filas no se importaron`}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {r.errores.slice(0, 100).map((e, i) => (
              <li key={i}>Fila {e.fila}: {e.motivo}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {r.avisos.length ? (
        <details className="mt-3 rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
          <summary className="cursor-pointer font-medium">{r.avisos.length} avisos</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {r.avisos.slice(0, 100).map((e, i) => (
              <li key={i}>Fila {e.fila}: {e.motivo}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Tarjeta>
  );
}
