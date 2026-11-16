"use client";

import { useActionState, useState, useTransition } from "react";
import { FileUp, Plus } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { leerXmlSunat } from "@/lib/xml-sunat";
import { asignarOrdenComprobante, registrarComprobante, type Resultado } from "./acciones";

type Opcion = { id: string; etiqueta: string };

export function RegistrarComprobante({
  ordenes,
  hoy,
  ordenFija,
  variante = "primario",
  tamano = "normal",
}: {
  ordenes: Opcion[];
  hoy: string;
  ordenFija?: string;
  variante?: "primario" | "secundario";
  tamano?: "normal" | "chico";
}) {
  const [abierta, setAbierta] = useState(false);
  const [v, setV] = useState({ tipo: "boleta", serie: "", numero: "", fecha: hoy, total: "", sin_igv: "", igv: "", documento: "", detalle: "", origen: "manual" });
  const [avisoXml, setAvisoXml] = useState<string>();
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarComprobante(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const e = estado.errores ?? {};
  const cambiar = (k: keyof typeof v, valor: string) => setV((x) => ({ ...x, [k]: valor }));

  async function leerXml(archivo: File | undefined) {
    if (!archivo) return;
    try {
      const c = leerXmlSunat(await archivo.text());
      setV({
        tipo: c.tipo === "factura" ? "factura" : "boleta",
        serie: c.serie,
        numero: c.numero,
        fecha: c.fecha || hoy,
        total: c.total.toFixed(2),
        sin_igv: c.sinIgv.toFixed(2),
        igv: c.igv.toFixed(2),
        documento: c.cliente.documento,
        detalle: c.lineas.map((l) => `${l.cantidad} × ${l.descripcion}`).join("\n"),
        origen: "xml_sunat",
      });
      setAvisoXml(`Leído del XML: ${c.serie}-${c.numero}, S/ ${c.total.toFixed(2)} (sin IGV S/ ${c.sinIgv.toFixed(2)}).`);
    } catch (err) {
      setAvisoXml(err instanceof Error ? err.message : "No se pudo leer el XML.");
    }
  }

  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante={variante} tamano={tamano}>
          <Plus />
          Registrar comprobante
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Registrar comprobante de venta" descripcion="La boleta o factura que ya entregaste al cliente.">
        <form action={accion} className="flex flex-col gap-4">
          <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-control px-4 text-[15px] text-tinta-2 hover:bg-interna">
            <FileUp className="size-5" aria-hidden />
            Subir el XML de SUNAT (opcional, llena todo solo)
            <input type="file" accept=".xml,text/xml,application/xml" className="sr-only" onChange={(ev) => leerXml(ev.target.files?.[0])} />
          </label>
          {avisoXml ? <p className="rounded-2xl bg-interna px-4 py-3 text-sm">{avisoXml}</p> : null}
          <input type="hidden" name="origen" value={v.origen} />
          <input type="hidden" name="sin_igv" value={v.sin_igv} />
          <input type="hidden" name="igv" value={v.igv} />
          <div className="grid grid-cols-3 gap-3">
            <Campo etiqueta="Tipo">
              {(p) => (
                <Selector {...p} name="tipo" value={v.tipo} onChange={(ev) => cambiar("tipo", ev.target.value)}>
                  <option value="boleta">Boleta</option>
                  <option value="factura">Factura</option>
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Serie" error={e.serie}>
              {(p) => <Entrada {...p} name="serie" value={v.serie} onChange={(ev) => cambiar("serie", ev.target.value.toUpperCase())} placeholder="B001" className="uppercase" />}
            </Campo>
            <Campo etiqueta="Número" error={e.numero}>
              {(p) => <Entrada {...p} name="numero" inputMode="numeric" value={v.numero} onChange={(ev) => cambiar("numero", ev.target.value)} className="num" />}
            </Campo>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Fecha" error={e.fecha}>
              {(p) => <Entrada {...p} name="fecha" type="date" value={v.fecha} onChange={(ev) => cambiar("fecha", ev.target.value)} className="num" />}
            </Campo>
            <Campo etiqueta="Total con IGV" error={e.total}>
              {(p) => (
                <div className="relative">
                  <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
                  <Entrada {...p} name="total" type="number" step="0.01" inputMode="decimal" value={v.total} onChange={(ev) => setV((x) => ({ ...x, total: ev.target.value, origen: "manual", sin_igv: "", igv: "" }))} className="num pl-11" />
                </div>
              )}
            </Campo>
          </div>
          {ordenFija ? (
            <input type="hidden" name="orden" value={ordenFija} />
          ) : (
            <Campo etiqueta="Orden" ayuda="Si lo dejas sin orden, aparecerá una alerta hasta que lo asignes.">
              {(p) => (
                <Selector {...p} name="orden" defaultValue="">
                  <option value="">Sin orden por ahora</option>
                  {ordenes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.etiqueta}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
          )}
          <Campo etiqueta="DNI o RUC del cliente">{(p) => <Entrada {...p} name="documento" value={v.documento} onChange={(ev) => cambiar("documento", ev.target.value)} className="num" />}</Campo>
          <Campo etiqueta="Detalle" ayuda="Lo que dice el comprobante. Sirve para revisar que se cobraron los repuestos comprados.">
            {(p) => (
              <textarea
                {...p}
                name="detalle"
                rows={3}
                value={v.detalle}
                onChange={(ev) => cambiar("detalle", ev.target.value)}
                className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta"
              />
            )}
          </Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : "Registrar"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

export function AsignarOrden({ id, ordenes }: { id: string; ordenes: Opcion[] }) {
  const [pendiente, iniciar] = useTransition();
  const [r, setR] = useState<Resultado>({});
  return (
    <div className="min-w-0">
      <label className="sr-only" htmlFor={`asignar-${id}`}>
        Asignar a una orden
      </label>
      <Selector
        id={`asignar-${id}`}
        defaultValue=""
        disabled={pendiente}
        onChange={(ev) => {
          const valor = ev.target.value;
          if (valor) iniciar(async () => setR(await asignarOrdenComprobante(id, valor)));
        }}
        className="h-10 text-sm"
      >
        <option value="">Asignar a una orden…</option>
        {ordenes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.etiqueta}
          </option>
        ))}
      </Selector>
      {r.error ? <p className="mt-1 text-sm text-negativo">{r.error}</p> : null}
    </div>
  );
}
