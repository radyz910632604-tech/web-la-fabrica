"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { CalendarPlus, Ellipsis } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { ContenidoMenu, DisparadorMenu, Menu, OpcionMenu } from "@/components/ui/menu";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { REDES } from "@/lib/taller/estados";
import { agendarCita, cancelarCita, confirmarCita, reagendarCita, type Resultado } from "./acciones";

export function AgendarCita({
  hoy,
  servicios,
  vendedores,
  elegirVendedor,
  abrir = false,
}: {
  abrir?: boolean;
  hoy: string;
  servicios: string[];
  vendedores: { id: string; nombre: string }[];
  elegirVendedor: boolean;
}) {
  const [abierta, setAbierta] = useState(abrir);
  const [estado, accion, enviando] = useActionState<Resultado, FormData>(agendarCita, {});
  const e = estado.errores ?? {};
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <CalendarPlus />
          Agendar cita
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Agendar cita" descripcion="Si llega ese día, se une sola con su ingreso.">
        <form action={accion} className="flex flex-col gap-4">
          <Campo etiqueta="Nombre del cliente" error={e.nombre}>
            {(p) => <Entrada {...p} name="nombre" required />}
          </Campo>
          <Campo etiqueta="Celular" error={e.celular}>
            {(p) => <Entrada {...p} name="celular" type="tel" inputMode="tel" placeholder="987 654 321" required />}
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Fecha" error={e.fecha}>
              {(p) => <Entrada {...p} name="fecha" type="date" defaultValue={hoy} min={hoy} required className="num" />}
            </Campo>
            <Campo etiqueta="Hora" error={e.hora}>
              {(p) => <Entrada {...p} name="hora" type="time" defaultValue="09:00" step={900} required className="num" />}
            </Campo>
          </div>
          <Campo etiqueta="Servicio" error={e.servicio}>
            {(p) => (
              <>
                <Entrada {...p} name="servicio" list="servicios-cita" placeholder="Cambio de aceite y filtro" required />
                <datalist id="servicios-cita">
                  {servicios.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Red de origen" error={e.red}>
              {(p) => (
                <Selector {...p} name="red" defaultValue="facebook">
                  {Object.entries(REDES).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Campaña" error={e.campana}>
              {(p) => <Entrada {...p} name="campana" placeholder="Opcional" />}
            </Campo>
          </div>
          {elegirVendedor ? (
            <Campo etiqueta="Vendedor">
              {(p) => (
                <Selector {...p} name="vendedor" defaultValue="">
                  <option value="">Sin vendedor</option>
                  {vendedores.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.nombre}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
          ) : (
            <input type="hidden" name="vendedor" value="" />
          )}
          <Campo etiqueta="Notas" error={e.notas}>
            {(p) => <Entrada {...p} name="notas" placeholder="Opcional" />}
          </Campo>
          {estado.error ? <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">{estado.error}</p> : null}
          {estado.ok ? <p role="status" className="rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">{estado.ok}</p> : null}
          <Boton type="submit" disabled={enviando} className="w-full">
            {enviando ? "Agendando…" : "Agendar"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

export function AccionesCita({
  id,
  estado,
  ordenId,
  puedeConfirmar,
  puedeEditar,
  puedeIngresar,
  hoy,
}: {
  id: string;
  estado: string;
  ordenId: string | null;
  puedeConfirmar: boolean;
  puedeEditar: boolean;
  puedeIngresar: boolean;
  hoy: string;
}) {
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const [reagendar, setReagendar] = useState(false);
  const [fecha, setFecha] = useState(hoy);
  const [hora, setHora] = useState("09:00");
  const abierta = ["agendada", "confirmada", "no_llego"].includes(estado);

  return (
    <div className="flex items-center justify-end gap-2">
      {ordenId ? (
        <Boton asChild variante="secundario" tamano="chico">
          <Link href={`/ordenes/${ordenId}`}>Ver orden</Link>
        </Boton>
      ) : null}
      {estado === "agendada" && puedeConfirmar ? (
        <Boton tamano="chico" disabled={pendiente} onClick={() => iniciar(async () => setR(await confirmarCita(id)))}>
          Confirmar
        </Boton>
      ) : null}
      {abierta && puedeIngresar && estado !== "agendada" ? (
        <Boton asChild tamano="chico">
          <Link href={`/ordenes/nueva?cita=${id}`}>Llegó: registrar</Link>
        </Boton>
      ) : null}
      {abierta && (puedeEditar || puedeIngresar) ? (
        <Menu>
          <DisparadorMenu asChild>
            <button type="button" className="presionable grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna" aria-label="Más opciones de la cita">
              <Ellipsis className="size-5" />
            </button>
          </DisparadorMenu>
          <ContenidoMenu align="end">
            {puedeIngresar ? (
              <OpcionMenu asChild>
                <Link href={`/ordenes/nueva?cita=${id}`}>Llegó: registrar ingreso</Link>
              </OpcionMenu>
            ) : null}
            {puedeEditar ? <OpcionMenu onSelect={() => setReagendar(true)}>Reagendar</OpcionMenu> : null}
            {puedeEditar ? (
              <OpcionMenu className="text-negativo" onSelect={() => iniciar(async () => setR(await cancelarCita(id)))}>
                Cancelar cita
              </OpcionMenu>
            ) : null}
          </ContenidoMenu>
        </Menu>
      ) : null}
      <Ventana open={reagendar} onOpenChange={setReagendar}>
        <ContenidoVentana titulo="Reagendar cita" descripcion="La cita de hoy queda como reagendada y se crea la nueva.">
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Nueva fecha">{(p) => <Entrada {...p} type="date" value={fecha} min={hoy} onChange={(e) => setFecha(e.target.value)} className="num" />}</Campo>
            <Campo etiqueta="Hora">{(p) => <Entrada {...p} type="time" value={hora} step={900} onChange={(e) => setHora(e.target.value)} className="num" />}</Campo>
          </div>
          {r.error ? <p role="alert" className="mt-3 text-sm text-negativo">{r.error}</p> : null}
          <Boton
            className="mt-4 w-full"
            disabled={pendiente}
            onClick={() =>
              iniciar(async () => {
                const res = await reagendarCita(id, fecha, hora);
                setR(res);
                if (res.ok) setReagendar(false);
              })
            }
          >
            Reagendar
          </Boton>
        </ContenidoVentana>
      </Ventana>
      {r.error && !reagendar ? (
        <span role="alert" className="text-sm text-negativo">
          {r.error}
        </span>
      ) : null}
    </div>
  );
}
