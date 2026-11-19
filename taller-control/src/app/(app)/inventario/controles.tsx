"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, PackageMinus, PackagePlus, Plus, SlidersHorizontal } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { cantidadTexto, normalizarCodigo, UNIDADES } from "@/lib/inventario";
import { cn } from "@/lib/utils";
import { crearRepuesto, editarRepuesto, registrarMovimiento, type Resultado } from "./acciones";

export type DatosRepuesto = {
  id?: string;
  codigo: string;
  nombre: string;
  marca: string | null;
  unidad: string;
  stockMinimo: number;
  precioConIgv: number | null;
  activo?: boolean;
};

function Aviso({ r }: { r: Resultado }) {
  if (r.ok) return <p role="status" className="rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">{r.ok}</p>;
  if (r.error) return <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{r.error}</p>;
  return null;
}

/** Campos de la ficha del repuesto (crear y editar). */
function CamposRepuesto({ d, e }: { d?: DatosRepuesto; e: Record<string, string> }) {
  const [codigo, setCodigo] = useState(d?.codigo ?? "");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
        <Campo etiqueta="Código" error={e.codigo} ayuda="El de la caja o uno tuyo.">
          {(p) => <Entrada {...p} name="codigo" value={codigo} onChange={(ev) => setCodigo(normalizarCodigo(ev.target.value))} placeholder="FIL-ACE-01" required autoCapitalize="characters" className="font-mono" />}
        </Campo>
        <Campo etiqueta="Nombre" error={e.nombre}>
          {(p) => <Entrada {...p} name="nombre" defaultValue={d?.nombre} placeholder="Filtro de aceite Toyota" required />}
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Marca" error={e.marca} ayuda="Opcional.">
          {(p) => <Entrada {...p} name="marca" defaultValue={d?.marca ?? ""} placeholder="Bosch" />}
        </Campo>
        <Campo etiqueta="Se cuenta por">
          {(p) => (
            <Selector {...p} name="unidad" defaultValue={d?.unidad ?? "unidad"}>
              {Object.entries(UNIDADES).map(([k, u]) => (
                <option key={k} value={k}>
                  {u.nombre}
                </option>
              ))}
            </Selector>
          )}
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Stock mínimo" error={e.minimo} ayuda="Avisa cuando quede esto o menos.">
          {(p) => <Entrada {...p} name="minimo" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={d?.stockMinimo ?? 0} className="num" />}
        </Campo>
        <Campo etiqueta="Precio al cliente" error={e.precio} ayuda="Con IGV. Opcional.">
          {(p) => (
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
              <Entrada {...p} name="precio" type="number" inputMode="decimal" min="0" step="0.01" defaultValue={d?.precioConIgv ?? ""} className="num pl-11" />
            </div>
          )}
        </Campo>
      </div>
    </>
  );
}

export function NuevoRepuesto() {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await crearRepuesto(previo, form);
    if (r.ok && r.id) {
      setAbierta(false);
      router.push(`/inventario/${r.id}?nuevo=1`);
    }
    return r;
  }, {});
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <Plus />
          Nuevo repuesto
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Nuevo repuesto" descripcion="Empieza con stock cero. El stock sube al registrar una compra o con «Entrada».">
        <form action={accion} className="flex flex-col gap-4">
          <CamposRepuesto e={estado.errores ?? {}} />
          <Aviso r={{ error: estado.error }} />
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Guardando…" : "Crear repuesto"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

export function EditarRepuesto({ d }: { d: DatosRepuesto }) {
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(editarRepuesto, {});
  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={d.id} />
      <CamposRepuesto d={d} e={estado.errores ?? {}} />
      <Campo etiqueta="¿Se sigue usando?">
        {(p) => (
          <Selector {...p} name="activo" defaultValue={d.activo === false ? "no" : "si"}>
            <option value="si">Sí, está activo</option>
            <option value="no">No, ya no se usa (se oculta de las listas)</option>
          </Selector>
        )}
      </Campo>
      <Aviso r={estado} />
      <Boton type="submit" variante="secundario" disabled={enviando} className="self-start">
        {enviando ? "Guardando…" : "Guardar cambios"}
      </Boton>
    </form>
  );
}

type Tipo = "salida" | "ajuste" | "entrada";

/**
 * Mover stock: entregar a una orden, ajustar por conteo o merma, o meter
 * mercadería que no vino por compra (devolución, saldo inicial).
 */
