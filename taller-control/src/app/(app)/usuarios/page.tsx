import { notFound } from "next/navigation";
import { formatearCelular } from "@/lib/celulares";
import { esGestor, esRol, rolesAsignables, ROLES, type Rol } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { AgregarPersona, ListaPersonal, type Persona } from "./personal";

export const metadata = { title: "Personal y roles" };

export default async function Usuarios() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();

  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("miembros")
    .select("rol, perfiles (id, nombre, celular, activo)")
    .eq("empresa_id", ctx.taller.id);

  const porPersona = new Map<string, Persona>();
  for (const fila of data ?? []) {
    const p = Array.isArray(fila.perfiles) ? fila.perfiles[0] : fila.perfiles;
    if (!p || !esRol(fila.rol)) continue;
    const persona = porPersona.get(p.id) ?? {
      id: p.id,
      nombre: p.nombre,
      celular: formatearCelular(p.celular),
      activo: p.activo,
      roles: [] as Rol[],
    };
    persona.roles.push(fila.rol);
    porPersona.set(p.id, persona);
  }
  const personas = [...porPersona.values()]
    .map((p) => ({ ...p, roles: ROLES.filter((r) => p.roles.includes(r)) }))
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre.localeCompare(b.nombre, "es"));

  const asignables = rolesAsignables(ctx.roles);
  const activas = personas.filter((p) => p.activo).length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Personal y roles</h1>
          <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
            {activas} {activas === 1 ? "persona con acceso" : "personas con acceso"} en {ctx.taller.nombre}. Cada una entra con su
            celular, que también la identifica por WhatsApp.
          </p>
        </div>
        <AgregarPersona asignables={asignables} />
      </header>
      <ListaPersonal
        personas={personas}
        asignables={asignables}
        yo={ctx.perfil.id}
        soyGerencia={ctx.roles.includes("gerencia")}
      />
    </div>
  );
}
