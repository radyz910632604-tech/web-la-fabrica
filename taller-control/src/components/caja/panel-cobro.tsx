"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, FileText, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { aprobarEnCaja, cambiarIgv, devolver, guardarLineas } from "@/app/(app)/caja/cobro/acciones";
import { FormCobro } from "@/components/caja/cobro";
import { Boton } from "@/components/ui/boton";
import { Entrada, Selector } from "@/components/ui/campo";
import { formatearSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Una línea de la orden tal como la ve la caja: precio SIN IGV por unidad. */
export type LineaCaja = { cotizacion: string; aprobada: boolean; tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; base: number; subtotal: number; total: number };
type Borrador = { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: string; base: string };

const aNumero = (t: string) => {
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

function Aviso({ texto, tono }: { texto?: string; tono: "error" | "ok" }) {
  if (!texto) return null;
  return (
    <p role={tono === "error" ? "alert" : "status"} className={cn("rounded-xl px-3 py-2 text-sm", tono === "error" ? "bg-negativo-fondo text-negativo" : "bg-positivo-fondo text-positivo")}>
      {texto}
    </p>
  );
}

/**
 * Servicios y productos de la orden, editables ahí mismo (lápiz → Guardar / Cancelar,
 * papelera, «Agregar servicio»). Cada cambio guarda una versión nueva de la cotización con
 * quién la hizo; lo que se deja en caja queda aprobado en persona.
 */
export function TablaLineas({
  ordenId,
  lineas,
  conIgv,
  editable,
  motivoBloqueo,
  preciosConIgv = false,
  sugerencias = [],
  precioDirecto = false,
  agregarFijo = false,
}: {
  /** El precio de cada fila se escribe ahí mismo (se guarda al salir del campo o con Enter). */
  precioDirecto?: boolean;
  /** La fila para agregar siempre a la vista (sin botón previo). */
  agregarFijo?: boolean;
  /** Nombres del catálogo o del inventario con su precio base (en la misma unidad que la tabla). */
  sugerencias?: { nombre: string; tipo: "servicio" | "repuesto"; precio: number | null }[];
  ordenId: string;
  lineas: LineaCaja[];
  conIgv: boolean;
  editable: boolean;
  motivoBloqueo?: string;
  /** En la orden: precio y total CON IGV (lo que paga el cliente). En caja: sin IGV, con el interruptor aparte. */
  preciosConIgv?: boolean;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState<number | "nueva" | null>(null);
  const [borrador, setBorrador] = useState<Borrador>({ tipo: "servicio", descripcion: "", cantidad: "1", base: "" });
  const [quitando, setQuitando] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();

  // A qué cotización va una línea nueva: la última aprobada; si no hay, la última vigente; si no, una nueva.
  const destinoNuevo = [...lineas].reverse().find((l) => l.aprobada)?.cotizacion ?? lineas.at(-1)?.cotizacion ?? null;

  type Envio = { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; base?: number; precio?: number };
  const comoEnvio = (l: LineaCaja | Envio): Envio => ("cotizacion" in l ? { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, base: l.base } : l);
  const unidad = (l: LineaCaja) => (preciosConIgv ? r2(l.total / l.cantidad) : l.base);
  function guardar(cotizacion: string | null, nuevas: (LineaCaja | Envio)[]) {
    setError(undefined);
    iniciar(async () => {
      const r = await guardarLineas({ orden: ordenId, cotizacion, conIgv, lineas: nuevas.map(comoEnvio) });
      if (r.error) return setError(r.error);
      setEditando(null);
      setQuitando(null);
      router.refresh();
    });
  }
  const deLaCotizacion = (cot: string) => lineas.filter((l) => l.cotizacion === cot);
  const desdeBorrador = (): Envio =>
    preciosConIgv
      ? { tipo: borrador.tipo, descripcion: borrador.descripcion.trim(), cantidad: aNumero(borrador.cantidad), precio: aNumero(borrador.base) }
      : { tipo: borrador.tipo, descripcion: borrador.descripcion.trim(), cantidad: aNumero(borrador.cantidad), base: aNumero(borrador.base) };
  const valido = borrador.descripcion.trim().length >= 2 && aNumero(borrador.cantidad) > 0 && borrador.base !== "";

  function guardarEdicion(i: number) {
    const l = lineas[i];
    const nuevas = deLaCotizacion(l.cotizacion).map((x) => (x === l ? desdeBorrador() : x));
    guardar(l.cotizacion, nuevas);
  }
  function guardarNueva() {
    const nuevas = destinoNuevo ? [...deLaCotizacion(destinoNuevo), desdeBorrador()] : [desdeBorrador()];
    guardar(destinoNuevo, nuevas);
  }
  function quitar(i: number) {
    const l = lineas[i];
    guardar(
      l.cotizacion,
      deLaCotizacion(l.cotizacion).filter((x) => x !== l),
    );
  }

  const filaEdicion = (alGuardar: () => void) => (
    <div className="flex flex-col gap-2 rounded-xl bg-positivo-fondo/60 p-2.5">
      <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2 @xl:grid-cols-[11rem_minmax(0,1fr)_4.5rem_7rem]">
        <Selector aria-label="Tipo" value={borrador.tipo} onChange={(e) => setBorrador({ ...borrador, tipo: e.target.value as Borrador["tipo"] })} className="col-span-2 h-11 text-sm @xl:col-span-1">
          <option value="servicio">Servicio / mano de obra</option>
          <option value="repuesto">Repuesto / producto</option>
        </Selector>
        <Entrada
          aria-label="Descripción"
          value={borrador.descripcion}
          onChange={(e) => {
            const valor = e.target.value;
            const base = sugerencias.find((x) => x.tipo === borrador.tipo && x.nombre.toLowerCase() === valor.trim().toLowerCase());
            setBorrador({ ...borrador, descripcion: valor, base: base?.precio != null && borrador.base === "" ? base.precio.toFixed(2) : borrador.base });
          }}
          list={sugerencias.length ? `sug-${borrador.tipo}` : undefined}
          placeholder={borrador.tipo === "servicio" ? "Servicio o mano de obra" : "Repuesto o producto"}
          autoFocus
          className="h-11"
          maxLength={200}
        />
        {sugerencias.length ? (
          <datalist id={`sug-${borrador.tipo}`}>
            {sugerencias.filter((x) => x.tipo === borrador.tipo).map((x) => (
              <option key={x.nombre} value={x.nombre} />
            ))}
          </datalist>
        ) : null}
        <Entrada aria-label="Cantidad" value={borrador.cantidad} onChange={(e) => setBorrador({ ...borrador, cantidad: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className="num h-11 px-3 text-right" />
        <Entrada aria-label="Precio (S/)" value={borrador.base} onChange={(e) => setBorrador({ ...borrador, base: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" placeholder="0.00" className="num col-span-2 h-11 px-3 text-right @xl:col-span-1" />
      </div>
      <div className="flex items-center justify-end gap-2">
        <span className="num mr-auto text-[13px] text-tinta-2">Subtotal {formatearSoles(r2(aNumero(borrador.cantidad) * aNumero(borrador.base)))}</span>
        <Boton type="button" tamano="chico" variante="secundario" onClick={() => setEditando(null)} aria-label="Cancelar">
          <X />
          Cancelar
        </Boton>
        <Boton type="button" tamano="chico" onClick={alGuardar} disabled={pendiente || !valido} aria-label="Guardar cambios">
          <Check />
          {pendiente ? "Guardando…" : "Guardar"}
        </Boton>
      </div>
    </div>
  );

  return (
    <div className="@container flex flex-col gap-2">
      <div className="hidden grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_6.5rem_5.5rem] gap-2 px-2 text-[12px] font-medium tracking-wide text-tinta-3 uppercase @xl:grid">
        <span>Servicio</span>
        <span className="text-right">Cant.</span>
        <span className="text-right">{preciosConIgv ? "Precio c/IGV" : "Precio (S/)"}</span>
        <span className="text-right">{preciosConIgv ? "Total" : "Subtotal"}</span>
        <span />
      </div>
      {lineas.length === 0 && editando !== "nueva" ? <p className="rounded-xl bg-interna px-3 py-3 text-[15px] text-tinta-2">Sin servicios con precio todavía.</p> : null}
      <ul className="flex flex-col gap-1.5">
        {lineas.map((l, i) =>
          editando === i ? (
            <li key={i}>{filaEdicion(() => guardarEdicion(i))}</li>
          ) : (
            <li
              key={i}
              className={cn(
                "grid items-center gap-x-2 gap-y-1 rounded-xl bg-interna px-3 py-2.5 @xl:grid-cols-[minmax(0,1fr)_3.5rem_6.5rem_6.5rem_5.5rem]",
                precioDirecto && editable ? "grid-cols-[minmax(0,1fr)_7rem]" : "grid-cols-[minmax(0,1fr)_auto]",
              )}
            >
              <span className="min-w-0 text-[15px]">
                {l.descripcion}
                {l.tipo === "repuesto" ? <span className="ml-1.5 text-[12px] text-tinta-3">Producto</span> : null}
                {!l.aprobada ? <span className="ml-1.5 rounded-full bg-aviso-fondo px-2 py-0.5 text-[11px] text-aviso">Por aprobar</span> : null}
                <span className="num block text-[12px] text-tinta-3 @xl:hidden">
                  {l.cantidad} × {formatearSoles(unidad(l))}
                </span>
              </span>
              <span className="num hidden text-right @xl:block">{l.cantidad}</span>
              {precioDirecto && editable && l.cantidad === 1 ? (
                <CampoPrecio
                  key={`${l.cotizacion}-${unidad(l)}`}
                  valor={unidad(l)}
                  etiqueta={`Precio de ${l.descripcion}`}
                  deshabilitado={pendiente}
                  alGuardar={(nuevo) =>
                    guardar(
                      l.cotizacion,
                      deLaCotizacion(l.cotizacion).map((x) =>
                        x === l ? (preciosConIgv ? { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, precio: nuevo } : { tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, base: nuevo }) : x,
                      ),
                    )
                  }
                />
              ) : (
                <span className="num hidden text-right @xl:block">{unidad(l).toFixed(2)}</span>
              )}
              <span className={cn("num font-semibold", precioDirecto && editable ? "text-[13px] text-tinta-2 @xl:text-right @xl:text-[15px] @xl:text-tinta" : "text-right")}>
                {precioDirecto && editable ? <span className="@xl:hidden">Total </span> : null}
                {(preciosConIgv ? l.total : l.subtotal).toFixed(2)}
              </span>
              <span className={cn("flex justify-end gap-1 @xl:col-span-1", !(precioDirecto && editable) && "col-span-2")}>
                {quitando === i ? (
                  <>
                    <Boton type="button" tamano="chico" variante="peligro" disabled={pendiente} onClick={() => quitar(i)}>
                      Quitar
                    </Boton>
                    <Boton type="button" tamano="chico" variante="fantasma" onClick={() => setQuitando(null)} aria-label="No quitar">
                      <X />
                    </Boton>
                  </>
                ) : editable ? (
                  <>
                    <button
                      type="button"
                      aria-label={`Editar ${l.descripcion}`}
                      onClick={() => {
                        setBorrador({ tipo: l.tipo, descripcion: l.descripcion, cantidad: String(l.cantidad), base: unidad(l).toFixed(2) });
                        setEditando(i);
                        setError(undefined);
                      }}
                      className="grid size-9 cursor-pointer place-items-center rounded-lg text-tinta-2 hover:bg-tarjeta hover:text-tinta"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button type="button" aria-label={`Quitar ${l.descripcion}`} onClick={() => setQuitando(i)} className="grid size-9 cursor-pointer place-items-center rounded-lg text-negativo hover:bg-negativo-fondo">
                      <Trash2 className="size-4" />
                    </button>
                  </>
                ) : null}
              </span>
            </li>
          ),
        )}
        {editando === "nueva" ? <li>{filaEdicion(guardarNueva)}</li> : null}
      </ul>
      {editable && agregarFijo ? (
        <FilaAgregar sugerencias={sugerencias} pendiente={pendiente} preciosConIgv={preciosConIgv} alAgregar={(nueva) => guardar(destinoNuevo, destinoNuevo ? [...deLaCotizacion(destinoNuevo), nueva] : [nueva])} />
      ) : null}
      {editable && !agregarFijo && editando === null ? (
        <button
          type="button"
          onClick={() => {
            setBorrador({ tipo: "servicio", descripcion: "", cantidad: "1", base: "" });
            setEditando("nueva");
            setError(undefined);
          }}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-start rounded-full border border-borde px-4 text-[14px] font-medium hover:bg-interna"
        >
          <Plus className="size-4" />
          Agregar servicio o producto
        </button>
      ) : null}
      {!editable && motivoBloqueo ? <p className="text-[13px] text-tinta-3">{motivoBloqueo}</p> : null}
      <Aviso texto={error} tono="error" />
    </div>
  );
}

/** Precio escrito directo en la fila: se guarda al salir del campo o con Enter, solo si cambió. */
function CampoPrecio({ valor, etiqueta, deshabilitado, alGuardar }: { valor: number; etiqueta: string; deshabilitado: boolean; alGuardar: (nuevo: number) => void }) {
  const [texto, setTexto] = useState(valor.toFixed(2));
  const confirmar = () => {
    const nuevo = aNumero(texto);
    if (texto.trim() === "" || nuevo < 0) return setTexto(valor.toFixed(2));
    if (Math.abs(nuevo - valor) > 0.004) alGuardar(r2(nuevo));
  };
  return (
    <span className="relative">
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[12px] text-tinta-3">S/</span>
      <Entrada
        aria-label={etiqueta}
        value={texto}
        disabled={deshabilitado}
        onChange={(e) => setTexto(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        inputMode="decimal"
        className="num h-10 w-28 pl-7 text-right @xl:w-full"
      />
    </span>
  );
}

/** Fila fija para agregar: qué es, tipo, cantidad, precio y «+». */
function FilaAgregar({
  sugerencias,
  pendiente,
  preciosConIgv,
  alAgregar,
}: {
  sugerencias: { nombre: string; tipo: "servicio" | "repuesto"; precio: number | null }[];
  pendiente: boolean;
  preciosConIgv: boolean;
  alAgregar: (l: { tipo: "servicio" | "repuesto"; descripcion: string; cantidad: number; base?: number; precio?: number }) => void;
}) {
  const [f, setF] = useState<Borrador>({ tipo: "servicio", descripcion: "", cantidad: "1", base: "" });
  const valido = f.descripcion.trim().length >= 2 && aNumero(f.cantidad) > 0 && f.base !== "";
  return (
    <form
      className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-2 rounded-xl border border-dashed border-borde p-2 @xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valido) return;
        const cantidad = aNumero(f.cantidad);
        const monto = aNumero(f.base);
        alAgregar(preciosConIgv ? { tipo: f.tipo, descripcion: f.descripcion.trim(), cantidad, precio: monto } : { tipo: f.tipo, descripcion: f.descripcion.trim(), cantidad, base: monto });
        setF({ tipo: f.tipo, descripcion: "", cantidad: "1", base: "" });
      }}
    >
      <Entrada
        aria-label="Agregar un trabajo o producto"
        placeholder="Agregar un trabajo o producto…"
        value={f.descripcion}
        list={sugerencias.length ? `fila-${f.tipo}` : undefined}
        onChange={(e) => {
          const valor = e.target.value;
          const base = sugerencias.find((x) => x.tipo === f.tipo && x.nombre.toLowerCase() === valor.trim().toLowerCase());
          setF({ ...f, descripcion: valor, base: base?.precio != null && f.base === "" ? base.precio.toFixed(2) : f.base });
        }}
        className="col-span-3 h-11 @xl:col-span-4"
        maxLength={200}
        autoComplete="off"
      />
      {sugerencias.length ? (
        <datalist id={`fila-${f.tipo}`}>
          {sugerencias.filter((x) => x.tipo === f.tipo).map((x) => (
            <option key={x.nombre} value={x.nombre} />
          ))}
        </datalist>
      ) : null}
      <Selector aria-label="Tipo de lo que agregas" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as Borrador["tipo"] })} className="col-span-3 h-11 text-[13px] @xl:col-span-1">
        <option value="servicio">Servicio / mano de obra</option>
        <option value="repuesto">Repuesto / producto</option>
      </Selector>
      <Entrada aria-label="Cantidad a agregar" value={f.cantidad} onChange={(e) => setF({ ...f, cantidad: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" className="num h-11 px-2 text-right" />
      <span className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[12px] text-tinta-3">S/</span>
        <Entrada aria-label="Precio a agregar (S/)" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value.replace(/[^\d.,]/g, "") })} inputMode="decimal" placeholder="0.00" className="num h-11 pl-7 text-right" />
      </span>
      <Boton type="submit" tamano="icono" disabled={pendiente || !valido} aria-label="Agregar a la orden" className="h-11 w-11">
        <Plus />
      </Boton>
    </form>
  );
}

/** Interruptor del IGV de la orden; el cálculo se actualiza en la misma pantalla. */
export function InterruptorIgv({ ordenId, conIgv, puedeQuitar, editable }: { ordenId: string; conIgv: boolean; puedeQuitar: boolean; editable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();
  const bloqueado = !editable || pendiente || (conIgv && !puedeQuitar);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={conIgv}
        aria-label="IGV 18 %"
        disabled={bloqueado}
        title={conIgv && !puedeQuitar ? "Quitar el IGV lo autoriza gerencia o administración" : undefined}
        onClick={() =>
          iniciar(async () => {
            setError(undefined);
            const r = await cambiarIgv(ordenId, !conIgv);
            if (r.error) setError(r.error);
            else router.refresh();
          })
        }
        className={cn("relative h-7 w-12 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60", conIgv ? "bg-positivo" : "bg-control")}
      >
        <span className={cn("absolute top-1 left-1 size-5 rounded-full bg-white shadow transition-transform duration-150", conIgv && "translate-x-5")} />
      </button>
      {error ? <span className="max-w-60 text-right text-[12px] text-negativo">{error}</span> : null}
    </div>
  );
}

/** Aprobar en persona lo que estaba por aprobar (cuando no se editó en caja). */
export function AprobarEnCaja({ cotizacion }: { cotizacion: string }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  return (
    <Boton type="button" tamano="chico" disabled={pendiente} onClick={() => iniciar(async () => { const r = await aprobarEnCaja(cotizacion); if (!r.error) router.refresh(); })}>
      <Check />
      Aprobar en persona
    </Boton>
  );
}

type Comprobante = "constancia" | "boleta" | "factura";

/**
 * Forma de pago (uno o varios medios), tipo de comprobante y confirmación.
 * El tipo de comprobante no cambia el cálculo del IGV: eso lo decide el interruptor.
 */
export function CobroConComprobante({ ordenId, saldo, conPrecio, pagada, reciboId, puedeEmitirRecibo }: { ordenId: string; saldo: number; conPrecio: boolean; pagada: boolean; reciboId: string | null; puedeEmitirRecibo: boolean }) {
  const [comprobante, setComprobante] = useState<Comprobante>("constancia");
  const [listo, setListo] = useState<null | number>(null);
  return (
    <div className="flex flex-col gap-4">
      {!pagada ? (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Comprobante</legend>
            <div role="radiogroup" aria-label="Comprobante" className="grid grid-cols-3 gap-1 rounded-full bg-hundida p-1">
              {(
                [
                  ["constancia", "Constancia"],
                  ["boleta", "Boleta"],
                  ["factura", "Factura"],
                ] as const
              ).map(([v, t]) => (
                <button key={v} type="button" role="radio" aria-checked={comprobante === v} onClick={() => setComprobante(v)} className={cn("h-10 cursor-pointer rounded-full text-[14px] font-medium", comprobante === v ? "bg-tarjeta text-tinta shadow-sm" : "text-tinta-2")}>
                  {t}
                </button>
              ))}
            </div>
          </fieldset>
          <FormCobro key={saldo} ordenId={ordenId} saldo={saldo} conPrecio={conPrecio} alListo={setListo} textoBoton="Confirmar pago de" />
        </>
      ) : null}
      {listo !== null || pagada ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-borde p-3.5">
          <p className="text-sm font-medium">{pagada ? "Orden pagada." : "Pago registrado."} Siguiente paso:</p>
          {comprobante === "constancia" || pagada ? (
            <div className="flex flex-wrap gap-2">
              <Boton asChild variante="secundario" tamano="chico">
                <a href={`/pdf/cuenta/${ordenId}`} target="_blank" rel="noreferrer">
                  <FileText />
                  Constancia (estado de cuenta)
                </a>
              </Boton>
              {reciboId ? (
                <Boton asChild variante="secundario" tamano="chico">
                  <a href={`/pdf/recibo/${reciboId}`} target="_blank" rel="noreferrer">
                    <FileText />
                    Recibo interno
                  </a>
                </Boton>
              ) : puedeEmitirRecibo ? (
                <span className="text-[13px] text-tinta-2">Puedes emitir el recibo interno abajo.</span>
              ) : null}
            </div>
          ) : null}
          {comprobante !== "constancia" && !pagada ? (
            <p className="text-[13px] text-tinta-2">
              La {comprobante} electrónica se emite en el sistema de la SUNAT (no hay emisión conectada al CRM). Luego regístrala en la orden con su serie y número:{" "}
              <Link href={`/ordenes/${ordenId}#t-dinero`} className="font-medium underline underline-offset-4">
                Registrar {comprobante}
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Devolver parte de un pago (cuando el cliente tiene saldo a favor): movimiento aparte. */
export function DevolverPago({ pagoId, maximo }: { pagoId: string; maximo: number }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [monto, setMonto] = useState(maximo.toFixed(2));
  const [motivo, setMotivo] = useState("");
  const [r, setR] = useState<{ ok?: string; error?: string }>({});
  const [pendiente, iniciar] = useTransition();
  if (!abierto)
    return (
      <button type="button" onClick={() => setAbierto(true)} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded-full px-2.5 text-[13px] text-negativo hover:bg-negativo-fondo">
        <Undo2 className="size-3.5" />
        Devolver
      </button>
    );
  return (
    <form
      className="col-span-full flex flex-col gap-2 rounded-xl border border-borde p-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const res = await devolver(pagoId, monto, motivo);
          setR(res);
          if (res.ok) router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
        <Entrada aria-label="Monto a devolver" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" className="num h-10 px-3" />
        <Entrada aria-label="Motivo de la devolución" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo" maxLength={200} className="h-10" />
      </div>
      <div className="flex justify-end gap-2">
        <Boton type="button" tamano="chico" variante="fantasma" onClick={() => setAbierto(false)}>
          Cancelar
        </Boton>
        <Boton type="submit" tamano="chico" variante="peligro" disabled={pendiente || motivo.trim().length < 5}>
          {pendiente ? "…" : "Registrar devolución"}
        </Boton>
      </div>
      <Aviso texto={r.error} tono="error" />
    </form>
  );
}
