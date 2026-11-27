"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { DOCUMENTOS, ORIGENES_CLIENTE } from "@/lib/taller/estados";
import { guardarCliente, type Resultado } from "@/app/(app)/clientes/acciones";

export type ValoresCliente = {
  id: string;
  nombre: string;
  celular: string;
  tipoDocumento: string;
  numeroDocumento: string | null;
  origen: string;
  aceptaMensajes: boolean;
  notas: string | null;
};

/** Ventana para crear un cliente (sin valores) o editarlo (con valores). */
export function VentanaCliente({ valores }: { valores?: ValoresCliente }) {
  const [abierta, setAbierta] = useState(false);
  const router = useRouter();
  const [estado, enviar, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await guardarCliente(valores?.id ?? null, previo, form);
    if (r.ok && r.id) {
      if (valores) {
        setAbierta(false);
        router.refresh();
      } else {
        router.push(`/clientes/${r.id}`);
      }
    }
    return r;
  }, {});
  const [tipo, setTipo] = useState(valores?.tipoDocumento ?? "ninguno");
  const e = estado.errores ?? {};

  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        {valores ? (
          <Boton variante="secundario">
            <Pencil />
            Editar
          </Boton>
        ) : (
          <Boton>
            <Plus />
            Nuevo cliente
          </Boton>
        )}
      </DisparadorVentana>
      <ContenidoVentana titulo={valores ? "Editar cliente" : "Nuevo cliente"} descripcion="El celular identifica al cliente en este taller.">
        <form action={enviar} className="flex flex-col gap-4">
          <Campo etiqueta="Nombre y apellido" error={e.nombre}>
            {(p) => <Entrada {...p} name="nombre" defaultValue={valores?.nombre} required />}
          </Campo>
          <Campo etiqueta="Celular" error={e.celular}>
            {(p) => <Entrada {...p} name="celular" type="tel" inputMode="tel" defaultValue={valores?.celular} placeholder="987 654 321" required />}
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Documento">
              {(p) => (
                <Selector {...p} name="tipo_documento" value={tipo} onChange={(ev) => setTipo(ev.target.value)}>
                  {Object.entries(DOCUMENTOS).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Número" error={e.numero_documento}>
              {(p) => <Entrada {...p} name="numero_documento" defaultValue={valores?.numeroDocumento ?? ""} disabled={tipo === "ninguno"} className="num" />}
            </Campo>
          </div>
          <Campo etiqueta="¿Cómo llegó?">
            {(p) => (
              <Selector {...p} name="origen" defaultValue={valores?.origen ?? "otro"}>
                {Object.entries(ORIGENES_CLIENTE).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl bg-interna px-4 py-3 text-[15px]">
            <input type="checkbox" name="acepta_mensajes" defaultChecked={valores?.aceptaMensajes} className="size-5 shrink-0 accent-[var(--acento)]" />
            Acepta recibir mensajes del taller (recordatorios, aviso de carro listo)
          </label>
          <Campo etiqueta="Notas" error={e.notas}>
            {(p) => (
              <textarea
                {...p}
                name="notas"
                defaultValue={valores?.notas ?? ""}
                rows={2}
                className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta"
              />
            )}
          </Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : "Guardar"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}
