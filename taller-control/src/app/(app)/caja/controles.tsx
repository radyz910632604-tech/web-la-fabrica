"use client";

import { useActionState, useState } from "react";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ClipboardCheck, Lock, LockOpen } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { formatearSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Chips, GASTOS_FRECUENTES, MEDIOS_CHIP } from "@/components/caja/eleccion-rapida";
import { CATEGORIAS_GASTO } from "../gastos/categorias";
import { abrirCaja, cerrarCaja, moverFondo, registrarArqueo, registrarMovimiento, type Resultado } from "./acciones";

function CampoSoles({ nombre, etiqueta, error, ayuda, valor, onChange, autoFocus }: { nombre: string; etiqueta: string; error?: string; ayuda?: string; valor?: string; onChange?: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Campo etiqueta={etiqueta} error={error} ayuda={ayuda}>
      {(p) => (
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
          <Entrada
            {...p}
            name={nombre}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            required
            autoFocus={autoFocus}
            {...(onChange ? { value: valor ?? "", onChange: (e) => onChange(e.target.value) } : {})}
            className="num pl-11 text-lg"
          />
        </div>
      )}
    </Campo>
  );
}

export function AbrirCaja({ area = "recepcion" }: { area?: "recepcion" | "almacen" }) {
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(abrirCaja, {});
  return (
    <form action={accion} className="flex flex-col gap-4 sm:max-w-sm">
      <input type="hidden" name="area" value={area} />
      <CampoSoles nombre="monto" etiqueta="¿Con cuánto sencillo empiezas?" error={estado.errores?.monto} ayuda="El efectivo que hay en la caja ahora. Puede ser cero." />
      {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
      <Boton type="submit" disabled={enviando}>
        <LockOpen />
        {enviando ? "Abriendo…" : "Abrir caja"}
      </Boton>
    </form>
  );
}

export function Movimiento({ caja }: { caja: string }) {
  const [abierta, setAbierta] = useState(false);
  const [tipo, setTipo] = useState<"egreso" | "ingreso">("egreso");
  const [categoria, setCategoria] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const [medio, setMedio] = useState("efectivo");
  const [conComprobante, setConComprobante] = useState(false);
  const [tipoComp, setTipoComp] = useState("boleta");
  const [detalle, setDetalle] = useState("");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarMovimiento(previo, form);
    if (r.ok) {
      setAbierta(false);
      setCategoria("");
      setDetalle("");
      setConComprobante(false);
    }
    return r;
  }, {});
  const e = estado.errores ?? {};
  const nombreCategoria =
    categoria === "retiro" ? "Retiro de dinero" : (CATEGORIAS_GASTO as Record<string, string>)[categoria] ?? "";
  // «Para qué» es opcional: si no se escribe, va el nombre de lo elegido.
  const concepto = detalle.trim() || (tipo === "egreso" ? nombreCategoria : "Ingreso de dinero");
  const esGasto = tipo === "egreso" && categoria && categoria !== "retiro";
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante="secundario">
          <ArrowUpRight />
          Gasto o ingreso
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo={tipo === "egreso" ? "Sale dinero" : "Entra dinero"} descripcion="Monto y un toque. Lo demás es opcional.">
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="caja" value={caja} />
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="concepto" value={concepto} />
          <input type="hidden" name="medio" value={medio} />
          <input type="hidden" name="categoria_gasto" value={tipo === "egreso" ? categoria : ""} />
          <input type="hidden" name="tipo_comprobante" value={esGasto && conComprobante ? tipoComp : "sin_comprobante"} />
          <div className="grid grid-cols-2 gap-1 rounded-full bg-hundida p-1" role="group" aria-label="Sale o entra">
            {(
              [
                ["egreso", "Sale dinero", ArrowUpRight],
                ["ingreso", "Entra dinero", ArrowDownLeft],
              ] as const
            ).map(([v, t, Icono]) => (
              <button
                key={v}
                type="button"
                aria-pressed={tipo === v}
                onClick={() => setTipo(v)}
                className={cn("flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full text-[15px] font-medium", tipo === v ? "bg-tarjeta text-tinta shadow-sm" : "text-tinta-2")}
              >
                <Icono className="size-4" aria-hidden />
                {t}
              </button>
            ))}
          </div>
          <CampoSoles nombre="monto" etiqueta="Monto" error={e.monto} autoFocus />
          {tipo === "egreso" ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">¿En qué?</p>
              <Chips
                etiqueta="En qué"
                opciones={[...GASTOS_FRECUENTES, ["retiro", "Retiro (no es gasto)"]] as const}
                valor={(GASTOS_FRECUENTES.some(([k]) => k === categoria) || categoria === "retiro" ? categoria : "") as never}
                alElegir={(v) => setCategoria(v)}
              />
              {verTodas || (categoria && !GASTOS_FRECUENTES.some(([k]) => k === categoria) && categoria !== "retiro") ? (
                <Selector aria-label="Otra categoría" value={categoria} onChange={(ev) => setCategoria(ev.target.value)}>
                  <option value="">Otra categoría…</option>
                  {Object.entries(CATEGORIAS_GASTO).map(([k, t]) => (
                    <option key={k} value={k}>
                      {t}
                    </option>
                  ))}
                </Selector>
              ) : (
                <button type="button" onClick={() => setVerTodas(true)} className="w-fit cursor-pointer text-[13px] text-tinta-2 underline-offset-4 hover:underline">
                  Más categorías (luz, agua, alquiler…)
                </button>
              )}
              {e.categoria_gasto ? <p className="text-sm text-negativo">{e.categoria_gasto}</p> : null}
            </div>
          ) : null}
          <Campo etiqueta="Detalle (opcional)" error={e.concepto}>
            {(p) => <Entrada {...p} value={detalle} onChange={(ev) => setDetalle(ev.target.value)} placeholder={tipo === "egreso" ? "Ejemplo: taxi para recoger repuesto" : "Ejemplo: sencillo que trajo gerencia"} maxLength={200} autoComplete="off" />}
          </Campo>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Medio</p>
            <Chips etiqueta="Medio" opciones={MEDIOS_CHIP} valor={medio as never} alElegir={(v) => setMedio(v)} tamano="chico" />
          </div>
          {esGasto ? (
            conComprobante ? (
              <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
                <Campo etiqueta="Comprobante">
                  {(p) => (
                    <Selector {...p} value={tipoComp} onChange={(ev) => setTipoComp(ev.target.value)}>
                      <option value="boleta">Boleta</option>
                      <option value="factura">Factura</option>
                      <option value="recibo">Recibo</option>
                      <option value="otro">Otro</option>
                    </Selector>
                  )}
                </Campo>
                <Campo etiqueta="Número" ayuda="Si no lo tienes, déjalo: queda pendiente." error={e.numero_comprobante}>
                  {(p) => <Entrada {...p} name="numero_comprobante" placeholder="B001-4521" maxLength={40} autoComplete="off" />}
                </Campo>
              </div>
            ) : (
              <button type="button" onClick={() => setConComprobante(true)} className="w-fit cursor-pointer text-[13px] text-tinta-2 underline-offset-4 hover:underline">
                + Tengo boleta, factura o recibo
              </button>
            )
          ) : null}
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : tipo === "egreso" ? (categoria === "retiro" ? "Registrar retiro" : "Registrar salida") : "Registrar ingreso"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

