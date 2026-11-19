/**
 * Roles del sistema (los mismos valores que el tipo rol_t de la base de datos).
 * La base de datos es la que hace cumplir los permisos; aquí solo se decide
 * qué se muestra, para no ofrecer botones que la base va a rechazar.
 */

export const ROLES = [
  "gerencia",
  "administrador",
  "asesor",
  "recepcion",
  "tecnico",
  "almacen",
  "vendedor_redes",
  "confirmador",
] as const;

export type Rol = (typeof ROLES)[number];

export const NOMBRE_ROL: Record<Rol, string> = {
  gerencia: "Gerencia",
  administrador: "Administración",
  asesor: "Asesor de servicio",
  recepcion: "Recepción y caja",
  tecnico: "Técnico",
  almacen: "Almacén",
  vendedor_redes: "Ventas por redes",
  confirmador: "Confirmación de citas",
};

export function esRol(valor: string): valor is Rol {
  return (ROLES as readonly string[]).includes(valor);
}

export function tieneAlguno(roles: readonly Rol[], buscados: readonly Rol[]): boolean {
  return roles.some((rol) => buscados.includes(rol));
}

/** Quienes manejan la caja: cobran, registran comprobantes y cierran el día. */
export const CAJA: readonly Rol[] = ["gerencia", "administrador", "asesor", "recepcion"];

/** Gerencia o administración: crean usuarios, asignan roles, configuran. */
export function esGestor(roles: readonly Rol[]): boolean {
  return tieneAlguno(roles, ["gerencia", "administrador"]);
}

/** Roles que esta persona puede asignar a otras. */
export function rolesAsignables(roles: readonly Rol[]): Rol[] {
  if (roles.includes("gerencia")) return [...ROLES];
  if (roles.includes("administrador")) return ROLES.filter((r) => r !== "gerencia");
  return [];
}

/** El rol que se muestra primero (el de más alcance). */
export function rolPrincipal(roles: readonly Rol[]): Rol | undefined {
  return ROLES.find((rol) => roles.includes(rol));
}
