"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Camera, Plus } from "lucide-react";
import { ElegirEntrega, type ValorEntrega } from "@/components/taller/elegir-entrega";
import { Boton } from "@/components/ui/boton";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { siguientesEstados, type EstadoOrden } from "@/lib/taller/estados";
import { reducirFoto } from "@/lib/taller/fotos";
import { subirFoto } from "../nueva/acciones";
import { agregarAvance, agregarServicio, anularOrden, guardarDiagnostico, asignarAsesor, asignarTecnico, cambiarEntrega, cambiarEstado, type Resultado } from "./acciones";

function Mensaje({ r }: { r: Resultado }) {
  if (r.error) return <p role="alert" className="mt-3 text-sm text-negativo">{r.error}</p>;
  if (r.ok) return <p role="status" className="mt-3 text-sm text-positivo">{r.ok}</p>;
  return null;
}

/** Estados en los que alguien ya está trabajando el carro: piden saber quién. */
const EMPIEZA: EstadoOrden[] = ["en_diagnostico", "en_proceso"];

export function BotonesEstado({ ordenId, estado, esTecnico, soloEntregar = false, sinTecnico = false }: { ordenId: string; estado: EstadoOrden; esTecnico: boolean; soloEntregar?: boolean; sinTecnico?: boolean }) {
  const [nota, setNota] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const pasos = siguientesEstados(estado, esTecnico).filter((p) => !soloEntregar || p.estado === "entregado");

  if (pasos.length === 0) {
    return <p className="text-[15px] text-tinta-2">{estado === "entregado" ? "Esta orden ya se entregó al cliente." : "No hay cambios disponibles."}</p>;
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {pasos.map((p, i) => (
          <Boton
            key={p.estado}
            type="button"
            variante={i === 0 ? "primario" : "secundario"}
            disabled={pendiente || (sinTecnico && EMPIEZA.includes(p.estado))}
            title={sinTecnico && EMPIEZA.includes(p.estado) ? "Primero elige quién lo trabaja" : undefined}
            onClick={() =>
              iniciar(async () => {
                const res = await cambiarEstado(ordenId, p.estado, nota);
                setR(res);
                if (res.ok) setNota("");
              })
            }
          >
            {p.texto}
          </Boton>
        ))}
      </div>
      {sinTecnico && pasos.some((p) => EMPIEZA.includes(p.estado)) ? <p className="mt-2 text-sm text-aviso">Para empezar, elige arriba quién lo trabaja.</p> : null}
      <Entrada
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota opcional: por ejemplo, qué repuesto falta"
        aria-label="Nota del cambio de estado"
        className="mt-3"
        maxLength={300}
      />
      <Mensaje r={r} />
    </div>
  );
}

/** Diagnóstico de la orden: se escribe aquí o se dicta por WhatsApp («ABC-123 diagnóstico: …»). */
export function FormDiagnostico({ ordenId, actual }: { ordenId: string; actual: string | null }) {
  const [editando, setEditando] = useState(!actual);
  const [texto, setTexto] = useState(actual ?? "");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  if (!editando) {
    return (
      <Boton type="button" variante="secundario" tamano="chico" className="mt-3" onClick={() => setEditando(true)}>
        Cambiar diagnóstico
      </Boton>
    );
  }
  return (
    <form
      className="mt-3"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const res = await guardarDiagnostico(ordenId, texto);
          setR(res);
          if (res.ok) setEditando(false);
        });
      }}
    >
      <label htmlFor="diagnostico" className="sr-only">
        Diagnóstico
      </label>
      <textarea
        id="diagnostico"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Ejemplo: Sincronizador de tercera gastado, hay que bajar la caja."
        className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta focus-visible:ring-4 focus-visible:ring-acento/15"
      />
      <div className="mt-2 flex justify-end">
        <Boton type="submit" disabled={pendiente || texto.trim().length < 3} className="w-full sm:w-auto">
          {pendiente ? "Guardando…" : "Guardar diagnóstico"}
        </Boton>
      </div>
      <Mensaje r={r} />
    </form>
  );
}

