import { Info } from "lucide-react";
import { CitasPorRed, MetaVentas, PorAtender } from "@/components/panel/bloques";
import { GraficoVentas, LeyendaVentas } from "@/components/panel/grafico-ventas";
import { Indicadores } from "@/components/panel/indicadores";
import { TablaActividad, TablaCitas } from "@/components/panel/tablas";
import { resumirEstados, TarjetaCitasHoy, TarjetaMisTrabajos, TarjetaTaller } from "@/components/panel/tarjeta-destacada";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, nombreMes, primerNombre, saludo } from "@/lib/formato";
import { datosPanelEjemplo } from "@/lib/panel/ejemplo";
import { vistaPanel } from "@/lib/panel/vista";
import { obtenerContexto } from "@/lib/sesion";

export const metadata = { title: "Panel" };

/*
 * Cuadrícula de computadora: 12 columnas, 16 px entre bloques.
 * Fila 1: destacada (4) + indicadores (4) + gráfico o meta (4). Las tres terminan juntas.
 * Fila 2: la columna de 4 y la tabla de 8 terminan a la misma altura.
 */
export default async function Panel() {
  const ctx = await obtenerContexto();
  const ahora = new Date();
  const vista = vistaPanel(ctx.roles, { adminVeUtilidad: ctx.configuracion.adminVeUtilidad });
  const datos = datosPanelEjemplo(ahora);

  const mes = nombreMes(ahora);
  const mesAnterior = nombreMes(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 15));
  const [anio, numMes, dia] = diaEnLima(ahora).split("-").map(Number);
  const diasDelMes = new Date(Date.UTC(anio, numMes, 0)).getUTCDate();
  const diasRestantes = diasDelMes - dia + 1;

  // El técnico de ejemplo es Luis Quispe; si entra otro técnico, ve los trabajos de Luis.
  const propios = datos.enTaller.filter((o) => o.tecnico === ctx.perfil.nombre);
  const misTrabajos = propios.length > 0 ? propios : datos.enTaller.filter((o) => o.tecnico === "Luis Quispe");
  const listos = datos.enTaller.filter((o) => o.estado === "listo");
  const esperando = datos.enTaller.filter((o) => o.estado === "esperando_repuesto");
  const serializar = (o: (typeof datos.ordenes)[number]) => ({ ...o, momento: o.momento.toISOString() });
  const verCliente = vista.columnas.cliente;

  const hallazgo =
    vista.destacada === "taller"
      ? `Hay ${datos.enTaller.length} carros en el taller: ${listos.length} listos para entregar y ${esperando.length} esperando repuesto.`
      : vista.destacada === "mis_trabajos"
        ? `Tienes ${misTrabajos.length} carros asignados: ${resumirEstados(misTrabajos)}.`
        : `Hoy hay ${datos.citas.length} citas: ${datos.citas.filter((c) => c.estado === "llego").length} ya llegaron y ${datos.citas.filter((c) => c.estado === "agendada").length} faltan confirmar.`;

  const indicadores =
    vista.indicadores.length > 0 ? (
      <Indicadores
        indicadores={vista.indicadores}
        mes={datos.mes}
        anterior={datos.mesAnteriorAlMismoDia}
        mesAnterior={mesAnterior}
        diaDelMes={datos.diaDelMes}
      />
    ) : null;

  const meta = (conRitmo: boolean) =>
    vista.meta ? (
      <MetaVentas
        vendido={datos.mes.ventas}
        meta={datos.meta}
        mes={mes}
        diasRestantes={diasRestantes}
        diasTranscurridos={dia}
        conRitmo={conRitmo}
      />
    ) : null;

  const grupoListos = { titulo: "Listos para entregar", vacio: "No hay carros listos por ahora.", ordenes: listos };
  const grupoEsperando = { titulo: "Esperan repuesto", vacio: "Ningún carro espera repuesto.", ordenes: esperando };

  const tabla =
    vista.tabla === "citas" ? (
      <TablaCitas citas={datos.citas} />
    ) : (
      <TablaActividad
        idTitulo="titulo-actividad"
        titulo={vista.tabla === "mis_trabajos" ? "Mis trabajos" : "Actividad reciente"}
        filas={(vista.tabla === "mis_trabajos" ? misTrabajos : datos.ordenes).map(serializar)}
        ahora={ahora.toISOString()}
        columnas={vista.columnas}
      />
    );

  const destacada =
    vista.destacada === "taller" ? (
      <TarjetaTaller enTaller={datos.enTaller} conteo={datos.conteoPorEstado} acciones={vista.acciones} />
    ) : vista.destacada === "mis_trabajos" ? (
      <TarjetaMisTrabajos trabajos={misTrabajos} />
    ) : (
      <TarjetaCitasHoy citas={datos.citas} puedeAgendar={ctx.roles.includes("vendedor_redes")} />
    );

  let cuerpo: React.ReactNode;
  if (vista.destacada !== "taller") {
    // Técnico, ventas por redes y confirmación: su tarjeta y su lista.
    cuerpo = (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-4">
          {destacada}
          {indicadores}
          {vista.destacada === "citas_hoy" ? <CitasPorRed citas={datos.citas} /> : null}
        </div>
        <div className="xl:col-span-8">{tabla}</div>
      </div>
    );
  } else if (vista.grafico) {
    // Gerencia (y administración con permiso): todo.
    cuerpo = (
      <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          <div className="flex xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{destacada}</div>
          <div className="xl:col-span-4">{indicadores}</div>
          <div className="flex md:col-span-2 xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">
            <Tarjeta aria-labelledby="titulo-grafico" className="flex flex-col">
              <CabeceraTarjeta
                id="titulo-grafico"
                titulo="Ventas vs. costos por mes"
                detalle={`Sin IGV. ${mes.charAt(0).toUpperCase() + mes.slice(1)} va hasta el día ${datos.diaDelMes}.`}
              />
              <LeyendaVentas />
              <div className="mt-3">
                <GraficoVentas meses={datos.meses} />
              </div>
            </Tarjeta>
          </div>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
            {meta(false)}
            <PorAtender titulo="Listos para entregar" detalle={`${listos.length} esperando al cliente`} grupos={[grupoListos]} verCliente={verCliente} />
          </div>
          <div className="xl:col-span-8">{tabla}</div>
        </div>
      </>
    );
  } else if (vista.meta) {
    // Asesor y administración sin permiso de utilidad.
    cuerpo = (
      <>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          <div className="flex xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{destacada}</div>
          <div className="xl:col-span-4">{indicadores}</div>
          <div className="flex md:col-span-2 xl:col-span-4 [&>*]:min-w-0 [&>*]:flex-1">{meta(true)}</div>
        </div>
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
          <div className="xl:col-span-4">
            <PorAtender
              titulo="Por atender"
              detalle="Carros que hay que mover hoy"
              grupos={[grupoListos, grupoEsperando]}
              verCliente={verCliente}
            />
          </div>
          <div className="xl:col-span-8">{tabla}</div>
        </div>
      </>
    );
  } else {
    // Almacén: compras, entregados y los carros que esperan un repuesto.
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
              verCliente={false}
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
        <p className="mt-3 inline-flex items-start gap-2 rounded-2xl border border-aviso-borde bg-aviso-fondo px-3 py-2 text-[13px] text-aviso">
          <Info className="mt-px size-4 shrink-0" aria-hidden />
          Datos de ejemplo. Los carros y citas reales llegan en la Entrega 1B; los montos reales, en la Fase 3.
        </p>
      </header>
      {cuerpo}
    </div>
  );
}
