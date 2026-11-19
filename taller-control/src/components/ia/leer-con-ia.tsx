"use client";

import { useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { ComprobanteLeido } from "@/lib/ia/esquemas";
import { leerDocumentoConIa } from "@/lib/ia/acciones";
import { reducirFoto } from "@/lib/taller/fotos";

/**
 * Botón para subir la foto o el PDF de un comprobante y leerlo con IA.
 * La foto se reduce en el celular antes de subirla (más rápido y barato).
 */
export function LeerConIa({ pista, onLeido }: { pista: "compra" | "venta"; onLeido: (datos: ComprobanteLeido, archivo?: string) => void }) {
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string>();

  async function leer(archivo: File | undefined) {
    if (!archivo) return;
    setError(undefined);
    setLeyendo(true);
    try {
      const listo = archivo.type.startsWith("image/") ? await reducirFoto(archivo, 2000, 0.85) : archivo;
      const form = new FormData();
      form.set("pista", pista);
      form.set("archivo", listo);
      const r = await leerDocumentoConIa(form);
      if (r.error || !r.datos) setError(r.error ?? "No se pudo leer.");
      else onLeido(r.datos, r.archivo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    } finally {
      setLeyendo(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        aria-busy={leyendo}
        className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-control px-4 text-center text-[15px] text-tinta-2 hover:bg-interna aria-busy:cursor-wait aria-busy:opacity-70"
      >
        {leyendo ? <LoaderCircle className="size-5 shrink-0 animate-spin" aria-hidden /> : <Sparkles className="size-5 shrink-0" aria-hidden />}
        {leyendo ? "Leyendo el comprobante…" : "Foto o PDF del comprobante: leer con IA"}
        <input type="file" accept="image/*,application/pdf" disabled={leyendo} className="sr-only" onChange={(ev) => leer(ev.target.files?.[0])} />
      </label>
      {error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{error}</p> : null}
    </div>
  );
}

/** Aviso que acompaña a todo lo leído por IA. */
export function avisoIa(d: ComprobanteLeido, sumaLineas?: number): string {
  const partes = ["Leído por IA: revisa cada dato y monto. Al guardarlo quedará «por confirmar» hasta que alguien lo apruebe."];
  if (d.legible === "con_dudas") partes.push(d.dudas ? `Dudas de la lectura: ${d.dudas}` : "Hay datos que no se leyeron bien.");
  // Las líneas de una factura suelen ir sin IGV; las de una boleta, con IGV.
  const referencia = d.precios_incluyen_igv ? d.total : (d.subtotal_sin_igv ?? d.total);
  if (referencia !== null && sumaLineas !== undefined && d.lineas.length > 0 && Math.abs(referencia - sumaLineas) > 0.05) {
    partes.push(`Ojo: las líneas suman ${sumaLineas.toFixed(2)} y el comprobante dice ${referencia.toFixed(2)}${d.precios_incluyen_igv ? "" : " sin IGV"}.`);
  }
  return partes.join(" ");
}
