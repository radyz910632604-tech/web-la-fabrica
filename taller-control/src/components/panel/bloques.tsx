import { Placa } from "@/components/marca/placa";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearMomento, formatearSoles } from "@/lib/formato";
import type { OrdenEjemplo } from "@/lib/panel/ejemplo";

/** Meta de ventas del mes: barra con la proporción real y ambos extremos rotulados. */
export function MetaVentas({
  vendido,
  meta,
  mes,
  diasRestantes,
  diasTranscurridos,
  conRitmo = false,
}: {
  vendido: number;
  meta: number;
  mes: string;
  diasRestantes: number;
  diasTranscurridos: number;
  conRitmo?: boolean;
}) {
  const proporcion = meta > 0 ? Math.min(vendido / meta, 1) : 0;
  const pct = Math.round(proporcion * 100);
  const falta = Math.max(meta - vendido, 0);
  return (
    <Tarjeta aria-labelledby="titulo-meta">
      <CabeceraTarjeta id="titulo-meta" titulo={`Meta de ventas de ${mes}`} detalle="Sin IGV" />
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={meta}
        aria-valuenow={vendido}
        aria-valuetext={`${formatearSoles(vendido, { sinDecimales: true })} de ${formatearSoles(meta, { sinDecimales: true })}, ${pct} %`}
        className="trama-gris h-4 w-full overflow-hidden rounded-full bg-interna"
      >
        <div className="h-full rounded-full bg-acento" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3 text-sm">
        <p>
          <span className="num font-semibold text-tinta">{formatearSoles(vendido, { sinDecimales: true })}</span>{" "}
          <span className="text-tinta-3">vendido</span>
        </p>
        <p className="num text-tinta-3">{formatearSoles(meta, { sinDecimales: true })}</p>
      </div>
      <p className="mt-3 text-sm text-tinta-2">
        Van <span className="num font-medium text-tinta">{pct} %</span>. Faltan{" "}
        <span className="num font-medium text-tinta">{formatearSoles(falta, { sinDecimales: true })}</span> en{" "}
        {diasRestantes} {diasRestantes === 1 ? "día" : "días"}.
      </p>
      {conRitmo ? (
        <dl className="mt-4 rounded-2xl bg-interna px-4 py-1 text-sm">
          <div className="flex items-center justify-between gap-3 border-b border-borde py-2.5">
            <dt className="text-tinta-2">Vendido por día, hasta hoy</dt>
            <dd className="num font-medium">{formatearSoles(vendido / Math.max(diasTranscurridos, 1), { sinDecimales: true })}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-tinta-2">Por día para llegar a la meta</dt>
            <dd className="num font-medium">{formatearSoles(falta / Math.max(diasRestantes, 1), { sinDecimales: true })}</dd>
          </div>
        </dl>
      ) : null}
    </Tarjeta>
  );
}

type Grupo = { titulo: string; vacio: string; ordenes: (OrdenEjemplo & { momento: Date })[] };

/**
 * Lo que hay que mover ahora: carros listos que esperan al cliente y carros
 * parados por un repuesto. Con un solo grupo, su nombre es el título.
 */
export function PorAtender({ titulo, detalle, grupos, verCliente }: { titulo: string; detalle: string; grupos: Grupo[]; verCliente: boolean }) {
  const id = `titulo-${titulo.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <Tarjeta aria-labelledby={id}>
      <CabeceraTarjeta id={id} titulo={titulo} detalle={detalle} />
      <div className="flex flex-col gap-4">
        {grupos.map((g) => (
          <div key={g.titulo}>
            {grupos.length > 1 ? (
              <h3 className="mb-2 text-sm font-medium text-tinta-2">
                {g.titulo} <span className="num text-tinta-3">· {g.ordenes.length}</span>
              </h3>
            ) : null}
            {g.ordenes.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-control px-4 py-3 text-sm text-tinta-2">{g.vacio}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {g.ordenes.map((o) => (
                  <li key={o.numero} className="flex items-center gap-3 rounded-2xl bg-interna px-3 py-2.5">
                    <Placa placa={o.placa} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] leading-5 font-medium">{verCliente ? o.cliente : o.servicio}</p>
                      <p className="truncate text-[13px] leading-5 text-tinta-3">{verCliente ? o.servicio : o.numero}</p>
                    </div>
                    <p className="num shrink-0 text-right text-[13px] text-tinta-3">{formatearMomento(o.momento)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Tarjeta>
  );
}

/** Citas de hoy por red social: cuántas hay y cuántas ya llegaron. */
export function CitasPorRed({ citas }: { citas: { red: string; estado: string }[] }) {
  const redes = [...new Set(citas.map((c) => c.red))]
    .map((red) => {
      const deRed = citas.filter((c) => c.red === red);
      return { red, total: deRed.length, llegaron: deRed.filter((c) => c.estado === "llego").length };
    })
    .sort((a, b) => b.total - a.total || a.red.localeCompare(b.red, "es"));
  return (
    <Tarjeta aria-labelledby="titulo-por-red">
      <CabeceraTarjeta id="titulo-por-red" titulo="Por red social" detalle="Citas de hoy y cuántas llegaron" />
      <dl className="rounded-2xl bg-interna px-4 py-1 text-[15px]">
        {redes.map((r) => (
          <div key={r.red} className="flex items-center justify-between gap-3 border-b border-borde py-3 last:border-b-0">
            <dt>{r.red}</dt>
            <dd className="num text-tinta-2">
              <span className="font-medium text-tinta">{r.total}</span> {r.total === 1 ? "cita" : "citas"} · {r.llegaron}{" "}
              {r.llegaron === 1 ? "llegó" : "llegaron"}
            </dd>
          </div>
        ))}
      </dl>
    </Tarjeta>
  );
}
