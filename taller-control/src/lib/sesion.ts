import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clienteServidor } from "./supabase/servidor";
import { esRol, rolPrincipal, type Rol } from "./roles";

export const COOKIE_TALLER = "tc_taller";

export type TallerDeUsuario = { id: string; nombre: string; roles: Rol[] };

export type Contexto = {
  perfil: { id: string; nombre: string; celular: string };
  talleres: TallerDeUsuario[];
  taller: TallerDeUsuario;
  roles: Rol[];
  rolPrincipal: Rol;
  configuracion: { adminVeUtilidad: boolean; adminVeSueldos: boolean };
};

/**
 * Quién navega, en qué talleres trabaja y qué roles tiene en el taller elegido.
 * Todo se lee con su propia sesión: la base de datos decide qué devuelve.
 */
export const obtenerContexto = cache(async (): Promise<Contexto> => {
  const supabase = await clienteServidor();
  const { data: datosUsuario } = await supabase.auth.getUser();
  const usuario = datosUsuario.user;
  if (!usuario) redirect("/ingresar");

  const [{ data: perfil }, { data: membresias }] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, celular, activo").eq("id", usuario.id).maybeSingle(),
    supabase
      .from("miembros")
      .select("rol, empresa_id, empresas (id, nombre, activa)")
      .eq("perfil_id", usuario.id)
      .eq("activo", true),
  ]);

  if (!perfil || !perfil.activo) redirect("/ingresar?motivo=inactivo");

  const porTaller = new Map<string, TallerDeUsuario>();
  for (const fila of membresias ?? []) {
    const empresa = Array.isArray(fila.empresas) ? fila.empresas[0] : fila.empresas;
    if (!empresa || !empresa.activa || !esRol(fila.rol)) continue;
    const taller: TallerDeUsuario = porTaller.get(empresa.id) ?? { id: empresa.id, nombre: empresa.nombre, roles: [] };
    taller.roles.push(fila.rol);
    porTaller.set(empresa.id, taller);
  }
  const talleres = [...porTaller.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (talleres.length === 0) redirect("/ingresar?motivo=sin-taller");

  const elegido = (await cookies()).get(COOKIE_TALLER)?.value;
  const taller = talleres.find((t) => t.id === elegido) ?? talleres[0];

  const { data: config } = await supabase
    .from("configuracion_empresa")
    .select("admin_ve_utilidad, admin_ve_sueldos")
    .eq("empresa_id", taller.id)
    .maybeSingle();

  return {
    perfil: { id: perfil.id, nombre: perfil.nombre, celular: perfil.celular },
    talleres,
    taller,
    roles: taller.roles,
    rolPrincipal: rolPrincipal(taller.roles)!,
    configuracion: {
      adminVeUtilidad: Boolean(config?.admin_ve_utilidad),
      adminVeSueldos: Boolean(config?.admin_ve_sueldos),
    },
  };
});
