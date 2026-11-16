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
  configuracion: { adminVeUtilidad: boolean; adminVeSueldos: boolean; minutosAvisoEntrega: number };
};

/**
 * Quién navega, en qué talleres trabaja y qué roles tiene en el taller elegido.
 * Todo se lee con su propia sesión: la base de datos decide qué devuelve.
 */
export const obtenerContexto = cache(async (): Promise<Contexto> => {
  const supabase = await clienteServidor();
  // getClaims valida la firma de la sesión. Con llaves de firma asimétricas (Supabase → JWT Keys)
  // lo hace aquí mismo, sin viajar a Supabase; con la llave antigua consulta a Supabase como antes.
  const { data: datosSesion } = await supabase.auth.getClaims();
  const usuarioId = datosSesion?.claims?.sub;
  if (!usuarioId) redirect("/ingresar");

  const [{ data: perfil }, { data: membresias }] = await Promise.all([
    supabase.from("perfiles").select("id, nombre, celular, activo").eq("id", usuarioId).maybeSingle(),
    supabase
      .from("miembros")
      // La configuración del taller viene en la misma consulta: una ida a la base menos por página.
      .select("rol, empresa_id, empresas (id, nombre, activa, configuracion_empresa (admin_ve_utilidad, admin_ve_sueldos, minutos_aviso_entrega))")
      .eq("perfil_id", usuarioId)
      .eq("activo", true),
  ]);

  if (!perfil || !perfil.activo) redirect("/ingresar?motivo=inactivo");

  type Config = { admin_ve_utilidad: boolean; admin_ve_sueldos: boolean; minutos_aviso_entrega: number };
  const configPorTaller = new Map<string, Config | undefined>();
  const porTaller = new Map<string, TallerDeUsuario>();
  for (const fila of membresias ?? []) {
    const empresa = Array.isArray(fila.empresas) ? fila.empresas[0] : fila.empresas;
    if (!empresa || !empresa.activa || !esRol(fila.rol)) continue;
    const cfg = empresa.configuracion_empresa as Config | Config[] | null;
    configPorTaller.set(empresa.id, (Array.isArray(cfg) ? cfg[0] : cfg) ?? undefined);
    const taller: TallerDeUsuario = porTaller.get(empresa.id) ?? { id: empresa.id, nombre: empresa.nombre, roles: [] };
    taller.roles.push(fila.rol);
    porTaller.set(empresa.id, taller);
  }
  const talleres = [...porTaller.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  if (talleres.length === 0) redirect("/ingresar?motivo=sin-taller");

  const elegido = (await cookies()).get(COOKIE_TALLER)?.value;
  const taller = talleres.find((t) => t.id === elegido) ?? talleres[0];

  const config = configPorTaller.get(taller.id);

  return {
    perfil: { id: perfil.id, nombre: perfil.nombre, celular: perfil.celular },
    talleres,
    taller,
    roles: taller.roles,
    rolPrincipal: rolPrincipal(taller.roles)!,
    configuracion: {
      adminVeUtilidad: Boolean(config?.admin_ve_utilidad),
      adminVeSueldos: Boolean(config?.admin_ve_sueldos),
      minutosAvisoEntrega: config?.minutos_aviso_entrega ?? 120,
    },
  };
});