export function FormAvance({ ordenId }: { ordenId: string }) {
  const [texto, setTexto] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const res = await agregarAvance(ordenId, texto);
          setR(res);
          if (res.ok) setTexto("");
        });
      }}
    >
      <label htmlFor="avance" className="sr-only">
        Avance
      </label>
      <textarea
        id="avance"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={2}
        placeholder="Ejemplo: Bajé la caja, falta el kit de embrague."
        className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta focus-visible:ring-4 focus-visible:ring-acento/15"
      />
      <div className="mt-2 flex justify-end">
        <Boton type="submit" disabled={pendiente || texto.trim().length < 2} className="w-full sm:w-auto">
          {pendiente ? "Guardando…" : "Guardar avance"}
        </Boton>
      </div>
      <Mensaje r={r} />
    </form>
  );
}

export function AsignarTecnico({ ordenId, tecnicoId, tecnicos }: { ordenId: string; tecnicoId: string; tecnicos: { id: string; nombre: string }[] }) {
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <label htmlFor="tecnico" className="text-sm font-medium text-tinta-2">
        Lo trabaja
      </label>
      <Selector
        id="tecnico"
        defaultValue={tecnicoId}
        disabled={pendiente}
        onChange={(e) => {
          const valor = e.target.value;
          iniciar(async () => setR(await asignarTecnico(ordenId, valor)));
        }}
      >
        <option value="">Elige al técnico…</option>
        {tecnicos.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
      </Selector>
      {tecnicos.length === 0 ? <p className="mt-2 text-sm text-tinta-2">No hay personas con rol técnico. Agrégalas en Personal.</p> : null}
      <Mensaje r={r} />
    </div>
  );
}

/** Quién atiende la orden como asesor (define su comisión). Solo lo cambian gerencia y administración. */
export function AsignarAsesor({ ordenId, asesorId, asesores }: { ordenId: string; asesorId: string; asesores: { id: string; nombre: string }[] }) {
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <div className="flex flex-col gap-1.5 sm:max-w-sm">
      <label htmlFor="asesor" className="text-sm font-medium text-tinta-2">
        Asesor de la orden
      </label>
      <Selector
        id="asesor"
        defaultValue={asesorId}
        disabled={pendiente}
        onChange={(e) => {
          const valor = e.target.value;
          iniciar(async () => setR(await asignarAsesor(ordenId, valor)));
        }}
      >
        <option value="">Sin asesor</option>
        {asesores.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nombre}
          </option>
        ))}
      </Selector>
      <Mensaje r={r} />
    </div>
  );
}

export function AgregarServicio({ ordenId, sugerencias }: { ordenId: string; sugerencias: string[] }) {
  const [texto, setTexto] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <form
      className="mt-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const res = await agregarServicio(ordenId, texto, true);
          setR(res);
          if (res.ok) setTexto("");
        });
      }}
    >
      <div className="flex gap-2">
        <Entrada
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          list="sugerencias-servicio"
          placeholder="Agregar un trabajo adicional"
          aria-label="Trabajo adicional"
        />
        <datalist id="sugerencias-servicio">
          {sugerencias.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <Boton type="submit" variante="secundario" tamano="icono" disabled={pendiente || texto.trim().length < 2} aria-label="Agregar trabajo adicional">
          <Plus />
        </Boton>
      </div>
      <p className="mt-2 text-[13px] text-tinta-3">Para cobrarlo, arma una cotización adicional en Dinero y envíasela al cliente para que la apruebe.</p>
      <Mensaje r={r} />
    </form>
  );
}

