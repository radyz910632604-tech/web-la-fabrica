import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Estado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { diaEnLima } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogo, limitesDiaLima, listarCitas, personalConRol, type Cita } from "@/lib/taller/consultas";
import { COLOR_ESTADO_CITA, NOMBRE_ESTADO_CITA, REDES, type EstadoCita } from "@/lib/taller/estados";
import { AccionesCita, AgendarCita } from "./controles";

export const metadata = { title: "Citas" };

const sumarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const horaLima = (iso: string) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

export default async function Citas({ searchParams }: { searchParams: Promise<{ dia?: string; agendar?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes", "confirmador"])) notFound();
  const hoy = diaEnLima(new Date());
  const { dia: pedido, agendar } = await searchParams;
  const dia = pedido && /^\d{4}-\d{2}-\d{2}$/.test(pedido) ? pedido : hoy;

  const supabase = await clienteServidor();
  await supabase.rpc("marcar_citas_no_llego", { p_empresa: ctx.taller.id });

  const { desde, hasta } = limitesDiaLima(dia);
  const hace30 = limitesDiaLima(sumarDias(hoy, -30)).desde;
  const gestiona = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"]);
  const [citas, ultimas, servicios, vendedores] = await Promise.all([
    listarCitas(ctx.taller.id, desde, hasta),
    listarCitas(ctx.taller.id, hace30, limitesDiaLima(hoy).hasta),
    gestiona || ctx.roles.includes("vendedor_redes") ? catalogo(ctx.taller.id) : Promise.resolve([]),
    gestiona ? personalConRol(ctx.taller.id, "vendedor_redes") : Promise.resolve([]),
  ]);

  const vivas = citas.filter((c) => c.estado !== "reagendada" && c.estado !== "cancelada");
  const cuenta = (e: EstadoCita) => citas.filter((c) => c.estado === e).length;
  const titulo =
    dia === hoy
      ? "Hoy"
      : new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`));
  const puedeAgendar = gestiona || ctx.roles.includes("vendedor_redes");
  const puedeConfirmar = gestiona || ctx.roles.includes("confirmador");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Citas</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
            {vivas.length} {vivas.length === 1 ? "cita" : "citas"} {dia === hoy ? "hoy" : `el ${titulo}`}: {cuenta("llego")} llegaron, {cuenta("agendada")} por confirmar,{" "}
            {cuenta("no_llego")} no llegaron.
          </p>
        </div>
        {puedeAgendar ? (
          <AgendarCita abrir={agendar === "1"} hoy={hoy} servicios={servicios.map((s) => s.nombre)} vendedores={vendedores} elegirVendedor={gestiona} />
        ) : null}
      </header>

      <nav aria-label="Elegir día" className="flex items-center gap-2">
        <Link href={`/citas?dia=${sumarDias(dia, -1)}`} className="grid size-11 place-items-center rounded-full bg-tarjeta shadow-reposo hover:bg-interna" aria-label="Día anterior">
          <ChevronLeft className="size-5" />
        </Link>
        <span className="min-w-36 rounded-full bg-tarjeta px-4 py-2.5 text-center text-[15px] font-medium capitalize shadow-reposo">{titulo}</span>
        <Link href={`/citas?dia=${sumarDias(dia, 1)}`} className="grid size-11 place-items-center rounded-full bg-tarjeta shadow-reposo hover:bg-interna" aria-label="Día siguiente">
          <ChevronRight className="size-5" />
        </Link>
        {dia !== hoy ? (
          <Link href="/citas" className="ml-1 text-sm font-medium underline-offset-4 hover:underline">
            Volver a hoy
          </Link>
        ) : null}
      </nav>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <Tarjeta aria-label="Citas del día" className="min-w-0 xl:col-span-8">
          {citas.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">No hay citas para este día.</p>
          ) : (
            <ul className="flex flex-col">
              {citas.map((c) => (
                <FilaCita
                  key={c.id}
                  c={c}
                  hoy={hoy}
                  puedeConfirmar={puedeConfirmar}
                  puedeEditar={gestiona || (ctx.roles.includes("vendedor_redes") && c.vendedorId === ctx.perfil.id)}
                  puedeIngresar={gestiona && dia === hoy}
                />
              ))}
            </ul>
          )}
        </Tarjeta>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <Asistencia citas={ultimas} por="vendedor" titulo="Asistencia por vendedor" />
          <Asistencia citas={ultimas} por="campana" titulo="Asistencia por campaña" />
        </div>
      </div>
    </div>
  );
}

function FilaCita({ c, hoy, puedeConfirmar, puedeEditar, puedeIngresar }: { c: Cita; hoy: string; puedeConfirmar: boolean; puedeEditar: boolean; puedeIngresar: boolean }) {
  return (
    <li className="flex flex-col gap-3 border-t border-regla py-4 first:border-t-0 first:pt-0 md:flex-row md:items-center">
      <span className="num w-14 shrink-0 text-[17px] font-semibold">{horaLima(c.fechaHora)}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">
          {c.nombreCliente} <span className="num font-normal text-tinta-3">· {formatearCelular(c.celular)}</span>
        </p>
        <p className="truncate text-[14px] text-tinta-2">
          {c.servicio} · {REDES[c.red as keyof typeof REDES] ?? c.red}
          {c.campana ? ` · ${c.campana}` : ""}
          {c.vendedor ? ` · ${c.vendedor}` : ""}
        </p>
        <Estado className="mt-1 text-[13px] text-tinta-2" color={COLOR_ESTADO_CITA[c.estado]} texto={NOMBRE_ESTADO_CITA[c.estado]} />
      </div>
      <AccionesCita
        id={c.id}
        estado={c.estado}
        ordenId={c.ordenId}
        puedeConfirmar={puedeConfirmar}
        puedeEditar={puedeEditar}
        puedeIngresar={puedeIngresar}
        hoy={hoy}
      />
    </li>
  );
}

/** Reporte de los últimos 30 días: cuántas citas hubo y cuántas llegaron. */
function Asistencia({ citas, por, titulo }: { citas: Cita[]; por: "vendedor" | "campana"; titulo: string }) {
  const contadas = citas.filter((c) => !["reagendada", "cancelada", "agendada", "confirmada"].includes(c.estado));
  const grupos = new Map<string, { total: number; llegaron: number }>();
  for (const c of contadas) {
    const clave = (por === "vendedor" ? c.vendedor : c.campana) ?? (por === "vendedor" ? "Sin vendedor" : "Sin campaña");
    const g = grupos.get(clave) ?? { total: 0, llegaron: 0 };
    g.total += 1;
    if (c.estado === "llego") g.llegaron += 1;
    grupos.set(clave, g);
  }
  const filas = [...grupos.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6);
  return (
    <Tarjeta aria-label={titulo}>
      <CabeceraTarjeta titulo={titulo} detalle="Últimos 30 días, citas que ya pasaron" />
      {filas.length === 0 ? (
        <p className="text-sm text-tinta-2">Todavía no hay citas pasadas para medir.</p>
      ) : (
        <dl className="rounded-2xl bg-interna px-4 py-1 text-[15px]">
          {filas.map(([nombre, g]) => (
            <div key={nombre} className="flex items-center justify-between gap-3 border-b border-borde py-3 last:border-b-0">
              <dt className="min-w-0 truncate">{nombre}</dt>
              <dd className="num shrink-0 text-tinta-2">
                <span className="font-medium text-tinta">{Math.round((g.llegaron / g.total) * 100)} %</span> · {g.llegaron} de {g.total}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Tarjeta>
  );
}
