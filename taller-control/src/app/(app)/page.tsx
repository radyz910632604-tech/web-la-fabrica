import { Info } from "lucide-react";
import { CitasPorRed, Ejemplo, MetaVentas, PorAtender, type ItemAtender } from "@/components/panel/bloques";
import { GraficoVentas, LeyendaVentas } from "@/components/panel/grafico-ventas";
import { Indicadores } from "@/components/panel/indicadores";
import { TablaActividad, TablaCitas, type FilaActividad } from "@/components/panel/tablas";
import { resumirEstados, TarjetaCitasHoy, TarjetaMisTrabajos, TarjetaTaller } from "@/components/panel/tarjeta-destacada";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, nombreMes, primerNombre, saludo } from "@/lib/formato";
import { datosPanelEjemplo } from "@/lib/panel/ejemplo";
import { vistaPanel } from "@/lib/panel/vista";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { limitesDiaLima, listarCitas, listarOrdenes, type FilaOrden } from "@/lib/taller/consultas";

export const metadata = { title: "Panel" };

const ACTIVOS = ["en_taller", "en_proceso", "esperando_repuesto", "listo"] as const;

/*
 * Cuadrícula de computadora: 12 columnas, 16 px entre bloques.
 * Fila 1: destacada (4) + indicadores (4) + gráfico o meta (4). Las tres terminan juntas.
 * Fila 2: la columna de 4 y la tabla de 8 terminan a la misma altura.
 *
 * Carros, órdenes, citas y entregados son reales. Los montos (ventas, compras,
 * utilidad, lo vendido de la meta) son de ejemplo hasta la Fase 3 y lo dicen.
 */