export function CerrarCaja({ caja, esperado }: { caja: string; esperado: number }) {
  const [abierta, setAbierta] = useState(false);
  const [contado, setContado] = useState("");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await cerrarCaja(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const diferencia = contado === "" ? null : Math.round((Number(contado) - esperado) * 100) / 100;
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante="secundario">
          <Lock />
          Cerrar caja
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Cerrar caja" descripcion="Cuenta el efectivo que hay en la caja y escríbelo. Yape, Plin, tarjeta y transferencias no se cuentan: quedan en el resumen.">
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="caja" value={caja} />
          <CampoSoles nombre="contado" etiqueta="Efectivo contado" error={estado.errores?.contado} valor={contado} onChange={setContado} autoFocus />
          <dl className="num grid grid-cols-2 gap-2">
            <div className="rounded-2xl bg-interna px-4 py-3">
              <dt className="text-[13px] text-tinta-2">Debería haber</dt>
              <dd className="text-[17px] font-semibold">{formatearSoles(esperado)}</dd>
            </div>
            <div className={cn("rounded-2xl px-4 py-3", diferencia === null ? "bg-interna" : diferencia === 0 ? "bg-positivo-fondo" : diferencia > 0 ? "bg-aviso-fondo" : "bg-negativo-fondo")}>
              <dt className="text-[13px] text-tinta-2">{diferencia === null ? "Diferencia" : diferencia === 0 ? "Cuadra" : diferencia > 0 ? "Sobra" : "Falta"}</dt>
              <dd className={cn("text-[17px] font-semibold", diferencia !== null && diferencia < 0 && "text-negativo")}>{diferencia === null ? "—" : formatearSoles(Math.abs(diferencia))}</dd>
            </div>
          </dl>
          <Campo etiqueta="Observaciones" ayuda={diferencia ? "Explica la diferencia, si sabes por qué." : "Opcional."}>
            {(p) => <textarea {...p} name="observaciones" rows={2} className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta" />}
          </Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando || contado === ""} className="w-full">
            {enviando ? "Cerrando…" : "Cerrar caja"}
          </Boton>
          <p className="text-sm text-tinta-3">Una caja cerrada ya no se cambia. Lo que cobres después entra a la caja de mañana.</p>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Arqueo de una caja que se cerró sola a las 00:00 (gerencia o administración cuentan el efectivo). */
export function RegistrarArqueo({ caja, area, esperado }: { caja: string; area: string; esperado: number }) {
  const [abierta, setAbierta] = useState(false);
  const [contado, setContado] = useState("");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(registrarArqueo, {});
  const diferencia = contado === "" ? null : Math.round((Number(contado) - esperado) * 100) / 100;
  return (
    <Ventana open={abierta && !estado.ok} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton tamano="chico">
          <ClipboardCheck />
          Registrar arqueo
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo={`Arqueo de la caja de ${area}`} descripcion={`Se cerró sola a las 00:00. El sistema esperaba ${formatearSoles(esperado)} en efectivo: cuenta lo que hay y escríbelo.`}>
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="caja" value={caja} />
          <CampoSoles nombre="contado" etiqueta="Efectivo contado" error={estado.errores?.contado} valor={contado} onChange={setContado} autoFocus />
          {diferencia != null ? (
            <p className={cn("num rounded-2xl px-4 py-3 text-[15px] font-medium", diferencia === 0 ? "bg-positivo-fondo text-positivo" : diferencia > 0 ? "bg-aviso-fondo text-aviso" : "bg-negativo-fondo text-negativo")}>
              {diferencia === 0 ? "Cuadra exacto." : diferencia > 0 ? `Sobran ${formatearSoles(diferencia)}.` : `Faltan ${formatearSoles(-diferencia)}.`}
            </p>
          ) : null}
          <Campo etiqueta="Nota (opcional)">{(p) => <Entrada {...p} name="observaciones" maxLength={300} placeholder="Quién contó, dónde estaba el efectivo…" />}</Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando || contado === ""} className="w-full">
            {enviando ? "Guardando…" : "Registrar arqueo"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

type Persona = { id: string; nombre: string };

/**
 * Dinero para Almacén: entregarle fondo para comprar, o recibir su vuelto.
 * Es un traspaso de efectivo (sale de una caja y entra a la otra): no es gasto.
 */
export function FondoAlmacen({
  tipo,
  personas,
  almaceneros,
  yo,
  puedeExterno,
  desdeRecepcion,
}: {
  tipo: "asignacion" | "devolucion";
  personas: Persona[];
  almaceneros: Persona[];
  yo: string;
  puedeExterno: boolean;
  desdeRecepcion: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [origen, setOrigen] = useState<"recepcion" | "externo">("recepcion");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await moverFondo(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const e = estado.errores ?? {};
  const esAsignacion = tipo === "asignacion";
  const almacenero = almaceneros.find((p) => p.id === yo)?.id ?? almaceneros[0]?.id ?? "";
  const entregaPorDefecto = esAsignacion ? (desdeRecepcion ? yo : "") : almacenero;
  const recibePorDefecto = esAsignacion ? almacenero : desdeRecepcion ? yo : "";
  const opciones = (lista: Persona[]) =>
    lista.map((p) => (
      <option key={p.id} value={p.id}>
        {p.nombre}
      </option>
    ));
  return (
    <>
      <Ventana open={abierta} onOpenChange={setAbierta}>
        <DisparadorVentana asChild>
          <Boton variante="secundario">
            <ArrowLeftRight />
            {esAsignacion ? (desdeRecepcion ? "Entregar a Almacén" : "Recibir fondo") : "Devolver vuelto"}
          </Boton>
        </DisparadorVentana>
        <ContenidoVentana
          titulo={esAsignacion ? "Dinero para Almacén" : "Vuelto de Almacén"}
          descripcion={
            esAsignacion
              ? "Efectivo para comprar repuestos o insumos. No es un gasto: el gasto es lo que Almacén compre, con su comprobante."
              : "Lo que sobró del fondo vuelve a la Caja de Recepción (o al dueño)."
          }
        >
          <form action={accion} className="flex flex-col gap-4">
            <input type="hidden" name="tipo" value={tipo} />
            <input type="hidden" name="origen" value={origen} />
            {puedeExterno ? (
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="De dónde sale">
                {(
                  [
                    ["recepcion", esAsignacion ? "De la Caja de Recepción" : "A la Caja de Recepción", esAsignacion ? "Sale de esa caja" : "Entra a esa caja"],
                    ["externo", esAsignacion ? "Fuera de las cajas" : "Al dueño", esAsignacion ? "Lo da el dueño" : "No entra a ninguna caja"],
                  ] as const
                ).map(([v, t, d]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={origen === v}
                    onClick={() => setOrigen(v)}
                    className={cn("presionable cursor-pointer rounded-2xl border px-4 py-3 text-left", origen === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
                  >
                    <span className="block text-[15px] font-medium">{t}</span>
                    <span className="block text-[13px] text-tinta-2">{d}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <CampoSoles nombre="monto" etiqueta="Monto en efectivo" error={e.monto} autoFocus />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Entrega" error={e.entrega}>
                {(p) => (
                  <Selector {...p} name="entrega" defaultValue={entregaPorDefecto} required>
                    <option value="" disabled>
                      Elige…
                    </option>
                    {opciones(esAsignacion ? personas : almaceneros)}
                  </Selector>
                )}
              </Campo>
              <Campo etiqueta="Recibe" error={e.recibe}>
                {(p) => (
                  <Selector {...p} name="recibe" defaultValue={recibePorDefecto} required>
                    <option value="" disabled>
                      Elige…
                    </option>
                    {opciones(esAsignacion ? almaceneros : personas)}
                  </Selector>
                )}
              </Campo>
            </div>
            <Campo etiqueta="Nota (opcional)">{(p) => <Entrada {...p} name="nota" maxLength={120} placeholder="Ejemplo: repuestos del Hilux" autoComplete="off" />}</Campo>
            {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
            <Boton type="submit" disabled={enviando} className="w-full">
              {enviando ? "Guardando…" : esAsignacion ? "Registrar entrega" : "Registrar vuelto"}
            </Boton>
          </form>
        </ContenidoVentana>
      </Ventana>
      {estado.ok && !abierta ? (
        <p role="status" className="fixed bottom-24 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo shadow-flotante md:bottom-8">
          {estado.ok}
        </p>
      ) : null}
    </>
  );
}
