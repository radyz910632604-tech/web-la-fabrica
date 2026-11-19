"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, X } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Casilla } from "@/components/ui/casilla";
import { Tarjeta } from "@/components/ui/tarjeta";
import { montosLinea, sumarMontos } from "@/lib/dinero";
import { formatearSoles } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { leerXmlSunat } from "@/lib/xml-sunat";
import { avisoIa, LeerConIa } from "@/components/ia/leer-con-ia";
import type { ComprobanteLeido } from "@/lib/ia/esquemas";
import { registrarCompra, type Resultado } from "../acciones";

type Opcion = { id: string; etiqueta: string };
type Proveedor = { id: string; ruc: string | null; razonSocial: string };
type Linea = { clave: number; descripcion: string; cantidad: string; precio: string; orden: string; repuesto: string };
type RepuestoOpcion = { id: string; codigo: string; nombre: string };

const TIPOS = [
  ["factura", "Factura"],
  ["boleta", "Boleta"],
  ["nota_venta", "Nota de venta"],
  ["ticket", "Ticket"],
  ["sin_comprobante", "Sin comprobante"],
] as const;

const lineaVacia = (clave: number, orden = ""): Linea => ({ clave, descripcion: "", cantidad: "1", precio: "", orden, repuesto: "" });
const simple = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Si la descripción del proveedor coincide con un repuesto del inventario, se sugiere. */
function sugerirRepuesto(descripcion: string, repuestos: RepuestoOpcion[]): string {
  const d = simple(descripcion);
  if (!d) return "";
  return repuestos.find((r) => simple(r.nombre) === d || d.includes(simple(r.codigo)))?.id ?? "";
}

