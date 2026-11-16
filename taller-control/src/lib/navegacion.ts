import type { Rol } from "./roles";
import { esGestor, tieneAlguno } from "./roles";

/**
 * Navegación por rol.
 * - Secciones: las pestañas píldora de arriba (en celular, una fila que se desliza).
 * - Acciones: la barra de íconos de la izquierda (en celular, la barra inferior).
 *   Son las tareas de un toque de cada rol.
 * `listo` dice si la pantalla ya existe; si no, lleva a /pronto con la fase en que llega.
 */

export type Icono =
  | "panel"
  | "ordenes"
  | "citas"
  | "clientes"
  | "reportes"
  | "compras"
  | "nuevo-ingreso"
  | "pago"
  | "agendar"
  | "avance"
  | "fotos"
  | "repuesto"
  | "confirmar"
  | "usuarios"
  | "configuracion";

export type Destino = {
  clave: string;
  nombre: string;
  /** Nombre corto para la barra inferior del celular. */
  corto: string;
  href: string;
  icono: Icono;
  llega?: string;
};

const pronto = (clave: string) => `/pronto/${clave}`;

const SECCIONES: (Destino & { roles: readonly Rol[] })[] = [
  { clave: "panel", nombre: "Panel", corto: "Panel", href: "/", icono: "panel", roles: ["gerencia", "administrador", "asesor", "tecnico", "almacen", "vendedor_redes", "confirmador"] },
  { clave: "ordenes", nombre: "Órdenes", corto: "Órdenes", href: pronto("ordenes"), icono: "ordenes", llega: "Entrega 1B", roles: ["gerencia", "administrador", "asesor", "almacen"] },
  { clave: "mis-trabajos", nombre: "Mis trabajos", corto: "Trabajos", href: pronto("mis-trabajos"), icono: "ordenes", llega: "Entrega 1B", roles: ["tecnico"] },
  { clave: "citas", nombre: "Citas", corto: "Citas", href: pronto("citas"), icono: "citas", llega: "Entrega 1B", roles: ["gerencia", "administrador", "asesor", "vendedor_redes", "confirmador"] },
  { clave: "clientes", nombre: "Clientes", corto: "Clientes", href: pronto("clientes"), icono: "clientes", llega: "Entrega 1B", roles: ["gerencia", "administrador", "asesor", "vendedor_redes"] },
  { clave: "compras", nombre: "Compras", corto: "Compras", href: pronto("compras"), icono: "compras", llega: "Fase 3", roles: ["almacen"] },
  { clave: "reportes", nombre: "Reportes", corto: "Reportes", href: pronto("reportes"), icono: "reportes", llega: "Fase 5", roles: ["gerencia"] },
];

const ACCIONES: (Destino & { roles: readonly Rol[] })[] = [
  { clave: "nuevo-ingreso", nombre: "Nuevo ingreso", corto: "Ingreso", href: pronto("nuevo-ingreso"), icono: "nuevo-ingreso", llega: "Entrega 1B", roles: ["gerencia", "administrador", "asesor"] },
  { clave: "registrar-pago", nombre: "Registrar pago", corto: "Pago", href: pronto("registrar-pago"), icono: "pago", llega: "Fase 4", roles: ["gerencia", "administrador", "asesor"] },
  { clave: "agendar-cita", nombre: "Agendar cita", corto: "Cita", href: pronto("agendar-cita"), icono: "agendar", llega: "Entrega 1B", roles: ["asesor", "vendedor_redes"] },
  { clave: "confirmar-citas", nombre: "Confirmar citas", corto: "Confirmar", href: pronto("confirmar-citas"), icono: "confirmar", llega: "Entrega 1B", roles: ["confirmador"] },
  { clave: "reportar-avance", nombre: "Reportar avance", corto: "Avance", href: pronto("reportar-avance"), icono: "avance", llega: "Entrega 1B", roles: ["tecnico"] },
  { clave: "subir-fotos", nombre: "Subir fotos", corto: "Fotos", href: pronto("subir-fotos"), icono: "fotos", llega: "Entrega 1B", roles: ["tecnico"] },
  { clave: "registrar-compra", nombre: "Registrar compra", corto: "Compra", href: pronto("registrar-compra"), icono: "compras", llega: "Fase 3", roles: ["almacen"] },
  { clave: "entregar-repuesto", nombre: "Entregar repuesto", corto: "Repuesto", href: pronto("entregar-repuesto"), icono: "repuesto", llega: "Fase 3", roles: ["almacen"] },
];

const GESTION: Destino[] = [
  { clave: "usuarios", nombre: "Personal y roles", corto: "Personal", href: "/usuarios", icono: "usuarios" },
  { clave: "configuracion", nombre: "Configuración del taller", corto: "Ajustes", href: "/configuracion", icono: "configuracion" },
];

const sinRoles = (d: Destino & { roles: readonly Rol[] }): Destino => ({
  clave: d.clave,
  nombre: d.nombre,
  corto: d.corto,
  href: d.href,
  icono: d.icono,
  llega: d.llega,
});

export function seccionesPara(roles: readonly Rol[]): Destino[] {
  return SECCIONES.filter((s) => tieneAlguno(roles, s.roles)).map(sinRoles);
}

export function accionesPara(roles: readonly Rol[]): Destino[] {
  return ACCIONES.filter((a) => tieneAlguno(roles, a.roles)).map(sinRoles);
}

export function gestionPara(roles: readonly Rol[]): Destino[] {
  return esGestor(roles) ? GESTION : [];
}

/** Todo destino conocido, para la página /pronto. */
export function destinoPorClave(clave: string): Destino | undefined {
  return [...SECCIONES, ...ACCIONES].map(sinRoles).find((d) => d.clave === clave);
}
