import type { Rol } from "../roles";
import { tieneAlguno } from "../roles";

/**
 * Qué bloques del panel ve cada rol (especificación, sección 4).
 * La base de datos hará cumplir lo mismo cuando los datos sean reales;
 * esto evita mostrar tarjetas que la base va a dejar vacías.
 * Con varios roles, se suma lo que permite cada uno.
 */

export type Indicador = "ventas" | "compras" | "utilidad" | "entregados";

export type VistaPanel = {
  destacada: "taller" | "mis_trabajos" | "citas_hoy";
  /** Botones de la tarjeta destacada. */
  acciones: { nuevoIngreso: boolean; registrarPago: boolean };
  indicadores: Indicador[];
  grafico: boolean;
  meta: boolean;
  tabla: "actividad" | "mis_trabajos" | "citas";
  columnas: { cliente: boolean; monto: boolean };
};

export function vistaPanel(roles: readonly Rol[], opciones: { adminVeUtilidad: boolean }): VistaPanel {
  const gestion = tieneAlguno(roles, ["gerencia", "administrador"]);
  const verUtilidad = roles.includes("gerencia") || (roles.includes("administrador") && opciones.adminVeUtilidad);
  const verVentas = tieneAlguno(roles, ["gerencia", "administrador", "asesor"]);
  const verCompras = tieneAlguno(roles, ["gerencia", "administrador", "asesor", "almacen"]);
  const verTaller = tieneAlguno(roles, ["gerencia", "administrador", "asesor", "almacen"]);
  const verEntregados = verTaller || roles.includes("tecnico");

  const indicadores: Indicador[] = [];
  if (verVentas) indicadores.push("ventas");
  if (verCompras) indicadores.push("compras");
  if (verUtilidad) indicadores.push("utilidad");
  if (verEntregados) indicadores.push("entregados");

  const destacada = verTaller ? "taller" : roles.includes("tecnico") ? "mis_trabajos" : "citas_hoy";
  const tabla = verTaller ? "actividad" : roles.includes("tecnico") ? "mis_trabajos" : "citas";

  return {
    destacada,
    acciones: {
      nuevoIngreso: gestion || roles.includes("asesor"),
      registrarPago: gestion || roles.includes("asesor"),
    },
    indicadores,
    // El gráfico de ventas contra costos deja ver la utilidad.
    grafico: verUtilidad,
    meta: verVentas,
    tabla,
    columnas: {
      cliente: verVentas,
      monto: verVentas,
    },
  };
}