export default async function Panel() {
  const ctx = await obtenerContexto();
  const ahora = new Date();
  const vista = vistaPanel(ctx.roles, { adminVeUtilidad: ctx.configuracion.adminVeUtilidad });
  const ejemplo = datosPanelEjemplo(ahora);
  const supabase = await clienteServidor();

  const hoy = diaEnLima(ahora);
  const [anio, numMes, dia] = hoy.split("-").map(Number);
  const inicioMes = limitesDiaLima(`${hoy.slice(0, 7)}-01`).desde;
  const mesAnteriorClave = new Date(Date.UTC(anio, numMes - 2, 1)).toISOString().slice(0, 7);
  const inicioMesAnterior = limitesDiaLima(`${mesAnteriorClave}-01`).desde;
  const mismoDiaMesAnterior = new Date(inicioMesAnterior.getTime() + (ahora.getTime() - inicioMes.getTime()));
  const diasDelMes = new Date(Date.UTC(anio, numMes, 0)).getUTCDate();
  const diasRestantes = diasDelMes - dia + 1;
  const mes = nombreMes(ahora);
  const mesAnterior = nombreMes(new Date(Date.UTC(anio, numMes - 2, 15)));
  const verCitas = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes", "confirmador"]);

  const entregados = (desde: Date, hasta: Date) =>
    supabase
      .from("ordenes_trabajo")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", ctx.taller.id)
      .eq("estado", "entregado")
      .eq("anulada", false)
      .gte("entregado_en", desde.toISOString())
      .lt("entregado_en", hasta.toISOString());

  const [enTaller, recientes, citasHoy, entregadosMes, entregadosAntes, { data: metaReal }] = await Promise.all([
    vista.tabla === "citas" ? Promise.resolve([] as FilaOrden[]) : listarOrdenes(ctx.taller.id, { estados: [...ACTIVOS], orden: "ingreso" }),
    vista.tabla === "citas" ? Promise.resolve([] as FilaOrden[]) : listarOrdenes(ctx.taller.id, { limite: 40 }),
    verCitas ? listarCitas(ctx.taller.id, limitesDiaLima(hoy).desde, limitesDiaLima(hoy).hasta) : Promise.resolve([]),
    entregados(inicioMes, ahora),
    entregados(inicioMesAnterior, mismoDiaMesAnterior),
    supabase.from("metas_ventas").select("meta_sin_igv").eq("empresa_id", ctx.taller.id).eq("anio", anio).eq("mes", numMes).maybeSingle(),
  ]);

  const listos = enTaller.filter((o) => o.estado === "listo");
  const esperando = enTaller.filter((o) => o.estado === "esperando_repuesto");
  const misTrabajos = enTaller.filter((o) => o.tecnicoId === ctx.perfil.id);
  const verCliente = vista.columnas.cliente;
  const aItem = (o: FilaOrden): ItemAtender => ({
    id: o.id,
    placa: o.placa,
    titulo: verCliente ? (o.cliente ?? o.vehiculo) : (o.servicios[0] ?? "Sin servicios"),
    detalle: verCliente ? o.servicios.join(" · ") || "Sin servicios" : o.vehiculo || `Técnico: ${o.tecnico ?? "sin asignar"}`,
    momento: o.estadoCambiadoEn,
  });
  const aFila = (o: FilaOrden): FilaActividad => ({
    id: o.id,
    numero: o.numero,
    placa: o.placa,
    cliente: o.cliente,
    servicio: o.servicios.join(" · ") || "Sin servicios",
    estado: o.estado,
    momento: o.estadoCambiadoEn,
  });
  const vivas = citasHoy.filter((c) => c.estado !== "reagendada" && c.estado !== "cancelada");

  const hallazgo =
    vista.destacada === "taller"
      ? enTaller.length === 0
        ? "No hay carros en el taller ahora."
        : `Hay ${enTaller.length} ${enTaller.length === 1 ? "carro" : "carros"} en el taller: ${listos.length} ${listos.length === 1 ? "listo" : "listos"} para entregar y ${esperando.length} esperando repuesto.`
      : vista.destacada === "mis_trabajos"
        ? misTrabajos.length === 0
          ? "No tienes carros asignados ahora."
          : `Tienes ${misTrabajos.length} ${misTrabajos.length === 1 ? "carro asignado" : "carros asignados"}: ${resumirEstados(misTrabajos)}.`
        : `Hoy hay ${vivas.length} ${vivas.length === 1 ? "cita" : "citas"}: ${citasHoy.filter((c) => c.estado === "llego").length} ya llegaron y ${citasHoy.filter((c) => c.estado === "agendada").length} faltan confirmar.`;

  // Indicadores: entregados es real; los montos, de ejemplo.
  const mesActual = { ...ejemplo.mes, entregados: entregadosMes.count ?? 0 };
  const anterior = { ...ejemplo.mesAnteriorAlMismoDia, entregados: entregadosAntes.count ?? 0 };
  const indicadores =
    vista.indicadores.length > 0 ? (
      <Indicadores
        indicadores={vista.indicadores}
        ejemplo={["ventas", "compras", "utilidad"]}
        mes={mesActual}
        anterior={anterior}
        mesAnterior={mesAnterior}
        diaDelMes={dia}
      />
    ) : null;

  const meta = (conRitmo: boolean) =>
    vista.meta ? (
      <MetaVentas
        vendido={ejemplo.mes.ventas}
        meta={metaReal ? Number(metaReal.meta_sin_igv) : ejemplo.meta}
        mes={mes}
        diasRestantes={diasRestantes}
        diasTranscurridos={dia}
        conRitmo={conRitmo}
      />
    ) : null;

  const grupoListos = { titulo: "Listos para entregar", vacio: "No hay carros listos por ahora.", items: listos.map(aItem) };
  const grupoEsperando = { titulo: "Esperan repuesto", vacio: "Ningún carro espera repuesto.", items: esperando.map(aItem) };

  const tabla =
    vista.tabla === "citas" ? (
      <TablaCitas
        citas={citasHoy.map((c) => ({
          id: c.id,
          hora: new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(c.fechaHora)),
          cliente: c.nombreCliente,
          celular: c.celular,
          servicio: c.servicio,
          red: c.red,
          estado: c.estado,
        }))}
      />
    ) : (
      <TablaActividad
        idTitulo="titulo-actividad"
        titulo={vista.tabla === "mis_trabajos" ? "Mis trabajos" : "Actividad reciente"}
        filas={(vista.tabla === "mis_trabajos" ? misTrabajos : recientes).map(aFila)}
        ahora={ahora.toISOString()}
        verCliente={verCliente}
        verTodas={vista.tabla === "mis_trabajos" ? "/mis-trabajos" : "/ordenes"}
      />
    );

  const carros = (lista: FilaOrden[]) => lista.map((o) => ({ id: o.id, placa: o.placa, estado: o.estado }));
  const destacada =
    vista.destacada === "taller" ? (
      <TarjetaTaller enTaller={carros(enTaller)} acciones={vista.acciones} />
    ) : vista.destacada === "mis_trabajos" ? (
      <TarjetaMisTrabajos trabajos={carros(misTrabajos)} />
    ) : (
      <TarjetaCitasHoy citas={citasHoy} puedeAgendar={ctx.roles.includes("vendedor_redes")} />
    );

  let cuerpo: React.ReactNode;
  if (vista.destacada !== "taller") {
    cuerpo = (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-4">
          {destacada}
          {indicadores}
          {vista.destacada === "citas_hoy" ? <CitasPorRed citas={citasHoy} /> : null}
        </div>
        <div className="min-w-0 xl:col-span-8">{tabla}</div>
      </div>
    );
  } else if (vista.grafico) {
    cuerpo = (
      <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          <div className="flex xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{destacada}</div>
          <div className="xl:col-span-4">{indicadores}</div>
          <div className="flex md:col-span-2 xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">
            <Tarjeta aria-labelledby="titulo-grafico" className="flex flex-col">
              <CabeceraTarjeta
                id="titulo-grafico"
                titulo={
                  <>
                    Ventas vs. costos por mes
                    <Ejemplo />
                  </>
                }
                detalle={`Sin IGV. ${mes.charAt(0).toUpperCase() + mes.slice(1)} va hasta el día ${dia}.`}
              />
              <LeyendaVentas />
              <div className="mt-3">
                <GraficoVentas meses={ejemplo.meses} />
              </div>
            </Tarjeta>
          </div>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
            {meta(false)}
            <PorAtender titulo="Listos para entregar" detalle={`${listos.length} esperando al cliente`} grupos={[grupoListos]} />
          </div>
          <div className="min-w-0 xl:col-span-8">{tabla}</div>
        </div>
      </>
    );
  } else if (vista.meta) {
    cuerpo = (
      <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          <div className="flex xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{destacada}</div>
          <div className="xl:col-span-4">{indicadores}</div>
          <div className="flex md:col-span-2 xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{meta(true)}</div>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <div className="min-w-0 xl:col-span-4">
            <PorAtender titulo="Por atender" detalle="Carros que hay que mover hoy" grupos={[grupoListos, grupoEsperando]} />
          </div>
          <div className="min-w-0 xl:col-span-8">{tabla}</div>
        </div>
      </>
    );
  } else {
    cuerpo = (
      <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          <div className="flex xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{destacada}</div>
          <div className="xl:col-span-4">{indicadores}</div>
          <div className="flex md:col-span-2 xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">
            <PorAtender
              titulo="Esperan repuesto"
              detalle={`${esperando.length} ${esperando.length === 1 ? "carro parado" : "carros parados"} por un repuesto`}
              grupos={[grupoEsperando]}
            />
          </div>
        </div>
        {tabla}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">
          {saludo(ahora)}, {primerNombre(ctx.perfil.nombre)}
        </h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">{hallazgo}</p>
        {vista.indicadores.some((i) => i !== "entregados") || vista.meta ? (
          <p className="mt-3 inline-flex items-start gap-2 rounded-2xl border border-aviso-borde bg-aviso-fondo px-3 py-2 text-[13px] text-aviso">
            <Info className="mt-px size-4 shrink-0" aria-hidden />
            Carros, órdenes y citas son reales. Los montos marcados «Ejemplo» se vuelven reales en la Fase 3.
          </p>
        ) : null}
      </header>
      {cuerpo}
    </div>
  );
}