export function MoverStock({
  repuesto,
  ordenes,
  inicial = "salida",
  compacto = false,
}: {
  repuesto: { id: string; nombre: string; stock: number; unidad: string };
  ordenes: { id: string; etiqueta: string }[];
  inicial?: Tipo;
  compacto?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const [tipo, setTipo] = useState<Tipo>(inicial);
  const [sentido, setSentido] = useState<"suma" | "resta">("resta");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarMovimiento(previo, form);
    if (r.ok) setAbierta(false);
    return r;
  }, {});
  const e = estado.errores ?? {};
  const sinStock = repuesto.stock <= 0;
  return (
    <Ventana
      open={abierta}
      onOpenChange={(v) => {
        setAbierta(v);
        if (v) setTipo(sinStock && inicial === "salida" ? "entrada" : inicial);
      }}
    >
      <DisparadorVentana asChild>
        {compacto ? (
          <Boton variante="secundario" tamano="chico">
            <PackageMinus />
            Entregar
          </Boton>
        ) : (
          <Boton variante="secundario">
            <SlidersHorizontal />
            Mover stock
          </Boton>
        )}
      </DisparadorVentana>
      <ContenidoVentana titulo={repuesto.nombre} descripcion={`Hay ${cantidadTexto(repuesto.stock, repuesto.unidad)} en stock.`}>
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="repuesto" value={repuesto.id} />
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="sentido" value={tipo === "ajuste" ? sentido : "resta"} />
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["salida", "A una orden", PackageMinus],
                ["ajuste", "Ajuste", SlidersHorizontal],
                ["entrada", "Entrada", ArrowDownToLine],
              ] as const
            ).map(([v, t, Icono]) => (
              <button
                key={v}
                type="button"
                aria-pressed={tipo === v}
                onClick={() => setTipo(v)}
                className={cn("presionable flex min-h-12 cursor-pointer flex-col items-start gap-1 rounded-2xl border px-3 py-2.5 text-left text-[14px] font-medium", tipo === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
              >
                <Icono className="size-[18px]" aria-hidden />
                {t}
              </button>
            ))}
          </div>

          {tipo === "salida" ? (
            <Campo etiqueta="¿A qué orden?" error={e.orden} ayuda="Su costo pasa a la utilidad de esa orden.">
              {(p) => (
                <Selector {...p} name="orden" defaultValue="" required>
                  <option value="">Elige la orden…</option>
                  {ordenes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.etiqueta}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
          ) : null}

          {tipo === "ajuste" ? (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Sentido del ajuste">
              {(
                [
                  ["resta", "Sale del stock", "Merma, daño, uso del taller"],
                  ["suma", "Entra al stock", "El conteo dio más"],
                ] as const
              ).map(([v, t, d]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={sentido === v}
                  onClick={() => setSentido(v)}
                  className={cn("presionable cursor-pointer rounded-2xl border px-4 py-3 text-left", sentido === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
                >
                  <span className="block text-[15px] font-medium">{t}</span>
                  <span className="block text-[13px] text-tinta-2">{d}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className={cn("grid gap-3", tipo === "entrada" || (tipo === "ajuste" && sentido === "suma") ? "grid-cols-2" : "grid-cols-1")}>
            <Campo etiqueta="Cantidad" error={e.cantidad}>
              {(p) => <Entrada {...p} name="cantidad" type="number" inputMode="decimal" min="0.01" step="0.01" defaultValue="1" required className="num text-lg" />}
            </Campo>
            {tipo === "entrada" || (tipo === "ajuste" && sentido === "suma") ? (
              <Campo etiqueta="Costo c/u sin IGV" ayuda="Si lo dejas vacío, vale al costo promedio.">
                {(p) => (
                  <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-tinta-3">S/</span>
                    <Entrada {...p} name="costo" type="number" inputMode="decimal" min="0" step="0.01" className="num pl-11" />
                  </div>
                )}
              </Campo>
            ) : null}
          </div>

          <Campo etiqueta={tipo === "salida" ? "Nota" : "Motivo"} error={e.nota} ayuda={tipo === "salida" ? "Opcional." : "Obligatorio. Queda en el kardex."}>
            {(p) => (
              <Entrada
                {...p}
                name="nota"
                placeholder={tipo === "salida" ? "Ejemplo: cambio de aceite" : tipo === "entrada" ? "Ejemplo: saldo inicial del conteo" : "Ejemplo: conteo del sábado"}
                required={tipo !== "salida"}
              />
            )}
          </Campo>
          {tipo === "entrada" ? <p className="text-sm text-tinta-3">Lo que llega con factura se registra en Compras: entra solo al stock.</p> : null}
          <Aviso r={{ error: estado.error }} />
          <Boton type="submit" disabled={enviando} className="w-full">
            {tipo === "salida" ? <PackageMinus /> : <PackagePlus />}
            {enviando ? "Guardando…" : tipo === "salida" ? "Entregar a la orden" : tipo === "entrada" ? "Registrar entrada" : "Registrar ajuste"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Desde la orden: sacar un repuesto del inventario para este carro. */
export function SacarDelInventario({ ordenId, repuestos }: { ordenId: string; repuestos: { id: string; codigo: string; nombre: string; stock: number; unidad: string }[] }) {
  const [abierta, setAbierta] = useState(false);
  const [elegido, setElegido] = useState("");
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(async (previo, form) => {
    const r = await registrarMovimiento(previo, form);
    if (r.ok) {
      setAbierta(false);
      setElegido("");
    }
    return r;
  }, {});
  const rep = repuestos.find((r) => r.id === elegido);
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton variante="secundario" tamano="chico" disabled={repuestos.length === 0} title={repuestos.length ? undefined : "No hay repuestos con stock"}>
          <PackageMinus />
          Del inventario
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Sacar del inventario" descripcion="Baja del stock y su costo pasa a esta orden.">
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="tipo" value="salida" />
          <input type="hidden" name="sentido" value="resta" />
          <input type="hidden" name="orden" value={ordenId} />
          <Campo etiqueta="Repuesto" error={estado.errores?.repuesto}>
            {(p) => (
              <Selector {...p} name="repuesto" value={elegido} onChange={(ev) => setElegido(ev.target.value)} required>
                <option value="">Elige el repuesto…</option>
                {repuestos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.codigo} · {r.nombre} ({cantidadTexto(r.stock, r.unidad)})
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Cantidad" error={estado.errores?.cantidad} ayuda={rep ? `Hay ${cantidadTexto(rep.stock, rep.unidad)}.` : undefined}>
            {(p) => <Entrada {...p} name="cantidad" type="number" inputMode="decimal" min="0.01" step="0.01" max={rep?.stock} defaultValue="1" required className="num text-lg" />}
          </Campo>
          <input type="hidden" name="nota" value="" />
          <Aviso r={{ error: estado.error }} />
          <Boton type="submit" disabled={enviando || !elegido} className="w-full">
            <PackageMinus />
            {enviando ? "Guardando…" : "Sacar para esta orden"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}
