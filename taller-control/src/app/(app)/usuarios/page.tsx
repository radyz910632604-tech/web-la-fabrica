import Link from "next/link";
import { notFound } from "next/navigation";
import { formatearCelular } from "@/lib/celulares";
import { esGestor, esRol, rolesAsignables, ROLES, type Rol } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { cn } from "@/lib/utils";
import { AgregarPersona, ListaPersonal, type Pago, type Persona } from "./personal";

export const metadata = { title: "Personal" };

type Fila = {
  rol: string;
  activo: boolean;
  es_dueno: boolean;
  baja_en: string | null;
  baja_motivo: string | null;
  perfiles: PerfilCrudo | PerfilCrudo[] | null;
};
type PerfilCrudo = { id: string; nombre: string; celular: string; activo: boolean; documento: string | null; cargo: string | null; fecha_ingreso: string | null };

export default async function Usuarios({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();
  const verBajas = (await searchParams).ver === "bajas";

  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("miembros")
    .select("rol, activo, es_dueno, baja_en, baja_motivo, perfiles (id, nombre, celular, activo, documento, cargo, fecha_ingreso)")
    .eq("empresa_id", ctx.taller.id);

  const porPersona = new Map<string, Persona>();
  for (const fila of (data ?? []) as Fila[]) {
    const p = Array.isArray(fila.perfiles) ? fila.perfiles[0] : fila.perfiles;
    if (!p || !esRol(fila.rol)) continue;
    const persona = porPersona.get(p.id) ?? {
      id: p.id,
      nombre: p.nombre,
      celular: formatearCelular(p.celular),
      documento: p.documento,
      cargo: p.cargo,
      fechaIngreso: p.fecha_ingreso,
      activo: false,
      dueno: false,
      bajaEn: null,
      bajaMotivo: null,
      roles: [] as Rol[],
    };
    persona.roles.push(fila.rol);
    persona.activo ||= fila.activo && p.activo;
    persona.dueno ||= fila.es_dueno;
    persona.bajaEn ??= fila.baja_en;
    persona.bajaMotivo ??= fila.baja_motivo;
    porPersona.set(p.id, persona);
  }
  // Esquemas de pago (la base solo los muestra a gerencia y administración).
  const { data: esquemas } = await supabase
    .from("esquemas_pago")
    .select("perfil_id, tipo, monto, frecuencia, comision_pct, vigente_desde, vigente_hasta, motivo")
    .eq("empresa_id", ctx.taller.id)
    .order("vigente_desde", { ascending: false });
  const pagos = new Map<string, Pago[]>();
  for (const x of esquemas ?? []) {
    const l = pagos.get(x.perfil_id) ?? [];
    l.push({ tipo: x.tipo, monto: Number(x.monto), frecuencia: x.frecuencia, comision: x.comision_pct == null ? null : Number(x.comision_pct), desde: x.vigente_desde, hasta: x.vigente_hasta, motivo: x.motivo });
    pagos.set(x.perfil_id, l);
  }
  const todas = [...porPersona.values()].map((p) => ({
    ...p,
    roles: ROLES.filter((r) => p.roles.includes(r)),
    pago: pagos.get(p.id)?.find((x) => !x.hasta) ?? null,
    historialPago: pagos.get(p.id) ?? [],
  }));
  const activas = todas.filter((p) => p.activo).sort((a, b) => Number(b.dueno) - Number(a.dueno) || a.nombre.localeCompare(b.nombre, "es"));
  const bajas = todas.filter((p) => !p.activo).sort((a, b) => (b.bajaEn ?? "").localeCompare(a.bajaEn ?? "") || a.nombre.localeCompare(b.nombre, "es"));
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Personal</h1>
          <p className="mt-1.5 max-w-[62ch] text-[15px] text-tinta-2 md:text-base">
            {activas.length} {activas.length === 1 ? "persona con acceso" : "personas con acceso"} en {ctx.taller.nombre}. Cada una entra con su
            celular, que también la identifica por WhatsApp.
          </p>
        </div>
        <AgregarPersona asignables={rolesAsignables(ctx.roles)} hoy={new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date())} />
      </header>
      <nav aria-label="Ver" className="flex w-fit gap-1 rounded-full bg-hundida p-1">
        {(
          [
            [false, `Con acceso · ${activas.length}`, "/usuarios"],
            [true, `De baja · ${bajas.length}`, "/usuarios?ver=bajas"],
          ] as const
        ).map(([b, texto, href]) => (
          <Link
            key={href}
            href={href}
            aria-current={verBajas === b ? "page" : undefined}
            className={cn("flex h-10 items-center rounded-full px-4 text-sm font-medium", verBajas === b ? "bg-tarjeta text-tinta shadow-sm" : "text-tinta-2 hover:text-tinta")}
          >
            {texto}
          </Link>
        ))}
      </nav>
      <ListaPersonal
        personas={verBajas ? bajas : activas}
        deBaja={verBajas}
        asignables={rolesAsignables(ctx.roles)}
        yo={ctx.perfil.id}
        soyGerencia={ctx.roles.includes("gerencia")}
        hoy={hoy}
      />
    </div>
  );
}
