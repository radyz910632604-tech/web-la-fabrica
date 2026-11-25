import { notFound } from "next/navigation";
import { TituloCaja } from "@/components/caja/subnav";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { Importador } from "./importador";

export const metadata = { title: "Importar datos" };

/** Pasar al sistema lo que el taller tenía en Excel (gerencia y administración). */
export default async function Importar() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja titulo="Importar datos" detalle={`Pasa a ${ctx.taller.nombre} lo que tenías en Excel: clientes y carros, repuestos y gastos.`} />
      <Importador />
    </div>
  );
}
