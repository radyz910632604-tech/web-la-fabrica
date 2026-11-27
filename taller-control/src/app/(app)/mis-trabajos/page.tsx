import { notFound } from "next/navigation";
import { ListaOrdenes } from "@/components/taller/lista-ordenes";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { obtenerContexto } from "@/lib/sesion";
import { listarOrdenes } from "@/lib/taller/consultas";
import { ESTADOS_ABIERTOS } from "@/lib/taller/estados";

export const metadata = { title: "Mis trabajos" };

export default async function MisTrabajos() {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("tecnico")) notFound();
  const [activas, entregadas] = await Promise.all([
    listarOrdenes(ctx.taller.id, { tecnicoId: ctx.perfil.id, estados: [...ESTADOS_ABIERTOS], orden: "ingreso" }),
    listarOrdenes(ctx.taller.id, { tecnicoId: ctx.perfil.id, estados: ["entregado"], limite: 10 }),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Mis trabajos</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
          Toca un carro para cambiar su estado, reportar un avance o subir fotos.
        </p>
      </header>
      <Tarjeta aria-labelledby="t-activos">
        <CabeceraTarjeta id="t-activos" titulo="En el taller" detalle={`${activas.length} ${activas.length === 1 ? "carro asignado" : "carros asignados"}`} />
        <ListaOrdenes ordenes={activas} verCliente={false} verTecnico={false} fecha="ingreso" minutosAviso={ctx.configuracion.minutosAvisoEntrega} vacio="No tienes carros asignados ahora." />
      </Tarjeta>
      <Tarjeta aria-labelledby="t-entregados">
        <CabeceraTarjeta id="t-entregados" titulo="Entregados hace poco" />
        <ListaOrdenes ordenes={entregadas} verCliente={false} verTecnico={false} vacio="Todavía no entregaste carros." />
      </Tarjeta>
    </div>
  );
}
