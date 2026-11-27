import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { EnlacePdf } from "@/components/ui/enlace-pdf";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { diaEnLima, formatearSoles, nombreMes } from "@/lib/formato";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { gananciasDelMes } from "@/lib/taller/ganancias";
import { mesesHasta, personalDelMes, reporteMensual, sumarFilas, type FilaMes } from "@/lib/taller/reportes";
import { cn } from "@/lib/utils";
import { ElegirMes } from "./controles";

export const metadata = { title: "Reportes" };

const pct = (m: number | null) => (m === null ? "—" : `${(m * 100).toFixed(1)} %`);
const etiquetaMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const nombre = nombreMes(new Date(Date.UTC(a, m - 1, 15, 12)));
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${a}`;
};

function Kpi({ nombre, valor, detalle, negativo }: { nombre: string; valor: string; detalle?: string; negativo?: boolean }) {
  return (
    <Tarjeta className="min-w-0">
      <p className="text-[15px] text-tinta-2">{nombre}</p>
      <p className={cn("num mt-2 truncate text-[26px] leading-none font-semibold tracking-[-0.025em] md:text-[30px]", negativo && "text-negativo")}>{valor}</p>
      {detalle ? <p className="mt-2 text-sm text-tinta-3">{detalle}</p> : null}
    </Tarjeta>
  );
}

function TablaMeses({ filas, primera }: { filas: FilaMes[]; primera: (f: FilaMes) => string }) {
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="num w-full min-w-[980px] text-[15px]">
        <thead>
          <tr className="text-left text-[13px] text-tinta-3">
            <th className="py-2 pr-3 font-normal">&nbsp;</th>
            {["Ventas", "Compras", "Mano de obra", "Utilidad bruta", "Gastos y personal", "Utilidad neta", "Margen neto", "Entregados"].map((t) => (
              <th key={t} className="px-3 py-2 text-right font-normal">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={`${f.mes}-${i}`} className="border-t border-regla">
              <th scope="row" className="py-2.5 pr-3 text-left font-medium whitespace-nowrap">
                {primera(f)}
                {f.parcial ? <span className="ml-1.5 text-[12px] font-normal text-tinta-3">en curso</span> : null}
              </th>
              <td className="px-3 py-2.5 text-right">{formatearSoles(f.ventas)}</td>
              <td className="px-3 py-2.5 text-right text-tinta-2">{formatearSoles(f.compras)}</td>
              <td className="px-3 py-2.5 text-right text-tinta-2">{formatearSoles(f.manoObra)}</td>
              <td className={cn("px-3 py-2.5 text-right", f.utilidad < 0 && "text-negativo")}>{formatearSoles(f.utilidad)}</td>
              <td className="px-3 py-2.5 text-right text-tinta-2">{formatearSoles(f.gastos + f.personal)}</td>
              <td className={cn("px-3 py-2.5 text-right font-medium", f.utilidadNeta < 0 && "text-negativo")}>{formatearSoles(f.utilidadNeta)}</td>
              <td className="px-3 py-2.5 text-right">{pct(f.margenNeto)}</td>
              <td className="px-3 py-2.5 text-right">{f.entregados}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function Reportes({ searchParams }: { searchParams: Promise<{ mes?: string; ambito?: string }> }) {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("gerencia")) notFound();
  const hoy = diaEnLima(new Date());
  const { mes: pedido, ambito } = await searchParams;
  const ultimos = mesesHasta(hoy.slice(0, 7), 12);
  const mes = pedido && ultimos.includes(pedido) ? pedido : hoy.slice(0, 7);
  const talleres = ctx.talleres.filter((t) => t.roles.includes("gerencia"));
  const conjunto = ambito === "todos" && talleres.length > 1;
  const alcance = conjunto ? talleres : [ctx.taller];
  const meses = mesesHasta(mes, 6);

  const porTaller = await Promise.all(
    alcance.map(async (t) => ({ taller: t, filas: await reporteMensual(t.id, meses, hoy, true), personal: await personalDelMes(t.id, mes) })),
  );
  const filasConjunto = meses.map((m, i) => sumarFilas(porTaller.map((p) => p.filas[i]), m));
  const ganancias = (await Promise.all(alcance.map((t) => gananciasDelMes(t.id, mes)))).flat();
  const actual = filasConjunto[filasConjunto.length - 1];
  const anterior = filasConjunto[filasConjunto.length - 2];
  const variacion = anterior && anterior.ventas > 0 ? (actual.ventas - anterior.ventas) / anterior.ventas : null;
  const personal = porTaller.flatMap((p) => p.personal.map((x) => ({ ...x, taller: p.taller.nombre })));
  const excel = `/reportes/excel?mes=${mes}${conjunto ? "&ambito=todos" : ""}`;
  // Encuestas de satisfacción del mes (por la fecha de respuesta).
  const supabase = await clienteServidor();
  const inicio = new Date(`${mes}-01T00:00:00-05:00`);
  const fin = new Date(new Date(inicio).setMonth(inicio.getMonth() + 1));
  const { data: encuestas } = await supabase
    .from("encuestas")
    .select("puntaje, comentario, respondida_en, ordenes_trabajo (numero, vehiculos (placa))")
    .in("empresa_id", alcance.map((t) => t.id))
    .not("respondida_en", "is", null)
    .gte("respondida_en", inicio.toISOString())
    .lt("respondida_en", fin.toISOString())
    .order("respondida_en", { ascending: false });
  const respondidas = encuestas ?? [];
  const promedio = respondidas.length ? respondidas.reduce((a, x) => a + Number(x.puntaje), 0) / respondidas.length : null;
  const contentos = respondidas.filter((x) => Number(x.puntaje) >= 4).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Reportes</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
            {conjunto ? `Todos tus talleres (${talleres.length})` : ctx.taller.nombre} · {etiquetaMes(mes)}
            {actual.parcial ? " hasta hoy" : ""}. Montos sin IGV.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ElegirMes mes={mes} meses={[...ultimos].reverse().map((m) => ({ valor: m, nombre: etiquetaMes(m) }))} ambito={conjunto ? "todos" : ""} />
          <EnlacePdf href={`/pdf/reporte/${mes}${conjunto ? "?ambito=todos" : ""}`} texto="PDF" boton className="h-12 px-5" />
          <Boton asChild>
            <a href={excel} download>
              <Download />
              Descargar Excel
            </a>
          </Boton>
        </div>
      </header>

      {talleres.length > 1 ? (
        <div className="flex gap-1 self-start rounded-full bg-hundida p-1">
          {[
            [ctx.taller.nombre, `/reportes?mes=${mes}`, !conjunto],
            ["Todos mis talleres", `/reportes?mes=${mes}&ambito=todos`, conjunto],
          ].map(([nombre, href, activo]) => (
            <Link
              key={String(href)}
              href={String(href)}
              aria-current={activo ? "page" : undefined}
              className={cn("presionable flex h-10 items-center rounded-full px-4 text-sm", activo ? "bg-tarjeta font-medium shadow-reposo" : "text-tinta-2 hover:text-tinta")}
            >
              {nombre}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
        <Kpi
          nombre="Ventas"
          valor={formatearSoles(actual.ventas)}
          detalle={variacion === null ? "Sin mes anterior para comparar" : `${variacion >= 0 ? "+" : ""}${(variacion * 100).toFixed(1)} % frente a ${etiquetaMes(anterior.mes).toLowerCase()}`}
        />
        <Kpi nombre="Utilidad bruta" valor={formatearSoles(actual.utilidad)} detalle={`Ventas − repuestos − mano de obra · margen ${pct(actual.margen)}`} negativo={actual.utilidad < 0} />
        <Kpi nombre="Gastos y personal" valor={formatearSoles(actual.gastos + actual.personal)} detalle={`Gastos del taller ${formatearSoles(actual.gastos)} · personal ${formatearSoles(actual.personal)}`} />
        <Kpi nombre="Utilidad neta" valor={formatearSoles(actual.utilidadNeta)} detalle={`Lo que realmente gana el taller · margen ${pct(actual.margenNeto)}`} negativo={actual.utilidadNeta < 0} />
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-12">
        <Tarjeta aria-labelledby="t-cuenta" className="xl:col-span-5">
          <CabeceraTarjeta id="t-cuenta" titulo="Cuenta del mes" detalle={`${etiquetaMes(mes)} · de la venta a la utilidad neta`} />
          <dl className="num flex flex-col text-[15px]">
            {(
              [
                ["Ventas", actual.ventas, "fuerte"],
                ["− Repuestos y compras", -actual.compras, ""],
                ["− Mano de obra técnica", -actual.manoObra, ""],
                ["Utilidad bruta", actual.utilidad, "fuerte"],
                ["− Gastos del taller", -actual.gastos, ""],
                ["− Sueldos del resto del personal", -(actual.personal - actual.comisiones), ""],
                ["− Comisiones", -actual.comisiones, ""],
                ["Utilidad neta", actual.utilidadNeta, "total"],
              ] as [string, number, string][]
            ).map(([nombre, valor, clase]) => (
              <div key={nombre} className={cn("flex items-baseline justify-between gap-3 border-t border-regla py-2 first:border-t-0", clase === "total" && "mt-1 rounded-2xl border-t-0 bg-interna px-3 py-3")}>
                <dt className={cn(clase ? "font-medium" : "text-tinta-2")}>{nombre}</dt>
                <dd className={cn("whitespace-nowrap", clase === "total" ? "text-[19px] font-semibold" : clase ? "font-medium" : "text-tinta-2", valor < 0 && clase && "text-negativo")}>{formatearSoles(valor)}</dd>
              </div>
            ))}
          </dl>
          {!conjunto ? (
            <p className="mt-3 text-sm text-tinta-3">
              Los gastos se registran en <Link href="/gastos" className="font-medium text-tinta underline-offset-4 hover:underline">Caja → Gastos del taller</Link>; los sueldos y comisiones, en Configuración.
            </p>
          ) : null}
        </Tarjeta>

        <Tarjeta aria-labelledby="t-carros" className="min-w-0 xl:col-span-7">
          <CabeceraTarjeta id="t-carros" titulo="Ganancia por carro" detalle={`${ganancias.length} ${ganancias.length === 1 ? "carro entregado" : "carros entregados"} en ${etiquetaMes(mes).toLowerCase()} · sin IGV`} />
          {ganancias.length ? (
            <ul className="num -mx-1 flex max-h-[520px] flex-col overflow-auto px-1 md:hidden">
              {ganancias.map((g) => (
                <li key={g.id} className="border-t border-regla py-2.5 first:border-t-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/ordenes/${g.id}`} className="font-medium underline-offset-4 hover:underline">
                      {g.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}
                    </Link>
                    <span className={cn("font-medium whitespace-nowrap", g.utilidad < 0 && "text-negativo")}>
                      {formatearSoles(g.utilidad)}
                      <span className="ml-1 text-[12px] font-normal text-tinta-3">{pct(g.margen)}</span>
                    </span>
                  </div>
                  <p className="truncate text-[12px] text-tinta-3">
                    {g.cliente ?? "—"} · {g.documento}
                  </p>
                  <p className="text-[13px] text-tinta-2">
                    Venta <span className={cn(g.venta === 0 && "text-negativo")}>{formatearSoles(g.venta)}</span> · repuestos {formatearSoles(g.repuestos)} · mano de obra {formatearSoles(g.manoObra)}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
          {ganancias.length ? (
            <div className="-mx-2 hidden max-h-[420px] overflow-auto px-2 md:block">
              <table className="num w-full min-w-[620px] text-[14px]">
                <thead className="sticky top-0 bg-tarjeta">
                  <tr className="text-left text-[13px] text-tinta-3">
                    <th className="py-2 pr-3 font-normal">Carro</th>
                    {["Venta", "Repuestos", "Mano de obra", "Utilidad"].map((t) => (
                      <th key={t} className="px-2 py-2 text-right font-normal">
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ganancias.map((g) => (
                    <tr key={g.id} className="border-t border-regla align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <Link href={`/ordenes/${g.id}`} className="font-medium underline-offset-4 hover:underline">
                          {g.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")}
                        </Link>
                        <span className="block text-[12px] text-tinta-3">
                          {g.cliente ?? "—"} · {g.documento}
                        </span>
                      </th>
                      <td className={cn("px-2 py-2 text-right", g.venta === 0 && "text-negativo")}>{formatearSoles(g.venta)}</td>
                      <td className="px-2 py-2 text-right text-tinta-2">{formatearSoles(g.repuestos)}</td>
                      <td className="px-2 py-2 text-right text-tinta-2">{formatearSoles(g.manoObra)}</td>
                      <td className={cn("px-2 py-2 text-right font-medium", g.utilidad < 0 && "text-negativo")}>
                        {formatearSoles(g.utilidad)}
                        <span className="block text-[12px] font-normal text-tinta-3">{pct(g.margen)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Todavía no hay carros entregados en {etiquetaMes(mes).toLowerCase()}.</p>
          )}
          {ganancias.some((g) => g.venta === 0) ? <p className="mt-3 text-sm text-negativo">Los que salen con venta S/ 0.00 no tienen recibo, boleta ni factura: emítelo en la orden para que cuente.</p> : null}
        </Tarjeta>
      </div>

      <Tarjeta aria-labelledby="t-meses">
        <CabeceraTarjeta id="t-meses" titulo="Mes a mes" detalle="Utilidad bruta = ventas − compras − mano de obra técnica. Utilidad neta = bruta − gastos del taller − sueldos del resto del personal − comisiones." />
        <TablaMeses filas={[...filasConjunto].reverse()} primera={(f) => etiquetaMes(f.mes)} />
      </Tarjeta>

      {conjunto ? (
        <Tarjeta aria-labelledby="t-talleres">
          <CabeceraTarjeta id="t-talleres" titulo="Por taller" detalle={etiquetaMes(mes)} />
          <TablaMeses
            filas={[...porTaller.map((p) => ({ ...p.filas[p.filas.length - 1], mes: p.taller.nombre })), { ...actual, mes: "Total" }]}
            primera={(f) => f.mes}
          />
        </Tarjeta>
      ) : null}

      <Tarjeta aria-labelledby="t-satisfaccion">
        <CabeceraTarjeta
          id="t-satisfaccion"
          titulo="Satisfacción de los clientes"
          detalle={respondidas.length ? `${respondidas.length} ${respondidas.length === 1 ? "encuesta respondida" : "encuestas respondidas"} · ${Math.round((contentos / respondidas.length) * 100)} % contentos` : "Llega por WhatsApp 3 horas después de entregar el carro, a quien aceptó mensajes."}
        />
        {respondidas.length ? (
          <div className="grid gap-4 md:grid-cols-[12rem_minmax(0,1fr)]">
            <div className="rounded-2xl bg-interna px-5 py-4">
              <p className="text-[13px] text-tinta-2">Promedio</p>
              <p className="num text-[32px] font-medium tracking-[-0.02em]">{promedio!.toFixed(1)}<span className="text-[17px] text-tinta-3"> / 5</span></p>
            </div>
            <ul className="flex flex-col">
              {respondidas.filter((x) => x.comentario || Number(x.puntaje) <= 3).slice(0, 8).map((x, i) => {
                const o = Array.isArray(x.ordenes_trabajo) ? x.ordenes_trabajo[0] : x.ordenes_trabajo;
                const v = o ? (Array.isArray(o.vehiculos) ? o.vehiculos[0] : o.vehiculos) : null;
                return (
                  <li key={i} className="border-t border-regla py-2 text-[15px] first:border-t-0">
                    <span className={Number(x.puntaje) <= 3 ? "font-medium text-negativo" : "font-medium"}>{Number(x.puntaje) >= 4 ? "Muy bien" : Number(x.puntaje) === 3 ? "Regular" : "Mal"}</span>
                    <span className="text-tinta-3"> · {v?.placa?.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2") ?? ""}</span>
                    {x.comentario ? <p className="text-tinta-2">«{x.comentario}»</p> : null}
                  </li>
                );
              })}
              {respondidas.every((x) => !x.comentario && Number(x.puntaje) > 3) ? <li className="text-[15px] text-tinta-2">Sin quejas ni comentarios este mes.</li> : null}
            </ul>
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-control px-4 py-5 text-center text-[15px] text-tinta-2">Todavía no hay encuestas respondidas en {etiquetaMes(mes)}.</p>
        )}
      </Tarjeta>

      <Tarjeta aria-labelledby="t-personal">
        <CabeceraTarjeta id="t-personal" titulo="Personal y comisiones" detalle={`${etiquetaMes(mes)} · según las reglas de Configuración`} />
        <div className="-mx-2 overflow-x-auto px-2">
          <table className="num w-full min-w-[640px] text-[15px]">
            <thead>
              <tr className="text-left text-[13px] text-tinta-3">
                <th className="py-2 pr-3 font-normal">Persona</th>
                {conjunto ? <th className="px-3 py-2 font-normal">Taller</th> : null}
                <th className="px-3 py-2 text-right font-normal">Costo mensual</th>
                <th className="px-3 py-2 text-right font-normal">Comisiones</th>
                <th className="px-3 py-2 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {personal.map((p) => {
                const reglas = new Map<string, number>();
                for (const d of p.detalle) reglas.set(d.regla, (reglas.get(d.regla) ?? 0) + d.monto);
                return (
                  <tr key={`${p.taller}-${p.id}`} className="border-t border-regla align-top">
                    <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                      <span className="block font-medium">{p.nombre}</span>
                      <span className="block text-[13px] text-tinta-3">
                        {p.roles}
                        {[...reglas].map(([r, m]) => ` · ${r}: ${formatearSoles(m)}`).join("")}
                      </span>
                    </th>
                    {conjunto ? <td className="px-3 py-2.5 text-tinta-2">{p.taller}</td> : null}
                    <td className="px-3 py-2.5 text-right">{p.costo ? formatearSoles(p.costo) : "—"}</td>
                    <td className="px-3 py-2.5 text-right">{p.comision ? formatearSoles(p.comision) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-medium">{formatearSoles(p.costo + p.comision)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </div>
  );
}
