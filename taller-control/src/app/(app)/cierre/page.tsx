import { notFound } from "next/navigation";
import { CircleCheck, TriangleExclamationPoint } from "lucide-react";
import { SubnavCaja, TituloCaja } from "@/components/caja/subnav";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { MEDIOS, type MedioPago } from "@/lib/dinero";
import { diaEnLima, formatearSoles } from "@/lib/formato";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cierreDelDia } from "@/lib/taller/cierre-consultas";
import { nombresPersonal } from "@/lib/taller/consultas";
import { cn } from "@/lib/utils";
import { CerrarDia, ElegirDia } from "./controles";

export const metadata = { title: "Cierre del día" };

function Fila({ nombre, valor, fuerte, tenue }: { nombre: string; valor: number; fuerte?: boolean; tenue?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1.5", fuerte && "border-t border-regla pt-2.5 text-[17px] font-semibold", tenue && "text-tinta-2")}>
      <dt>{nombre}</dt>
      <dd className="num">{formatearSoles(valor)}</dd>
    </div>
  );
}

export default async function Cierre({ searchParams }: { searchParams: Promise<{ dia?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) notFound();
  const hoy = diaEnLima(new Date());
  const { dia: pedido } = await searchParams;
  const dia = pedido && /^\d{4}-\d{2}-\d{2}$/.test(pedido) && pedido <= hoy ? pedido : hoy;
  const verUtilidad = ctx.roles.includes("gerencia");
  const supabase = await clienteServidor();
  const [c, { data: cerrado }, nombres] = await Promise.all([
    cierreDelDia(ctx.taller.id, dia, verUtilidad),
    supabase.from("cierres_diarios").select("cerrado_por, cerrado_en, observaciones").eq("empresa_id", ctx.taller.id).eq("fecha", dia).maybeSingle(),
    nombresPersonal(ctx.taller.id),
  ]);
  const vendido = c.boletas.total + c.facturas.total;
  const fecha = new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Cierre del día"
        detalle={`${fecha.charAt(0).toUpperCase()}${fecha.slice(1)} · ${c.entregadas} ${c.entregadas === 1 ? "carro entregado" : "carros entregados"} · vendido ${formatearSoles(vendido)} · cobrado ${formatearSoles(c.cobros.total)}`}
        accion={
          <div className="flex flex-wrap items-center gap-3">
            <ElegirDia dia={dia} hoy={hoy} />
            {cerrado ? null : <CerrarDia dia={dia} descuadres={c.descuadres.length} />}
          </div>
        }
      />
      <SubnavCaja actual="/cierre" roles={ctx.roles} />
      {cerrado ? (
        <p className="flex items-start gap-2 rounded-2xl bg-positivo-fondo px-4 py-3 text-[15px] text-positivo">
          <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            Día cerrado por {nombres.get(cerrado.cerrado_por ?? "") ?? "alguien del taller"} a las{" "}
            {new Intl.DateTimeFormat("es-PE", { hour: "numeric", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(cerrado.cerrado_en))}.
            {cerrado.observaciones ? ` «${cerrado.observaciones}»` : ""}
          </span>
        </p>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        <Tarjeta aria-labelledby="t-ventas">
          <CabeceraTarjeta id="t-ventas" titulo="Ventas" detalle="Comprobantes emitidos este día" />
          <dl className="text-[15px]">
            <Fila nombre={`Boletas (${c.boletas.cantidad})`} valor={c.boletas.total} />
            <Fila nombre="  sin IGV" valor={c.boletas.sinIgv} tenue />
            <Fila nombre={`Facturas (${c.facturas.cantidad})`} valor={c.facturas.total} />
            <Fila nombre="  sin IGV" valor={c.facturas.sinIgv} tenue />
            <Fila nombre="IGV de ventas" valor={c.boletas.igv + c.facturas.igv} tenue />
            <Fila nombre="Total vendido" valor={vendido} fuerte />
          </dl>
        </Tarjeta>
        <Tarjeta aria-labelledby="t-cobros">
          <CabeceraTarjeta id="t-cobros" titulo="Cobros" detalle="Lo que entró a caja, por medio de pago" />
          <dl className="text-[15px]">
            {(Object.keys(MEDIOS) as MedioPago[]).map((m) => (
              <Fila key={m} nombre={MEDIOS[m]} valor={c.cobros[m]} tenue={c.cobros[m] === 0} />
            ))}
            <Fila nombre="Total cobrado" valor={c.cobros.total} fuerte />
          </dl>
        </Tarjeta>
        <Tarjeta aria-labelledby="t-compras-dia" className="md:col-span-2 xl:col-span-1">
          <CabeceraTarjeta id="t-compras-dia" titulo={verUtilidad ? "Compras y utilidad" : "Compras"} detalle={verUtilidad ? "Sin IGV, estimada" : `${c.compras.cantidad} ${c.compras.cantidad === 1 ? "compra" : "compras"}`} />
          <dl className="text-[15px]">
            <Fila nombre={`Compras (${c.compras.cantidad})`} valor={c.compras.total} />
            <Fila nombre="  sin IGV" valor={c.compras.sinIgv} tenue />
            {verUtilidad ? (
              <>
                <Fila nombre="Ventas sin IGV" valor={c.boletas.sinIgv + c.facturas.sinIgv} />
                <Fila nombre="Mano de obra del día" valor={-c.manoObra} tenue />
                <Fila nombre="Utilidad estimada" valor={c.utilidadEstimada} fuerte />
              </>
            ) : null}
          </dl>
        </Tarjeta>
      </div>

      <Tarjeta aria-labelledby="t-cuadre">
        <CabeceraTarjeta id="t-cuadre" titulo="Lo que no cuadra" />
        {c.descuadres.length === 0 ? (
          <p className="flex items-center gap-2 text-[15px] text-positivo">
            <CircleCheck className="size-5" aria-hidden />
            Todo cuadra: lo vendido es lo cobrado y cada entrega tiene su comprobante.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {c.descuadres.map((d) => (
              <li key={d} className="flex items-start gap-2.5 rounded-2xl bg-aviso-fondo px-4 py-3 text-[15px]">
                <TriangleExclamationPoint className="mt-0.5 size-5 shrink-0 text-aviso" aria-hidden />
                {d}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
