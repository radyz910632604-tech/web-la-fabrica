"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy, Crown, MessageCircle, Pencil, Plus, UserRoundCheck, UserRoundX, UsersRound } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { Casilla } from "@/components/ui/casilla";
import { Tarjeta } from "@/components/ui/tarjeta";
import { ContenidoVentana, DisparadorVentana, Ventana } from "@/components/ui/ventana";
import { iniciales } from "@/lib/formato";
import { NOMBRE_ROL, type Rol } from "@/lib/roles";
import { REGLA_USUARIO, sugerirUsuario } from "@/lib/usuarios";
import { cn } from "@/lib/utils";
import { agregarPersona, cambiarAcceso, cambiarPago, cambiarRoles, darDeBaja, editarDatos, reactivar, type Acceso, type Resultado } from "./acciones";

export type Persona = {
  id: string;
  nombre: string;
  usuario: string | null;
  celular: string;
  documento: string | null;
  cargo: string | null;
  fechaIngreso: string | null;
  activo: boolean;
  dueno: boolean;
  bajaEn: string | null;
  bajaMotivo: string | null;
  roles: Rol[];
  /** Pago vigente y sus versiones anteriores (solo si quien mira es gestor). */
  pago?: Pago | null;
  historialPago?: Pago[];
};

export type Pago = { tipo: "fijo" | "destajo"; monto: number; frecuencia: string; comision: number | null; desde: string; hasta: string | null; motivo: string | null };

const fechaLarga = (f: string) => new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(f));

function Mensaje({ resultado }: { resultado: Resultado }) {
  if (resultado.error) {
    return (
      <p role="alert" className="rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
        {resultado.error}
      </p>
    );
  }
  if (resultado.ok) {
    return (
      <p role="status" className="rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo">
        {resultado.ok}
      </p>
    );
  }
  return null;
}

