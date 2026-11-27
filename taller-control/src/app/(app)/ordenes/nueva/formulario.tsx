"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, Check, Plus, X } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { ElegirEntrega, type ValorEntrega } from "@/components/taller/elegir-entrega";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { validarPlaca } from "@/lib/placas";
import { CARROCERIAS, COMBUSTIBLES, DOCUMENTOS, NOMBRE_COMBUSTIBLE, ORIGENES_CLIENTE } from "@/lib/taller/estados";
import { cuandoEntrega, instanteLima } from "@/lib/taller/entrega";
import { reducirFoto } from "@/lib/taller/fotos";
import { cn } from "@/lib/utils";
import { buscarCelular, buscarPlaca, registrarIngreso, subirFoto, type ClienteConocido, type VehiculoConocido } from "./acciones";

type Props = {
  servicios: { id: string; nombre: string }[];
  tecnicos: { id: string; nombre: string }[];
  cita: { id: string; nombre: string; celular: string; servicio: string } | null;
  ahora: string;
};

type Foto = { clave: string; archivo: File; vista: string };

const NIVELES = [
  ["0", "Reserva"],
  ["25", "1/4"],
  ["50", "1/2"],
  ["75", "3/4"],
  ["100", "Lleno"],
] as const;

export function FormularioIngreso({ servicios, tecnicos, cita, ahora }: Props) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [progreso, setProgreso] = useState<string>();

  const [placa, setPlaca] = useState("");
  const [placaConfirmada, setPlacaConfirmada] = useState(false);
  const [conocido, setConocido] = useState<VehiculoConocido | null | undefined>(undefined);

  const [cliente, setCliente] = useState({
    nombre: cita?.nombre ?? "",
    celular: cita ? formatearCelular(cita.celular) : "",
    tipoDocumento: "ninguno",
    numeroDocumento: "",
    origen: cita ? "redes" : "otro",
    aceptaMensajes: false,
  });
  const [clienteConocido, setClienteConocido] = useState<ClienteConocido | null>(null);
  const [vehiculo, setVehiculo] = useState({ marca: "", modelo: "", anio: "", color: "", combustible: "", carroceria: "" });
  const [nivel, setNivel] = useState<string>("");
  const [kilometraje, setKilometraje] = useState("");
  const [elegidos, setElegidos] = useState<{ id: string | null; descripcion: string }[]>(() => {
    if (!cita) return [];
    const delCatalogo = servicios.find((s) => s.nombre.toLowerCase() === cita.servicio.toLowerCase());
    return [{ id: delCatalogo?.id ?? null, descripcion: delCatalogo?.nombre ?? cita.servicio }];
  });
  const [otro, setOtro] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [tecnicoId, setTecnicoId] = useState("");
  const [entrega, setEntrega] = useState<ValorEntrega>({ dia: "", hora: "", porDefinir: false });
  const [fotos, setFotos] = useState<Foto[]>([]);
  const entradaFotos = useRef<HTMLInputElement>(null);

  const resultadoPlaca = placa.trim() ? validarPlaca(placa) : null;

  useEffect(() => () => fotos.forEach((f) => URL.revokeObjectURL(f.vista)), [fotos]);

  function aplicarCliente(c: ClienteConocido) {
    setClienteConocido(c);
    setCliente({
      nombre: c.nombre,
      celular: formatearCelular(c.celular),
      tipoDocumento: c.tipoDocumento,
      numeroDocumento: c.numeroDocumento ?? "",
      origen: c.origen === "otro" ? "recurrente" : c.origen,
      aceptaMensajes: c.aceptaMensajes,
    });
  }

  async function revisarPlaca() {
    if (!resultadoPlaca || resultadoPlaca.estado === "invalida") {
      setConocido(undefined);
      return;
    }
    const v = await buscarPlaca(placa);
    setConocido(v);
    if (v) {
      setVehiculo({
        marca: v.marca ?? "",
        modelo: v.modelo ?? "",
        anio: v.anio ? String(v.anio) : "",
        color: v.color ?? "",
        combustible: v.combustible ?? "",
        carroceria: v.carroceria ?? "",
      });
      if (v.cliente && !cita) aplicarCliente(v.cliente);
    }
  }

  async function revisarCelular() {
    if (clienteConocido && formatearCelular(clienteConocido.celular) === cliente.celular) return;
    const c = await buscarCelular(cliente.celular);
    if (c) aplicarCliente(c);
    else setClienteConocido(null);
  }

  function alternarServicio(s: { id: string; nombre: string }) {
    setElegidos((previos) =>
      previos.some((e) => e.id === s.id) ? previos.filter((e) => e.id !== s.id) : [...previos, { id: s.id, descripcion: s.nombre }],
    );
  }

  function agregarOtro() {
    const texto = otro.trim();
    if (texto.length < 2) return;
    setElegidos((previos) => [...previos, { id: null, descripcion: texto }]);
    setOtro("");
  }

  function agregarFotos(lista: FileList | null) {
    if (!lista) return;
    const nuevas = [...lista]
      .filter((a) => a.type.startsWith("image/"))
      .map((archivo) => ({ clave: crypto.randomUUID(), archivo, vista: URL.createObjectURL(archivo) }));
    setFotos((previas) => [...previas, ...nuevas].slice(0, 12));
    if (entradaFotos.current) entradaFotos.current.value = "";
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    iniciar(async () => {
      const r = await registrarIngreso({
        placa,
        placaConfirmada,
        cliente,
        vehiculo,
        kilometraje,
        servicios: elegidos,
        observaciones,
        tecnicoId,
        citaId: cita?.id ?? "",
        entrega,
        combustible: nivel,
      });
      if (r.errores) {
        setErrores(r.errores);
        document.querySelector("[aria-invalid=true]")?.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      setErrores({});
      if (!r.ordenId) {
        setError(r.error ?? "No se pudo registrar el ingreso.");
        return;
      }
      const fallidas: string[] = [];
      for (const [i, f] of fotos.entries()) {
        setProgreso(`Subiendo foto ${i + 1} de ${fotos.length}…`);
        try {
          const reducida = await reducirFoto(f.archivo);
          const datos = new FormData();
          datos.set("foto", reducida);
          datos.set("etapa", "ingreso");
          const subida = await subirFoto(r.ordenId, datos);
          if (subida.error) fallidas.push(f.archivo.name);
        } catch {
          fallidas.push(f.archivo.name);
        }
      }
      router.push(`/ordenes/${r.ordenId}${fallidas.length ? `?fotos-fallidas=${fallidas.length}` : ""}`);
    });
  }

  const campoCliente = (clave: keyof typeof cliente, valor: string | boolean) => setCliente((c) => ({ ...c, [clave]: valor }));
  const campoVehiculo = (clave: keyof typeof vehiculo, valor: string) => setVehiculo((v) => ({ ...v, [clave]: valor }));

  return (
    <form onSubmit={enviar} className="grid min-w-0 gap-4 xl:grid-cols-12" noValidate>
      <div className="flex min-w-0 flex-col gap-4 xl:col-span-7">
        {/* 1. Placa */}
        <Tarjeta aria-labelledby="t-placa">
          <CabeceraTarjeta id="t-placa" titulo="Placa" detalle={cita ? `Viene por la cita de ${cita.nombre}` : undefined} />
          <Campo etiqueta="Placa del carro" error={errores.placa} ayuda="Con o sin guion: ABC-123.">
            {(p) => (
              <Entrada
                {...p}
                value={placa}
                onChange={(e) => {
                  setPlaca(e.target.value.toUpperCase());
                  setPlacaConfirmada(false);
                  setConocido(undefined);
                }}
                onBlur={revisarPlaca}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="ABC-123"
                className="h-14 text-[20px] font-semibold tracking-[0.08em] uppercase"
              />
            )}
          </Campo>
          {resultadoPlaca?.estado === "revisar" ? (
            <label className="mt-3 flex cursor-pointer items-center gap-3 rounded-2xl bg-aviso-fondo px-4 py-3 text-sm text-aviso">
              <input type="checkbox" checked={placaConfirmada} onChange={(e) => setPlacaConfirmada(e.target.checked)} className="size-5 accent-[var(--acento)]" />
              No tiene el formato de siempre (ABC-123). Marca aquí si es correcta (moto, placa antigua o extranjera).
            </label>
          ) : null}
          {conocido ? (
            <p className="mt-3 flex items-center gap-2 rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">
              <Check className="size-4 shrink-0" aria-hidden />
              Este carro ya vino antes{conocido.cliente ? `: es de ${conocido.cliente.nombre}` : ""}. Revisa que los datos sigan bien.
            </p>
          ) : conocido === null ? (
            <p className="mt-3 text-sm text-tinta-2">Carro nuevo en el taller. Completa sus datos abajo.</p>
          ) : null}
        </Tarjeta>

        {/* 2. Cliente */}
        <Tarjeta aria-labelledby="t-cliente">
          <CabeceraTarjeta id="t-cliente" titulo="Cliente" detalle={clienteConocido ? "Cliente que ya conocemos" : "El celular lo identifica"} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="Celular" error={errores["cliente.celular"]}>
              {(p) => (
                <Entrada
                  {...p}
                  type="tel"
                  inputMode="tel"
                  placeholder="987 654 321"
                  value={cliente.celular}
                  onChange={(e) => campoCliente("celular", e.target.value)}
                  onBlur={revisarCelular}
                />
              )}
            </Campo>
            <Campo etiqueta="Nombre y apellido" error={errores["cliente.nombre"]}>
              {(p) => <Entrada {...p} value={cliente.nombre} onChange={(e) => campoCliente("nombre", e.target.value)} autoComplete="off" />}
            </Campo>
            <Campo etiqueta="Documento">
              {(p) => (
                <Selector {...p} value={cliente.tipoDocumento} onChange={(e) => campoCliente("tipoDocumento", e.target.value)}>
                  {Object.entries(DOCUMENTOS).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            {cliente.tipoDocumento !== "ninguno" ? (
              <Campo etiqueta="Número de documento" error={errores["cliente.numeroDocumento"]}>
                {(p) => (
                  <Entrada
                    {...p}
                    inputMode={cliente.tipoDocumento === "ce" ? "text" : "numeric"}
                    value={cliente.numeroDocumento}
                    onChange={(e) => campoCliente("numeroDocumento", e.target.value.toUpperCase())}
                    className="num"
                  />
                )}
              </Campo>
            ) : (
              <span className="hidden sm:block" />
            )}
            <Campo etiqueta="¿Cómo llegó?">
              {(p) => (
                <Selector {...p} value={cliente.origen} onChange={(e) => campoCliente("origen", e.target.value)}>
                  {Object.entries(ORIGENES_CLIENTE).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            <label className="flex cursor-pointer items-center gap-3 self-end rounded-2xl bg-interna px-4 py-3 text-[15px] sm:h-12">
              <input
                type="checkbox"
                checked={cliente.aceptaMensajes}
                onChange={(e) => campoCliente("aceptaMensajes", e.target.checked)}
                className="size-5 shrink-0 accent-[var(--acento)]"
              />
              Acepta recibir mensajes del taller
            </label>
          </div>
        </Tarjeta>

        {/* 3. Carro */}
        <Tarjeta aria-labelledby="t-carro">
          <CabeceraTarjeta id="t-carro" titulo="Carro" detalle="Lo que sepas; se puede completar después" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Campo etiqueta="Marca">{(p) => <Entrada {...p} value={vehiculo.marca} onChange={(e) => campoVehiculo("marca", e.target.value)} placeholder="Toyota" />}</Campo>
            <Campo etiqueta="Modelo">{(p) => <Entrada {...p} value={vehiculo.modelo} onChange={(e) => campoVehiculo("modelo", e.target.value)} placeholder="Yaris" />}</Campo>
            <Campo etiqueta="Año" error={errores["vehiculo.anio"]}>
              {(p) => <Entrada {...p} inputMode="numeric" value={vehiculo.anio} onChange={(e) => campoVehiculo("anio", e.target.value)} className="num" placeholder="2018" />}
            </Campo>
            <Campo etiqueta="Color">{(p) => <Entrada {...p} value={vehiculo.color} onChange={(e) => campoVehiculo("color", e.target.value)} />}</Campo>
            <Campo etiqueta="Combustible">
              {(p) => (
                <Selector {...p} value={vehiculo.combustible} onChange={(e) => campoVehiculo("combustible", e.target.value)}>
                  <option value="">Sin dato</option>
                  {Object.entries(COMBUSTIBLES).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                  {/* Un carro antiguo guardado como «Dual» lo conserva hasta que lo cambien. */}
                  {vehiculo.combustible === "dual" ? <option value="dual">{NOMBRE_COMBUSTIBLE.dual}</option> : null}
                </Selector>
              )}
            </Campo>
            <Campo etiqueta="Carrocería">
              {(p) => (
                <Selector {...p} value={vehiculo.carroceria} onChange={(e) => campoVehiculo("carroceria", e.target.value)}>
                  <option value="">Sin dato</option>
                  {Object.entries(CARROCERIAS).map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
            <Campo
              etiqueta="Kilometraje de ingreso"
              error={errores.kilometraje}
              ayuda={conocido?.kilometraje ? `La vez pasada: ${conocido.kilometraje.toLocaleString("es-PE")} km` : undefined}
              className="col-span-2 lg:col-span-3"
            >
              {(p) => (
                <div className="relative">
                  <Entrada {...p} inputMode="numeric" value={kilometraje} onChange={(e) => setKilometraje(e.target.value.replace(/\D/g, ""))} className="num pr-14" />
                  <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-sm text-tinta-3">km</span>
                </div>
              )}
            </Campo>
          </div>
        </Tarjeta>

        {/* 3b. Al recibir el carro: va justo debajo del kilometraje */}
        <Tarjeta aria-labelledby="t-obs">
          <CabeceraTarjeta id="t-obs" titulo="Al recibir el carro" />
          <div className="flex flex-col gap-4">
            <Campo etiqueta="Observaciones" ayuda="Golpes, ruidos, lo que dijo el cliente, nivel de gasolina…">
              {(p) => (
                <textarea
                  {...p}
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={3}
                  className="w-full rounded-2xl border border-borde bg-tarjeta px-4 py-3 text-[15px] outline-none focus-visible:border-tinta focus-visible:ring-4 focus-visible:ring-acento/15"
                />
              )}
            </Campo>
            <div role="group" aria-labelledby="t-combustible" className="flex flex-col gap-2">
              <span id="t-combustible" className="text-sm font-medium text-tinta">
                Nivel de combustible
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {NIVELES.map(([valor, texto]) => (
                  <button
                    key={valor}
                    type="button"
                    aria-pressed={nivel === valor}
                    onClick={() => setNivel(nivel === valor ? "" : valor)}
                    className={cn(
                      "presionable min-h-11 cursor-pointer rounded-xl border px-1 text-[13px] sm:text-[14px]",
                      nivel === valor ? "border-primario bg-primario text-primario-tinta" : "border-borde bg-tarjeta hover:bg-interna",
                    )}
                  >
                    {texto}
                  </button>
                ))}
              </div>
            </div>
            <Campo etiqueta="Técnico responsable">
              {(p) => (
                <Selector {...p} value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
                  <option value="">Asignar después</option>
                  {tecnicos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </Selector>
              )}
            </Campo>
          </div>
        </Tarjeta>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:col-span-5">
        {/* 4. Servicios */}
        <Tarjeta aria-labelledby="t-servicios">
          <CabeceraTarjeta id="t-servicios" titulo="Servicio a realizar" detalle="Toca uno o varios" />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Servicios del taller">
            {servicios.map((s) => {
              const activo = elegidos.some((e) => e.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => alternarServicio(s)}
                  className={cn(
                    "presionable inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-4 text-[14px]",
                    activo ? "border-primario bg-primario text-primario-tinta" : "border-borde bg-tarjeta hover:bg-interna",
                  )}
                >
                  {activo ? <Check className="size-4" aria-hidden /> : null}
                  {s.nombre}
                </button>
              );
            })}
          </div>
          {elegidos.filter((e) => e.id === null).length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {elegidos
                .filter((e) => e.id === null)
                .map((e) => (
                  <li key={e.descripcion} className="inline-flex min-h-11 items-center gap-1 rounded-full bg-primario pr-1 pl-4 text-[14px] text-primario-tinta">
                    {e.descripcion}
                    <button
                      type="button"
                      onClick={() => setElegidos((p) => p.filter((x) => x !== e))}
                      className="grid size-9 cursor-pointer place-items-center rounded-full"
                      aria-label={`Quitar ${e.descripcion}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Entrada
              value={otro}
              onChange={(e) => setOtro(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregarOtro();
                }
              }}
              placeholder="Otro servicio"
              aria-label="Otro servicio"
            />
            <Boton type="button" variante="secundario" tamano="icono" onClick={agregarOtro} aria-label="Agregar servicio">
              <Plus />
            </Boton>
          </div>
          {errores.servicios ? <p className="mt-2 text-sm text-negativo">{errores.servicios}</p> : null}
        </Tarjeta>

        {/* 5. Entrega prometida */}
        <Tarjeta aria-labelledby="t-entrega">
          <CabeceraTarjeta id="t-entrega" titulo="¿Cuándo se lo entregas?" detalle="El día y la hora que le prometes al cliente" />
          <ElegirEntrega
            valor={entrega}
            onChange={(v) => {
              setEntrega(v);
              if (errores.entrega)
                setErrores((previos) => {
                  const resto = { ...previos };
                  delete resto.entrega;
                  return resto;
                });
            }}
            ahora={ahora}
            error={errores.entrega}
          />
        </Tarjeta>

        {/* 7. Fotos */}
        <Tarjeta aria-labelledby="t-fotos">
          <CabeceraTarjeta id="t-fotos" titulo="Fotos del ingreso" detalle="Opcional. Puedes agregarlas después desde la orden" />
          <input
            ref={entradaFotos}
            id="fotos-ingreso"
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="sr-only"
            onChange={(e) => agregarFotos(e.target.files)}
          />
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {fotos.map((f) => (
              <li key={f.clave} className="relative aspect-square overflow-hidden rounded-xl bg-interna">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.vista} alt="Foto del ingreso" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => setFotos((p) => p.filter((x) => x.clave !== f.clave))}
                  className="absolute top-1 right-1 grid size-8 cursor-pointer place-items-center rounded-full bg-black/60 text-white"
                  aria-label="Quitar foto"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
            <li>
              <label
                htmlFor="fotos-ingreso"
                className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-control text-[13px] text-tinta-2 hover:bg-interna"
              >
                <Camera className="size-6" aria-hidden />
                Tomar foto
              </label>
            </li>
          </ul>
        </Tarjeta>

        {resultadoPlaca && resultadoPlaca.estado !== "invalida" ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-tinta-2">
            Vas a registrar <Placa placa={resultadoPlaca.placa} /> con {elegidos.length} {elegidos.length === 1 ? "servicio" : "servicios"} y {fotos.length}{" "}
            {fotos.length === 1 ? "foto" : "fotos"}
            {instanteLima(entrega.dia, entrega.hora) ? `, para entregar ${cuandoEntrega(instanteLima(entrega.dia, entrega.hora)!, new Date(ahora)).replace(/\.$/, "")}` : ""}.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
            {error}
          </p>
        ) : null}
        <Boton type="submit" disabled={enviando} className="h-14 w-full text-[16px]">
          {enviando ? (progreso ?? "Registrando…") : "Registrar ingreso"}
        </Boton>
      </div>
    </form>
  );
}
