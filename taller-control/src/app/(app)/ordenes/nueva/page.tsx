import { notFound } from "next/navigation";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogo, personalConRol } from "@/lib/taller/consultas";
import { FormularioIngreso } from "./formulario";

export const metadata = { title: "Nuevo ingreso" };

export default async function NuevoIngreso({ searchParams }: { searchParams: Promise<{ cita?: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) notFound();
  const { cita: citaId } = await searchParams;

  const [servicios, tecnicos, cita] = await Promise.all([
    catalogo(ctx.taller.id),
    personalConRol(ctx.taller.id, "tecnico"),
    citaId
      ? clienteServidor().then((s) =>
          s.from("citas").select("id, nombre_cliente, celular, servicio").eq("id", citaId).eq("empresa_id", ctx.taller.id).maybeSingle(),
        )
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Nuevo ingreso</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
          Empieza por la placa. Si el carro ya vino antes, sus datos y los del dueño se completan solos.
        </p>
      </header>
      <FormularioIngreso
        ahora={new Date().toISOString()}
        servicios={servicios.map((s) => ({ id: s.id, nombre: s.nombre }))}
        tecnicos={tecnicos}
        cita={
          cita.data
            ? { id: cita.data.id, nombre: cita.data.nombre_cliente, celular: cita.data.celular, servicio: cita.data.servicio }
            : null
        }
      />
    </div>
  );
}