export function FormularioCompra({ proveedores, ordenes, repuestos = [], hoy, tasaIgv, ordenInicial, ia = false }: { proveedores: Proveedor[]; ordenes: Opcion[]; repuestos?: RepuestoOpcion[]; hoy: string; tasaIgv: number; ordenInicial?: string; ia?: boolean }) {
  const router = useRouter();
  const [proveedorId, setProveedorId] = useState("");
  const [ruc, setRuc] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [tipo, setTipo] = useState<string>("factura");
  const [serie, setSerie] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [moneda, setMoneda] = useState<"PEN" | "USD">("PEN");
  const [tipoCambio, setTipoCambio] = useState("1");
  const [incluyeIgv, setIncluyeIgv] = useState(true);
  const [origen, setOrigen] = useState<"manual" | "xml_sunat" | "ia">("manual");
  const [archivo, setArchivo] = useState<string>();
  const siguiente = useRef(1);
  const [lineas, setLineas] = useState<Linea[]>(() => [lineaVacia(0, ordenInicial)]);
  const [avisoXml, setAvisoXml] = useState<string>();

  const tasa = tipo === "factura" ? tasaIgv : 0;
  const montos = lineas.map((l) => montosLinea({ cantidad: Number(l.cantidad) || 0, precioUnitario: Number(l.precio) || 0, incluyeIgv }, tasa));
  const total = sumarMontos(montos);
  const simbolo = moneda === "USD" ? "US$" : "S/";

  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarCompra(previo, form);
    if (r.ok) router.push("/compras?registrada=1");
    return r;
  }, {});
  const e = estado.errores ?? {};

  const cambiarLinea = (clave: number, campo: keyof Linea, valor: string) => setLineas((ls) => ls.map((l) => (l.clave === clave ? { ...l, [campo]: valor } : l)));

  async function leerXml(archivo: File | undefined) {
    if (!archivo) return;
    try {
      const c = leerXmlSunat(await archivo.text());
      const existente = proveedores.find((p) => p.ruc && p.ruc === c.emisor.ruc);
      setProveedorId(existente?.id ?? "");
      setRuc(c.emisor.ruc);
      setRazonSocial(c.emisor.nombre);
      setTipo(c.tipo === "boleta" ? "boleta" : "factura");
      setSerie(c.serie);
      setNumero(c.numero);
      setFecha(c.fecha || hoy);
      setMoneda(c.moneda === "USD" ? "USD" : "PEN");
      setIncluyeIgv(false);
      setOrigen("xml_sunat");
      setLineas(
        c.lineas.length
          ? c.lineas.map((l) => ({ clave: siguiente.current++, descripcion: l.descripcion, cantidad: String(l.cantidad), precio: String(l.precioUnitarioSinIgv), orden: ordenInicial ?? "", repuesto: ordenInicial ? "" : sugerirRepuesto(l.descripcion, repuestos) }))
          : [lineaVacia(siguiente.current++, ordenInicial)],
      );
      setAvisoXml(`Leído del XML: ${c.emisor.nombre}, ${c.serie}-${c.numero}, total ${c.moneda === "USD" ? "US$" : "S/"} ${c.total.toFixed(2)}. Revisa y elige a qué orden va cada repuesto.`);
    } catch (err) {
      setAvisoXml(err instanceof Error ? err.message : "No se pudo leer el XML.");
    }
  }

  function leidoPorIa(c: ComprobanteLeido, ruta?: string) {
    const existente = proveedores.find((p) => p.ruc && p.ruc === c.emisor_ruc);
    setProveedorId(existente?.id ?? "");
    setRuc(c.emisor_ruc && /^(10|15|17|20)\d{9}$/.test(c.emisor_ruc) ? c.emisor_ruc : "");
    setRazonSocial(c.emisor_nombre ?? "");
    setTipo(["factura", "boleta", "nota_venta", "ticket"].includes(c.tipo) ? c.tipo : "ticket");
    setSerie((c.serie ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4));
    setNumero((c.numero ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 8));
    setFecha(c.fecha && /^\d{4}-\d{2}-\d{2}$/.test(c.fecha) ? c.fecha : hoy);
    setMoneda(c.moneda);
    setIncluyeIgv(c.precios_incluyen_igv);
    setOrigen("ia");
    setArchivo(ruta);
    const lineasIa = c.lineas.length ? c.lineas : [{ descripcion: "Según comprobante", cantidad: 1, precio_unitario: c.total ?? 0, importe: c.total ?? 0 }];
    setLineas(
      lineasIa.map((l) => ({
        clave: siguiente.current++, descripcion: l.descripcion.slice(0, 200), cantidad: String(l.cantidad || 1), precio: String(l.precio_unitario || (l.importe && l.cantidad ? Math.round((l.importe / l.cantidad) * 100) / 100 : 0)),
        orden: ordenInicial ?? "", repuesto: ordenInicial ? "" : sugerirRepuesto(l.descripcion, repuestos),
      })),
    );
    setAvisoXml(avisoIa(c, Math.round(c.lineas.reduce((a, l) => a + l.importe, 0) * 100) / 100));
  }

  const datos = JSON.stringify({
    proveedorId,
    ruc: proveedorId ? "" : ruc,
    razonSocial: proveedorId ? "" : razonSocial,
    tipo,
    serie,
    numero,
    fecha,
    moneda,
    tipoCambio: moneda === "USD" ? tipoCambio : "1",
    incluyeIgv,
    origen,
    archivo: origen === "ia" ? (archivo ?? "") : "",
    lineas: lineas.map(({ descripcion, cantidad, precio, orden, repuesto }) => ({ descripcion, cantidad, precio, orden, repuesto: orden ? "" : repuesto })),
  });

  return (
    <form action={accion} className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12 [&>*]:min-w-0">
      <input type="hidden" name="datos" value={datos} />
      <div className="flex flex-col gap-4 xl:col-span-8">
        <Tarjeta className="flex flex-col gap-4">
          <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-control px-4 text-center text-[15px] text-tinta-2 hover:bg-interna">
            <FileUp className="size-5 shrink-0" aria-hidden />
            Subir el XML del proveedor (opcional, llena todo solo)
            <input type="file" accept=".xml,text/xml,application/xml" className="sr-only" onChange={(ev) => leerXml(ev.target.files?.[0])} />
          </label>
          {ia ? <LeerConIa pista="compra" onLeido={leidoPorIa} /> : null}
          {avisoXml ? <p className={cn("rounded-2xl px-4 py-3 text-sm", origen === "ia" ? "bg-aviso-fondo" : "bg-interna")}>{avisoXml}</p> : null}

          <Campo etiqueta="Proveedor" error={e.razonSocial}>
            {(p) => (
              <Selector {...p} value={proveedorId} onChange={(ev) => setProveedorId(ev.target.value)}>
                <option value="">Proveedor nuevo…</option>
                {proveedores.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.razonSocial}
                    {pr.ruc ? ` · RUC ${pr.ruc}` : ""}
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          {proveedorId ? null : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <Campo etiqueta="RUC" error={e.ruc} ayuda="Opcional.">
                {(p) => <Entrada {...p} inputMode="numeric" maxLength={11} value={ruc} onChange={(ev) => setRuc(ev.target.value.replace(/\D/g, ""))} className="num" />}
              </Campo>
              <Campo etiqueta="Razón social o nombre">{(p) => <Entrada {...p} value={razonSocial} onChange={(ev) => setRazonSocial(ev.target.value)} />}</Campo>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo etiqueta="Comprobante" className="col-span-2 sm:col-span-1">
              {(p) => (
                <Selector {...p} value={tipo} onChange={(ev) => setTipo(ev.target.value)}>
                  {TIPOS.map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            {tipo !== "sin_comprobante" ? (
              <>
                <Campo etiqueta="Serie" error={e.serie}>
                  {(p) => <Entrada {...p} value={serie} onChange={(ev) => setSerie(ev.target.value.toUpperCase())} placeholder="F001" className="uppercase" />}
                </Campo>
                <Campo etiqueta="Número" error={e.numero}>
                  {(p) => <Entrada {...p} inputMode="numeric" value={numero} onChange={(ev) => setNumero(ev.target.value.replace(/\D/g, ""))} className="num" />}
                </Campo>
              </>
            ) : null}
            <Campo etiqueta="Fecha" error={e.fecha} className="col-span-2 sm:col-span-1">
              {(p) => <Entrada {...p} type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} className="num" />}
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Moneda">
              {(p) => (
                <Selector {...p} value={moneda} onChange={(ev) => setMoneda(ev.target.value as "PEN" | "USD")}>
                  <option value="PEN">Soles</option>
                  <option value="USD">Dólares</option>
                </Selector>
              )}
            </Campo>
            {moneda === "USD" ? (
              <Campo etiqueta="Tipo de cambio" error={e.tipoCambio}>
                {(p) => <Entrada {...p} type="number" step="0.001" inputMode="decimal" value={tipoCambio} onChange={(ev) => setTipoCambio(ev.target.value)} className="num" />}
              </Campo>
            ) : null}
          </div>
        </Tarjeta>

        <Tarjeta className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Repuestos</h2>
            {tasa > 0 ? (
              <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
                <Casilla checked={incluyeIgv} onCheckedChange={(v) => setIncluyeIgv(v === true)} />
                Los precios incluyen IGV
              </label>
            ) : (
              <p className="text-sm text-tinta-3">Sin crédito de IGV: el precio es el costo.</p>
            )}
          </div>
          {e.lineas ? <p className="text-sm text-negativo">{e.lineas}</p> : null}
          <ul className="flex flex-col gap-3">
            {lineas.map((l, i) => (
              <li key={l.clave} className="grid grid-cols-[minmax(0,1fr)_5rem_7.5rem_auto] items-end gap-2 rounded-2xl bg-interna p-3 max-md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Campo etiqueta={`Repuesto ${i + 1}`} error={e[`lineas.${i}.descripcion`]} className="max-md:col-span-3">
                  {(p) => <Entrada {...p} value={l.descripcion} onChange={(ev) => cambiarLinea(l.clave, "descripcion", ev.target.value)} placeholder="Ejemplo: pastillas de freno delanteras" />}
                </Campo>
                <Campo etiqueta="Cant.">{(p) => <Entrada {...p} type="number" step="0.01" min="0.01" inputMode="decimal" value={l.cantidad} onChange={(ev) => cambiarLinea(l.clave, "cantidad", ev.target.value)} className="num px-3" />}</Campo>
                <Campo etiqueta="Precio c/u" error={e[`lineas.${i}.precio`]}>
                  {(p) => <Entrada {...p} type="number" step="0.01" min="0" inputMode="decimal" value={l.precio} onChange={(ev) => cambiarLinea(l.clave, "precio", ev.target.value)} className="num px-3" />}
                </Campo>
                <button
                  type="button"
                  aria-label={`Quitar repuesto ${i + 1}`}
                  disabled={lineas.length === 1}
                  onClick={() => setLineas((ls) => ls.filter((x) => x.clave !== l.clave))}
                  className="grid size-12 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hundida disabled:invisible"
                >
                  <X className="size-5" aria-hidden />
                </button>
                <div className="col-span-full flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="sr-only" htmlFor={`destino-${l.clave}`}>
                    Para qué orden es
                  </label>
                  <Selector
                    id={`destino-${l.clave}`}
                    value={l.orden || (l.repuesto ? `rep:${l.repuesto}` : "")}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setLineas((ls) => ls.map((x) => (x.clave === l.clave ? { ...x, orden: v.startsWith("rep:") ? "" : v, repuesto: v.startsWith("rep:") ? v.slice(4) : "" } : x)));
                    }}
                    className="h-10 min-w-0 flex-1 text-sm sm:max-w-md"
                  >
                    <option value="">Va al stock sin código</option>
                    {repuestos.length ? (
                      <optgroup label="Al inventario (suma al stock)">
                        {repuestos.map((r) => (
                          <option key={r.id} value={`rep:${r.id}`}>
                            {r.codigo} · {r.nombre}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="Para una orden">
                      {ordenes.map((o) => (
                        <option key={o.id} value={o.id}>
                          Para {o.etiqueta}
                        </option>
                      ))}
                    </optgroup>
                  </Selector>
                  <span className="num ml-auto text-sm text-tinta-2">
                    {simbolo} {montos[i].total.toFixed(2)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Boton type="button" variante="secundario" tamano="chico" className="self-start" onClick={() => setLineas((ls) => [...ls, lineaVacia(siguiente.current++, ordenInicial)])}>
            <Plus />
            Otro repuesto
          </Boton>
        </Tarjeta>
      </div>

      <div className="xl:col-span-4">
        <Tarjeta className="flex flex-col gap-3 xl:sticky xl:top-24">
          <h2 className="text-lg font-semibold tracking-[-0.01em]">Total de la compra</h2>
          <dl className="num flex flex-col gap-2 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-tinta-2">Sin IGV</dt>
              <dd>
                {simbolo} {total.sinIgv.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-tinta-2">IGV</dt>
              <dd>
                {simbolo} {total.igv.toFixed(2)}
              </dd>
            </div>
            <div className="flex justify-between border-t border-regla pt-2 text-lg font-semibold">
              <dt>Total</dt>
              <dd>
                {simbolo} {total.total.toFixed(2)}
              </dd>
            </div>
            {moneda === "USD" && Number(tipoCambio) > 0 ? <p className="text-sm text-tinta-3">≈ {formatearSoles(total.total * Number(tipoCambio))} al cambio de {tipoCambio}</p> : null}
          </dl>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : origen === "ia" ? "Guardar por confirmar" : "Registrar compra"}
          </Boton>
          <p className="text-sm text-tinta-3">Lo que asignes a una orden cuenta como costo de esa orden. Lo que va al inventario suma al stock de ese repuesto.</p>
        </Tarjeta>
      </div>
    </form>
  );
}
