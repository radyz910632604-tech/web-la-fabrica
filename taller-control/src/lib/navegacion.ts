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
  | "caja"
  | "caja-dia"
  | "comprobante"
  | "compras"
  | "inventario"
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

const SECCIONES: (Destino & { roles: readonly Rol[] })[] = [
  { clave: "panel", nombre: "Panel", corto: "Panel", href: "/", icono: "panel", roles: ["gerencia", "administrador", "asesor", "recepcion", "tecnico", "almacen", "vendedor_redes", "confirmador"] },
  { clave: "ordenes", nombre: "Órdenes", corto: "Órdenes", href: "/ordenes", icono: "ordenes", roles: ["gerencia", "administrador", "asesor", "almacen", "recepcion"] },
  { clave: "mis-trabajos", nombre: "Mis trabajos", corto: "Trabajos", href: "/mis-trabajos", icono: "ordenes", roles: ["tecnico"] },
  { clave: "citas", nombre: "Citas", corto: "Citas", href: "/citas", icono: "citas", roles: ["gerencia", "administrador", "asesor", "vendedor_redes", "confirmador"] },
  { clave: "clientes", nombre: "Clientes", corto: "Clientes", href: "/clientes", icono: "clientes", roles: ["gerencia", "administrador", "asesor", "vendedor_redes", "recepcion"] },
  { clave: "caja", nombre: "Caja", corto: "Caja", href: "/caja", icono: "caja", roles: ["gerencia", "administrador", "asesor", "recepcion"] },
  { clave: "compras", nombre: "Compras", corto: "Compras", href: "/compras", icono: "compras", roles: ["almacen"] },
  { clave: "inventario", nombre: "Inventario", corto: "Inventario", href: "/inventario", icono: "inventario", roles: ["gerencia", "administrador", "asesor", "almacen"] },
  { clave: "reportes", nombre: "Reportes", corto: "Reportes", href: "/reportes", icono: "reportes", roles: ["gerencia"] },
];

const ACCIONES: (Destino & { roles: readonly Rol[] })[] = [
  { clave: "nuevo-ingreso", nombre: "Nuevo ingreso", corto: "Ingreso", href: "/ordenes/nueva", icono: "nuevo-ingreso", roles: ["gerencia", "administrador", "asesor"] },
  { clave: "registrar-pago", nombre: "Registrar pago", corto: "Pago", href: "/cobros?nuevo=1", icono: "pago", roles: ["gerencia", "administrador", "asesor", "recepcion"] },
  { clave: "caja-del-dia", nombre: "Abrir o cerrar caja", corto: "Caja", href: "/caja", icono: "caja-dia", roles: ["recepcion"] },
  { clave: "registrar-comprobante", nombre: "Registrar comprobante", corto: "Boleta", href: "/ventas?nuevo=1", icono: "comprobante", roles: ["recepcion"] },
  { clave: "agendar-cita", nombre: "Agendar cita", corto: "Cita", href: "/citas?agendar=1", icono: "agendar", roles: ["asesor", "vendedor_redes"] },
  { clave: "confirmar-citas", nombre: "Confirmar citas", corto: "Confirmar", href: "/citas", icono: "confirmar", roles: ["confirmador"] },
  { clave: "reportar-avance", nombre: "Reportar avance", corto: "Avance", href: "/mis-trabajos", icono: "avance", roles: ["tecnico"] },
  { clave: "subir-fotos", nombre: "Subir fotos", corto: "Fotos", href: "/mis-trabajos", icono: "fotos", roles: ["tecnico"] },
  { clave: "registrar-compra", nombre: "Registrar compra", corto: "Compra", href: "/compras/nueva", icono: "compras", roles: ["almacen"] },
  { clave: "entregar-repuesto", nombre: "Entregar repuesto", corto: "Repuesto", href: "/inventario", icono: "repuesto", roles: ["almacen"] },
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