/** El texto que recibe la persona con su usuario y contraseña. */
function textoAcceso(a: Acceso) {
  const web = typeof window === "undefined" ? "" : `${window.location.origin}/ingresar`;
  return [
    `Hola ${a.nombre.split(" ")[0]}, ya tienes acceso a Taller Control.`,
    web ? `Entra aquí: ${web}` : null,
    `Usuario: ${a.usuario}`,
    a.clave ? `Contraseña: ${a.clave}` : "Tu contraseña sigue siendo la misma.",
    a.clave ? "La primera vez que entres te pedirá poner tu propia contraseña." : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tarjeta para mandar el acceso por WhatsApp (abre el chat con el mensaje listo) o copiarlo. */
function CompartirAcceso({ acceso }: { acceso: Acceso }) {
  const [copiado, setCopiado] = useState(false);
  const texto = textoAcceso(acceso);
  const digitos = acceso.celular.replace(/\D/g, "");
  const numero = digitos.length === 9 ? `51${digitos}` : digitos;
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-positivo-fondo px-4 py-3.5">
      <p className="text-sm font-medium text-positivo">Listo. Envíale sus datos para entrar:</p>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
        <dt className="text-tinta-2">Usuario</dt>
        <dd className="num font-medium break-all">{acceso.usuario}</dd>
        <dt className="text-tinta-2">Contraseña</dt>
        <dd className="num font-medium break-all">{acceso.clave ?? "La misma de antes"}</dd>
      </dl>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Boton asChild className="w-full">
          <a href={`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">
            <MessageCircle />
            Enviar por WhatsApp
          </a>
        </Boton>
        <Boton
          type="button"
          variante="secundario"
          className="w-full"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(texto);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2000);
            } catch {
              window.prompt("Copia este mensaje:", texto);
            }
          }}
        >
          {copiado ? <Check /> : <Copy />}
          {copiado ? "Copiado" : "Copiar mensaje"}
        </Boton>
      </div>
    </div>
  );
}

const FRECUENCIAS = [
  ["semanal", "Semanal"],
  ["quincenal", "Quincenal"],
  ["mensual", "Mensual"],
] as const;
const NOMBRE_FRECUENCIA: Record<string, string> = { semanal: "por semana", quincenal: "por quincena", mensual: "al mes" };

function Subtitulo({ children }: { children: React.ReactNode }) {
  return <h3 className="border-t border-regla pt-4 text-[13px] font-semibold tracking-wide text-tinta-2 uppercase first:border-t-0 first:pt-0">{children}</h3>;
}

/** Campos del pago: fijo o destajo, monto, cada cuánto y (solo asesor) la comisión por orden. */
function CamposPago({ rol, errores, valores }: { rol: string; errores: Record<string, string>; valores?: Pago | null }) {
  const [tipo, setTipo] = useState<"fijo" | "destajo">(valores?.tipo ?? "fijo");
  return (
    <>
      <input type="hidden" name="tipoPago" value={tipo} />
      <input type="hidden" name="tipo" value={tipo} />
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Cómo se le paga">
        {(
          [
            ["fijo", "Sueldo fijo", "Un monto cada periodo"],
            ["destajo", "A destajo", "Por cada trabajo"],
          ] as const
        ).map(([v, t, d]) => (
          <button
            key={v}
            type="button"
            aria-pressed={tipo === v}
            onClick={() => setTipo(v)}
            className={cn("presionable cursor-pointer rounded-2xl border px-4 py-2.5 text-left", tipo === v ? "border-primario ring-2 ring-primario/15" : "border-borde hover:bg-interna")}
          >
            <span className="block text-[15px] font-medium">{t}</span>
            <span className="block text-[13px] text-tinta-2">{d}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta={tipo === "fijo" ? "Sueldo por periodo (S/)" : "Tarifa por trabajo (S/)"} error={errores.monto}>
          {(p) => <Entrada {...p} name="monto" type="number" min="0" step="0.01" inputMode="decimal" defaultValue={valores?.monto ?? ""} className="num" required />}
        </Campo>
        <Campo etiqueta="Se le paga" error={errores.frecuencia}>
          {(p) => (
            <Selector {...p} name="frecuencia" defaultValue={valores?.frecuencia ?? "quincenal"}>
              {FRECUENCIAS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </Selector>
          )}
        </Campo>
      </div>
      {rol === "asesor" ? (
        <Campo etiqueta="Comisión por orden entregada y cobrada (%)" ayuda="Opcional. Si la dejas vacía, se usan las reglas de Configuración." error={errores.comision}>
          {(p) => <Entrada {...p} name="comision" type="number" min="0" max="100" step="0.1" inputMode="decimal" defaultValue={valores?.comision ?? ""} className="num" />}
        </Campo>
      ) : rol === "tecnico" ? (
        <p className="text-[13px] text-tinta-3">El mecánico no gana comisión por orden.</p>
      ) : null}
    </>
  );
}

export function AgregarPersona({ asignables, hoy }: { asignables: Rol[]; hoy: string }) {
  const [abierta, setAbierta] = useState(false);
  const [clave] = useState(generarClave);
  const [rol, setRol] = useState("");
  const [usuario, setUsuario] = useState("");
  const [usuarioTocado, setUsuarioTocado] = useState(false);
  const [estado, accion, enviando] = useActionState(agregarPersona, {});
  const e = estado.errores ?? {};
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton>
          <Plus />
          Agregar persona
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo="Agregar persona" descripcion="Queda lista para entrar, trabajar y cobrar. Su contraseña dásela en persona.">
        <form action={accion} className="flex flex-col gap-4">
          <Subtitulo>Datos</Subtitulo>
          <Campo etiqueta="Nombre y apellido" error={e.nombre}>
            {(p) => <Entrada {...p} name="nombre" autoComplete="off" required onChange={(ev) => !usuarioTocado && setUsuario(sugerirUsuario(ev.target.value))} />}
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo etiqueta="DNI o carné" error={e.documento}>
              {(p) => <Entrada {...p} name="documento" inputMode="numeric" autoComplete="off" className="num" required />}
            </Campo>
            <Campo etiqueta="Fecha de ingreso" error={e.fechaIngreso}>
              {(p) => <Entrada {...p} name="fechaIngreso" type="date" defaultValue={hoy} className="num" required />}
            </Campo>
          </div>
          <Campo etiqueta="Cargo (opcional)" ayuda="Cómo lo llaman en el taller: «Mecánico de motor», «Cajera».">
            {(p) => <Entrada {...p} name="cargo" autoComplete="off" maxLength={60} />}
          </Campo>

          <Subtitulo>Rol y acceso</Subtitulo>
          <Campo etiqueta="Rol" error={e.rol} ayuda="Lo que puede ver y hacer sale de su rol. Luego puedes darle más de uno.">
            {(p) => (
              <Selector {...p} name="rol" value={rol} onChange={(ev) => setRol(ev.target.value)} required>
                <option value="" disabled>
                  Elige un rol
                </option>
                {asignables.map((r) => (
                  <option key={r} value={r}>
                    {NOMBRE_ROL[r]}
                  </option>
                ))}
              </Selector>
            )}
          </Campo>
          <Campo etiqueta="Usuario para entrar" error={e.usuario} ayuda={`${REGLA_USUARIO} La primera vez que entre podrá cambiarlo.`}>
            {(p) => (
              <Entrada
                {...p}
                name="usuario"
                value={usuario}
                onChange={(ev) => {
                  setUsuarioTocado(true);
                  setUsuario(ev.target.value.toLowerCase().replace(/\s/g, ""));
                }}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="nombre.apellido"
                maxLength={30}
                required
              />
            )}
          </Campo>
          <Campo etiqueta="Celular" error={e.celular} ayuda="Para el WhatsApp del taller. Se puede cambiar después.">
            {(p) => <Entrada {...p} name="celular" type="tel" inputMode="tel" placeholder="987 654 321" required />}
          </Campo>
          <Campo etiqueta="Contraseña inicial" error={e.clave} ayuda="Mínimo 8 caracteres. Te sugerimos esta; puedes cambiarla.">
            {(p) => <Entrada {...p} name="clave" defaultValue={clave} autoComplete="new-password" className="num" required />}
          </Campo>

          <Subtitulo>Pago</Subtitulo>
          <CamposPago rol={rol} errores={e} />
          <p className="-mt-1 text-[13px] text-tinta-3">Solo lo ven gerencia y administración. Si cambia, se registra desde una fecha y lo pasado queda igual.</p>

          {estado.acceso ? <CompartirAcceso acceso={estado.acceso} /> : <Mensaje resultado={{ ok: estado.ok, error: estado.error }} />}
          {estado.acceso ? <Mensaje resultado={{ error: estado.error }} /> : null}
          <Boton type="submit" disabled={enviando} className="mt-1 w-full">
            {enviando ? "Guardando…" : "Agregar"}
          </Boton>
        </form>
      </ContenidoVentana>
    </Ventana>
  );
}

/** Una contraseña fácil de dictar: tres sílabas, cuatro números. */
function generarClave() {
  const silabas = ["ba", "ca", "da", "fe", "ga", "lo", "ma", "no", "pa", "ra", "sa", "to", "ve", "zu"];
  const azar = (n: number) => {
    const caja = new Uint32Array(1);
    crypto.getRandomValues(caja);
    return caja[0] % n;
  };
  const texto = Array.from({ length: 3 }, () => silabas[azar(silabas.length)]).join("");
  return `${texto}-${String(azar(10000)).padStart(4, "0")}`;
}

export function ListaPersonal({
  personas,
  deBaja,
  asignables,
  yo,
  soyGerencia,
  hoy,
}: {
  personas: Persona[];
  deBaja: boolean;
  asignables: Rol[];
  yo: string;
  soyGerencia: boolean;
  hoy: string;
}) {
  if (personas.length === 0) {
    return (
      <Tarjeta className="flex flex-col items-start gap-2">
        <UsersRound className="size-6 text-tinta-3" aria-hidden />
        <p className="text-[15px] font-medium">{deBaja ? "Nadie dado de baja." : "Todavía no hay personal en este taller."}</p>
        <p className="text-sm text-tinta-2">{deBaja ? "Aquí aparece quien deje de trabajar, con su historial intacto." : "Agrega a la primera persona con el botón de arriba."}</p>
      </Tarjeta>
    );
  }
  return (
    <Tarjeta aria-label="Personal" className="p-2 md:p-3">
      <ul className="flex flex-col">
        {personas.map((p) => {
          const esGerencia = p.roles.includes("gerencia");
          const puedoGestionar = p.id !== yo && (soyGerencia || !esGerencia);
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-3 border-t border-regla px-2 py-3.5 first:border-t-0 md:flex-nowrap md:gap-4 md:px-3">
              <span
                aria-hidden
                className={cn(
                  "grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold",
                  p.activo ? "bg-acento-suave text-tinta" : "bg-interna text-tinta-3",
                )}
              >
                {iniciales(p.nombre)}
              </span>
              <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)] md:items-center md:gap-4">
                <div className="min-w-0">
                  <p className={cn("flex items-center gap-2 text-[15px] font-medium", !p.activo && "text-tinta-2")}>
                    <span className="truncate">{p.nombre}</span>
                    {p.id === yo ? <span className="shrink-0 font-normal text-tinta-3">(tú)</span> : null}
                    {p.dueno ? (
                      <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-acento-suave px-2.5 text-[12px] font-medium text-tinta">
                        <Crown className="size-3.5" aria-hidden />
                        Dueño
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate text-[13px] text-tinta-3">
                    {[p.usuario ? `@${p.usuario}` : null, p.cargo, p.celular].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {deBaja ? (
                  <p className="mt-1.5 min-w-0 text-[13px] text-tinta-2 md:mt-0">
                    <span className="font-medium text-tinta">De baja{p.bajaEn ? ` desde el ${fechaLarga(p.bajaEn)}` : ""}</span>
                    {p.bajaMotivo ? <span className="block truncate">{p.bajaMotivo}</span> : null}
                  </p>
                ) : (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5 md:mt-0" aria-label="Roles">
                    {p.roles.map((r) => (
                      <li key={r} className="flex h-7 items-center rounded-full bg-interna px-3 text-[13px] whitespace-nowrap text-tinta">
                        {NOMBRE_ROL[r]}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {puedoGestionar ? (
                <AccionesPersona persona={p} asignables={asignables} hoy={hoy} />
              ) : (
                <span className="hidden w-[220px] shrink-0 md:block" aria-hidden />
              )}
            </li>
          );
        })}
      </ul>
    </Tarjeta>
  );
}

function Aviso({ resultado }: { resultado: Resultado }) {
  if (!resultado.error && !resultado.ok) return null;
  return (
    <p
      role={resultado.error ? "alert" : "status"}
      className={cn(
        "fixed bottom-24 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-2xl px-4 py-3 text-sm shadow-flotante md:bottom-8",
        resultado.error ? "bg-negativo-fondo text-negativo" : "bg-positivo-fondo text-positivo",
      )}
    >
      {resultado.error ?? resultado.ok}
    </p>
  );
}

/** Los dos botones al costado de cada persona. */
function AccionesPersona({ persona, asignables, hoy }: { persona: Persona; asignables: Rol[]; hoy: string }) {
  const [ventana, setVentana] = useState<"modificar" | "baja" | null>(null);
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const avisar = (r: Resultado) => {
    setResultado(r);
    setTimeout(() => setResultado({}), 4500);
  };

  return (
    <div className="flex w-full shrink-0 gap-2 pl-14 md:w-auto md:pl-0">
      {persona.activo ? (
        <>
          <Boton variante="secundario" tamano="chico" onClick={() => setVentana("modificar")} aria-label={`Modificar a ${persona.nombre}`}>
            <Pencil />
            Modificar
          </Boton>
          {persona.dueno ? null : (
            <Boton variante="fantasma" tamano="chico" className="text-negativo [&_svg]:text-negativo" onClick={() => setVentana("baja")} aria-label={`Dar de baja a ${persona.nombre}`}>
              <UserRoundX />
              Dar de baja
            </Boton>
          )}
        </>
      ) : (
        <Boton
          variante="secundario"
          tamano="chico"
          disabled={pendiente}
          onClick={() => iniciar(async () => avisar(await reactivar(persona.id)))}
          aria-label={`Reactivar a ${persona.nombre}`}
        >
          <UserRoundCheck />
          {pendiente ? "Reactivando…" : "Reactivar"}
        </Boton>
      )}

      {ventana === null ? <Aviso resultado={resultado} /> : null}

      <Ventana open={ventana === "modificar"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana titulo={persona.nombre} descripcion={persona.dueno ? "Dueño del taller: no se puede dar de baja ni quitarle la gerencia." : "Cambia sus datos, roles o contraseña."}>
          <Modificar persona={persona} asignables={asignables} />
        </ContenidoVentana>
      </Ventana>

      <Ventana open={ventana === "baja"} onOpenChange={(v) => !v && setVentana(null)}>
        <ContenidoVentana titulo={`Dar de baja a ${persona.nombre}`} descripcion="Pierde el acceso al instante, también por WhatsApp. No se borra nada: sus órdenes, movimientos y gastos siguen a su nombre. Puedes reactivarlo cuando quieras.">
          <FormularioBaja
            persona={persona}
            hoy={hoy}
            alTerminar={(r) => {
              setVentana(null);
              avisar(r);
            }}
          />
        </ContenidoVentana>
      </Ventana>
    </div>
  );
}

const PESTANAS = [
  ["datos", "Datos y contraseña"],
  ["roles", "Roles"],
  ["pago", "Pago"],
] as const;

function Modificar({ persona, asignables }: { persona: Persona; asignables: Rol[] }) {
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number][0]>("datos");
  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Secciones" className="grid grid-cols-3 gap-1 rounded-full bg-hundida p-1">
        {PESTANAS.map(([clave, texto]) => (
          <button
            key={clave}
            type="button"
            role="tab"
            aria-selected={pestana === clave}
            onClick={() => setPestana(clave)}
            className={cn("h-10 cursor-pointer rounded-full text-sm font-medium", pestana === clave ? "bg-tarjeta text-tinta shadow-sm" : "text-tinta-2 hover:text-tinta")}
          >
            {texto}
          </button>
        ))}
      </div>
      {pestana === "datos" ? (
        <div role="tabpanel" className="flex flex-col gap-6">
          <FormularioDatos persona={persona} />
          <section className="flex flex-col gap-3 border-t border-regla pt-5">
            <h3 className="text-[15px] font-semibold">Usuario y contraseña para entrar</h3>
            <p className="-mt-1.5 text-sm text-tinta-2">Créalos o cámbialos aquí. Al guardar podrás enviárselos por WhatsApp.</p>
            <FormularioAcceso persona={persona} />
          </section>
        </div>
      ) : pestana === "roles" ? (
        <div role="tabpanel">
          <FormularioRoles persona={persona} asignables={asignables} />
        </div>
      ) : (
        <div role="tabpanel">
          <FormularioPago persona={persona} />
        </div>
      )}
    </div>
  );
}

function FormularioDatos({ persona }: { persona: Persona }) {
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        iniciar(async () =>
          setResultado(
            await editarDatos(persona.id, {
              nombre: f.get("nombre"),
              documento: f.get("documento"),
              cargo: f.get("cargo"),
              fechaIngreso: f.get("fechaIngreso"),
              celular: f.get("celular"),
            }),
          ),
        );
      }}
    >
      <Campo etiqueta="Nombre y apellido" error={resultado.errores?.nombre}>
        {(p) => <Entrada {...p} name="nombre" defaultValue={persona.nombre} autoComplete="off" required />}
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="DNI o carné" error={resultado.errores?.documento}>
          {(p) => <Entrada {...p} name="documento" defaultValue={persona.documento ?? ""} inputMode="numeric" className="num" autoComplete="off" />}
        </Campo>
        <Campo etiqueta="Fecha de ingreso" error={resultado.errores?.fechaIngreso}>
          {(p) => <Entrada {...p} name="fechaIngreso" type="date" defaultValue={persona.fechaIngreso ?? ""} className="num" />}
        </Campo>
      </div>
      <Campo etiqueta="Cargo" error={resultado.errores?.cargo} ayuda="Cómo lo llaman en el taller. Lo que puede hacer depende de sus roles.">
        {(p) => <Entrada {...p} name="cargo" defaultValue={persona.cargo ?? ""} maxLength={60} autoComplete="off" />}
      </Campo>
      <Campo etiqueta="Celular (WhatsApp)" error={resultado.errores?.celular} ayuda="A este número se le envía su usuario y contraseña.">
        {(p) => <Entrada {...p} name="celular" type="tel" inputMode="tel" defaultValue={persona.celular} required className="num" />}
      </Campo>
      <Mensaje resultado={{ ok: resultado.ok, error: resultado.error }} />
      <Boton type="submit" disabled={pendiente} className="w-full">
        {pendiente ? "Guardando…" : "Guardar datos"}
      </Boton>
    </form>
  );
}

function FormularioBaja({ persona, hoy, alTerminar }: { persona: Persona; hoy: string; alTerminar: (r: Resultado) => void }) {
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [error, setError] = useState<string>();
  const [pendiente, iniciar] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await darDeBaja(persona.id, motivo, fecha);
          if (r.error) setError(r.error);
          else alTerminar(r);
        });
      }}
    >
      <Campo etiqueta="Motivo" ayuda="Por ejemplo: «Renunció», «Fin de contrato».">
        {(p) => <Entrada {...p} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} required autoComplete="off" />}
      </Campo>
      <Campo etiqueta="Último día de trabajo">
        {(p) => <Entrada {...p} type="date" value={fecha} max={hoy} onChange={(e) => setFecha(e.target.value)} className="num" />}
      </Campo>
      <Mensaje resultado={{ error }} />
      <Boton type="submit" variante="peligro" disabled={pendiente || motivo.trim().length < 3} className="w-full">
        {pendiente ? "Dando de baja…" : `Dar de baja a ${persona.nombre.split(" ")[0]}`}
      </Boton>
    </form>
  );
}

function FormularioRoles({ persona, asignables }: { persona: Persona; asignables: Rol[] }) {
  const [elegidos, setElegidos] = useState<Set<Rol>>(new Set(persona.roles));
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  // Los roles que no puede tocar (gerencia, para administración) se muestran pero no se cambian.
  const visibles = [...new Set([...asignables, ...persona.roles])];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => setResultado(await cambiarRoles(persona.id, [...elegidos])));
      }}
    >
      <p className="text-sm text-tinta-2">Puede tener más de uno. Lo que ve y puede hacer depende de sus roles.</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Roles</legend>
        {visibles.map((rol) => {
          const fijo = !asignables.includes(rol) || (persona.dueno && rol === "gerencia");
          return (
            <label key={rol} className={cn("flex min-h-12 items-center gap-3 rounded-2xl px-3 hover:bg-interna", fijo ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
              <Casilla
                checked={elegidos.has(rol)}
                disabled={fijo}
                onCheckedChange={(v) =>
                  setElegidos((previos) => {
                    const nuevos = new Set(previos);
                    if (v === true) nuevos.add(rol);
                    else nuevos.delete(rol);
                    return nuevos;
                  })
                }
              />
              <span className="text-[15px]">{NOMBRE_ROL[rol]}</span>
              {fijo ? <span className="ml-auto text-[13px] text-tinta-3">{persona.dueno && rol === "gerencia" ? "Es el dueño" : "Solo gerencia lo cambia"}</span> : null}
            </label>
          );
        })}
      </fieldset>
      <Mensaje resultado={resultado} />
      <Boton type="submit" disabled={pendiente || elegidos.size === 0} className="w-full">
        {pendiente ? "Guardando…" : "Guardar roles"}
      </Boton>
    </form>
  );
}

function FormularioAcceso({ persona }: { persona: Persona }) {
  const [usuario, setUsuario] = useState(persona.usuario ?? sugerirUsuario(persona.nombre));
  const [clave, setClave] = useState(generarClave);
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const e = resultado.errores ?? {};
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(ev) => {
        ev.preventDefault();
        iniciar(async () => setResultado(await cambiarAcceso(persona.id, usuario, clave)));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Usuario" error={e.usuario} ayuda={REGLA_USUARIO}>
          {(p) => (
            <Entrada
              {...p}
              value={usuario}
              onChange={(ev) => setUsuario(ev.target.value.toLowerCase().replace(/\s/g, ""))}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="nombre.apellido"
              maxLength={30}
              required
            />
          )}
        </Campo>
        <Campo etiqueta="Contraseña nueva" error={e.clave} ayuda="Mínimo 8. Déjala vacía para no cambiarla.">
          {(p) => <Entrada {...p} value={clave} onChange={(ev) => setClave(ev.target.value)} autoComplete="new-password" className="num" maxLength={72} />}
        </Campo>
      </div>
      {resultado.acceso ? <CompartirAcceso acceso={resultado.acceso} /> : <Mensaje resultado={{ ok: resultado.ok, error: resultado.error }} />}
      <Boton type="submit" variante="secundario" disabled={pendiente || usuario.length < 3 || (clave.length > 0 && clave.length < 8)} className="w-full">
        {pendiente ? "Guardando…" : clave ? "Guardar usuario y contraseña" : "Guardar usuario"}
      </Boton>
    </form>
  );
}

const fechaCorta = (f: string) => f.split("-").reverse().join("/");
const textoPago = (p: Pago) =>
  `${p.tipo === "fijo" ? "Sueldo fijo" : "A destajo"} · S/ ${p.monto.toFixed(2)} ${p.tipo === "fijo" ? (NOMBRE_FRECUENCIA[p.frecuencia] ?? "") : "por trabajo"}${p.tipo === "destajo" ? ` · se le paga ${p.frecuencia === "semanal" ? "cada semana" : p.frecuencia === "quincenal" ? "cada quincena" : "cada mes"}` : ""}${p.comision ? ` · ${p.comision} % de comisión` : ""}`;

/** El pago de la persona: el vigente, su historial y el cambio desde una fecha (lo pasado no se toca). */
function FormularioPago({ persona }: { persona: Persona }) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const [resultado, setResultado] = useState<Resultado>({});
  const [pendiente, iniciar] = useTransition();
  const rol = persona.roles.includes("asesor") ? "asesor" : persona.roles.includes("tecnico") ? "tecnico" : "";
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl bg-interna px-4 py-3">
        <p className="text-[13px] text-tinta-2">Pago vigente</p>
        <p className="mt-0.5 text-[15px] font-medium">{persona.pago ? textoPago(persona.pago) : "Sin esquema de pago todavía"}</p>
        {persona.pago ? <p className="text-[13px] text-tinta-3">Desde el {fechaCorta(persona.pago.desde)}</p> : null}
      </section>
      <form
        className="flex flex-col gap-4"
        onSubmit={(ev) => {
          ev.preventDefault();
          const f = new FormData(ev.currentTarget);
          iniciar(async () =>
            setResultado(
              await cambiarPago(persona.id, {
                tipo: f.get("tipo"),
                monto: f.get("monto"),
                frecuencia: f.get("frecuencia"),
                comision: f.get("comision") || undefined,
                desde: f.get("desde"),
                motivo: f.get("motivo"),
              }),
            ),
          );
        }}
      >
        <h3 className="text-[15px] font-semibold">{persona.pago ? "Cambiar el pago" : "Poner su pago"}</h3>
        <CamposPago rol={rol} errores={resultado.errores ?? {}} valores={persona.pago} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Vale desde" error={resultado.errores?.desde} ayuda="Hoy o una fecha futura.">
            {(p) => <Entrada {...p} name="desde" type="date" min={hoy} defaultValue={hoy} className="num" required />}
          </Campo>
          <Campo etiqueta="Motivo" error={resultado.errores?.motivo}>
            {(p) => <Entrada {...p} name="motivo" placeholder="Aumento, cambio de puesto…" maxLength={200} required />}
          </Campo>
        </div>
        <Mensaje resultado={{ ok: resultado.ok, error: resultado.error }} />
        <Boton type="submit" disabled={pendiente} className="w-full">
          {pendiente ? "Guardando…" : "Guardar pago"}
        </Boton>
      </form>
      {persona.historialPago?.length ? (
        <details className="text-sm text-tinta-2">
          <summary className="cursor-pointer text-[13px] text-tinta-3">Historial de pago ({persona.historialPago.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {persona.historialPago.map((h) => (
              <li key={h.desde} className="border-t border-regla pt-2 first:border-t-0 first:pt-0">
                <span className="text-tinta">{textoPago(h)}</span>
                <span className="block text-[13px] text-tinta-3">
                  Del {fechaCorta(h.desde)}
                  {h.hasta ? ` al ${fechaCorta(h.hasta)}` : " en adelante"}
                  {h.motivo ? ` · ${h.motivo}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