export function SubirFotos({ ordenId, etapa }: { ordenId: string; etapa: "ingreso" | "proceso" | "entrega" }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<string>();
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();

  function subir(lista: FileList | null) {
    if (!lista?.length) return;
    const archivos = [...lista].filter((a) => a.type.startsWith("image/")).slice(0, 12);
    setError(undefined);
    iniciar(async () => {
      let fallidas = 0;
      for (const [i, a] of archivos.entries()) {
        setEstado(`Subiendo foto ${i + 1} de ${archivos.length}…`);
        try {
          const datos = new FormData();
          datos.set("foto", await reducirFoto(a));
          datos.set("etapa", etapa);
          const r = await subirFoto(ordenId, datos);
          if (r.error) fallidas += 1;
        } catch {
          fallidas += 1;
        }
      }
      setEstado(undefined);
      if (fallidas) setError(`${fallidas} ${fallidas === 1 ? "foto no se pudo subir" : "fotos no se pudieron subir"}. Intenta otra vez.`);
      if (entrada.current) entrada.current.value = "";
    });
  }

  return (
    <div className="mt-4">
      <input
        ref={entrada}
        id={`fotos-${ordenId}`}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="sr-only"
        onChange={(e) => subir(e.target.files)}
      />
      <Boton asChild variante="secundario" className={pendiente ? "pointer-events-none opacity-60" : undefined}>
        <label htmlFor={`fotos-${ordenId}`}>
          <Camera />
          {estado ?? "Agregar fotos"}
        </label>
      </Boton>
      {error ? <p role="alert" className="mt-2 text-sm text-negativo">{error}</p> : null}
    </div>
  );
}

/** Botón y ventana para poner o cambiar la hora prometida al cliente. */
export function CambiarEntrega({ ordenId, actual, ahora, cliente }: { ordenId: string; actual: { dia: string; hora: string } | null; ahora: string; cliente: string }) {
  const [abierta, setAbierta] = useState(false);
  const [valor, setValor] = useState<ValorEntrega>({ dia: actual?.dia ?? "", hora: actual?.hora ?? "", porDefinir: false });
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <Ventana
      open={abierta}
      onOpenChange={(a) => {
        setAbierta(a);
        if (a) {
          setValor({ dia: actual?.dia ?? "", hora: actual?.hora ?? "", porDefinir: false });
          setR({});
        }
      }}
    >
      <Boton type="button" variante="secundario" onClick={() => setAbierta(true)} className="mt-4 w-full sm:w-auto">
        {actual ? "Cambiar hora" : "Poner hora de entrega"}
      </Boton>
      <ContenidoVentana
        titulo={actual ? "Cambiar la hora de entrega" : "Hora de entrega"}
        descripcion={actual ? `Avísale a ${cliente} la nueva hora. El cambio queda anotado en la orden.` : `La que le prometes a ${cliente}.`}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            iniciar(async () => {
              const res = await cambiarEntrega(ordenId, valor);
              setR(res);
              if (res.ok) setAbierta(false);
            });
          }}
        >
          <ElegirEntrega
            valor={valor}
            onChange={(v) => {
              setValor(v);
              setR({});
            }}
            ahora={ahora}
            error={r.error}
          />
          <Boton type="submit" disabled={pendiente} className="mt-5 h-12 w-full">
            {pendiente ? "Guardando…" : "Guardar hora"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Anular la orden (no se borra): pide el motivo y avisa qué falta anular antes si hay dinero. */
export function AnularOrden({ ordenId }: { ordenId: string }) {
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [r, setR] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const router = useRouter();
  return (
    <Ventana open={abierta} onOpenChange={(v) => (setAbierta(v), setR({}))}>
      <DisparadorVentana asChild>
        <Boton variante="fantasma" tamano="chico" className="text-negativo [&_svg]:text-negativo">
          <Ban />
          Anular orden
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Anular orden" descripcion="La orden no se borra: queda anulada, fuera de las listas, con el motivo y quién la anuló. Si tiene pagos, recibo, boleta o repuestos del almacén, primero se anulan esos.">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            iniciar(async () => {
              const res = await anularOrden(ordenId, motivo);
              setR(res);
              if (res.ok) router.push("/ordenes");
            });
          }}
        >
          <Campo etiqueta="Motivo" ayuda="Por ejemplo: «Se registró por error», «El cliente no dejó el carro».">
            {(p) => <Entrada {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={5} maxLength={300} required autoComplete="off" />}
          </Campo>
          <Mensaje r={r} />
          <Boton type="submit" variante="peligro" disabled={pendiente || motivo.trim().length < 5} className="w-full">
            {pendiente ? "Anulando…" : "Anular orden"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}
