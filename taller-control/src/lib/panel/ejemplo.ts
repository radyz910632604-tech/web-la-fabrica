/**
 * DATOS DE EJEMPLO del panel (Entrega 1A).
 *
 * Todo lo de aquí es ficticio y se reemplaza por datos reales:
 *  - carros, órdenes y citas → Entrega 1B
 *  - ventas, compras, utilidad → Fase 3
 * Los totales se calculan de las filas; nunca se escriben a mano.
 * Las fechas se generan relativas a "ahora" para que "Hoy" tenga sentido.
 */

import { diaEnLima, ZONA } from "../formato";

export type EstadoOrden = "en_taller" | "en_proceso" | "esperando_repuesto" | "listo" | "entregado";

export const NOMBRE_ESTADO: Record<EstadoOrden, string> = {
  en_taller: "En taller",
  en_proceso: "En proceso",
  esperando_repuesto: "Espera repuesto",
  listo: "Listo",
  entregado: "Entregado",
};

/** Color del punto de estado (especificación: verde completado, amarillo en proceso, rojo pendiente). */
export const COLOR_ESTADO: Record<EstadoOrden, "gris" | "amarillo" | "rojo" | "verde"> = {
  en_taller: "gris",
  en_proceso: "amarillo",
  esperando_repuesto: "rojo",
  listo: "verde",
  entregado: "verde",
};

export type OrdenEjemplo = {
  numero: string;
  placa: string;
  cliente: string;
  servicio: string;
  /** Lo que paga el cliente, con IGV. */
  montoTotal: number;
  estado: EstadoOrden;
  tecnico: string;
  /** Último cambio, en minutos antes de "ahora". */
  hace: number;
};

export type EstadoCita = "agendada" | "confirmada" | "llego" | "no_llego";

export const NOMBRE_ESTADO_CITA: Record<EstadoCita, string> = {
  agendada: "Por confirmar",
  confirmada: "Confirmada",
  llego: "Llegó",
  no_llego: "No llegó",
};

export const COLOR_ESTADO_CITA: Record<EstadoCita, "gris" | "amarillo" | "rojo" | "verde"> = {
  agendada: "amarillo",
  confirmada: "gris",
  llego: "verde",
  no_llego: "rojo",
};

export type CitaEjemplo = {
  hora: string;
  cliente: string;
  servicio: string;
  red: string;
  estado: EstadoCita;
};

export type MesEjemplo = {
  etiqueta: string;
  ventas: number;
  compras: number;
  manoObra: number;
  entregados: number;
};

// ---------------------------------------------------------------------
// Órdenes: las 14 que están en el taller y las últimas entregadas.
// ---------------------------------------------------------------------
const ORDENES: OrdenEjemplo[] = [
  { numero: "OT-000412", placa: "BKR-472", cliente: "María Chávez", servicio: "Mantenimiento de caja automática", montoTotal: 2850, estado: "listo", tecnico: "Luis Quispe", hace: 18 },
  { numero: "OT-000411", placa: "F7Q-315", cliente: "José Ramírez", servicio: "Conversión a GNV", montoTotal: 3900, estado: "en_proceso", tecnico: "Luis Quispe", hace: 42 },
  { numero: "OT-000410", placa: "AXM-208", cliente: "Lucía Fernández", servicio: "Cambio de pastillas de freno", montoTotal: 320, estado: "entregado", tecnico: "Ernesto Lara", hace: 65 },
  { numero: "OT-000409", placa: "C3T-764", cliente: "Carlos Gutiérrez", servicio: "Diagnóstico de caja CVT", montoTotal: 180, estado: "esperando_repuesto", tecnico: "Ernesto Lara", hace: 96 },
  { numero: "OT-000408", placa: "BDL-951", cliente: "Ana Flores", servicio: "Carga de aire acondicionado", montoTotal: 250, estado: "en_proceso", tecnico: "Luis Quispe", hace: 130 },
  { numero: "OT-000407", placa: "V2P-086", cliente: "Miguel Castillo", servicio: "Revisión anual de GNV", montoTotal: 220, estado: "listo", tecnico: "Ernesto Lara", hace: 175 },
  { numero: "OT-000406", placa: "ANS-639", cliente: "Rocío Sánchez", servicio: "Cambio de aceite y filtro", montoTotal: 185, estado: "entregado", tecnico: "Luis Quispe", hace: 210 },
  { numero: "OT-000405", placa: "D9K-520", cliente: "Javier Ruiz", servicio: "Reparación de embrague", montoTotal: 1450, estado: "en_taller", tecnico: "Ernesto Lara", hace: 245 },
  { numero: "OT-000404", placa: "BHT-317", cliente: "Patricia Díaz", servicio: "Revisión de GLP", montoTotal: 160, estado: "en_proceso", tecnico: "Luis Quispe", hace: 300 },
  { numero: "OT-000403", placa: "AFW-842", cliente: "Fernando Ríos", servicio: "Mantenimiento de caja automática", montoTotal: 2650, estado: "esperando_repuesto", tecnico: "Ernesto Lara", hace: 1260 },
  { numero: "OT-000402", placa: "Z4M-193", cliente: "Elena Vargas", servicio: "Rectificado de discos", montoTotal: 280, estado: "en_proceso", tecnico: "Luis Quispe", hace: 1330 },
  { numero: "OT-000401", placa: "BRC-605", cliente: "Ricardo Medina", servicio: "Carga de aire acondicionado", montoTotal: 240, estado: "listo", tecnico: "Ernesto Lara", hace: 1395 },
  { numero: "OT-000400", placa: "AQP-728", cliente: "Sofía Cárdenas", servicio: "Conversión a GNV", montoTotal: 4100, estado: "en_proceso", tecnico: "Luis Quispe", hace: 1500 },
  { numero: "OT-000399", placa: "T6N-457", cliente: "Hugo Espinoza", servicio: "Cambio de aceite y filtro", montoTotal: 190, estado: "en_taller", tecnico: "Ernesto Lara", hace: 1580 },
  { numero: "OT-000398", placa: "BMV-264", cliente: "Verónica Luna", servicio: "Cambio de pastillas de freno", montoTotal: 340, estado: "en_proceso", tecnico: "Luis Quispe", hace: 2900 },
  { numero: "OT-000397", placa: "H8R-931", cliente: "Óscar Palacios", servicio: "Reparación de embrague", montoTotal: 1380, estado: "en_taller", tecnico: "Ernesto Lara", hace: 3050 },
];

const CITAS: CitaEjemplo[] = [
  { hora: "08:30", cliente: "Gabriela Rojas", servicio: "Cambio de aceite y filtro", red: "Facebook", estado: "llego" },
  { hora: "09:30", cliente: "Raúl Mendoza", servicio: "Conversión a GNV", red: "TikTok", estado: "llego" },
  { hora: "10:00", cliente: "Diana Paz", servicio: "Carga de aire acondicionado", red: "Instagram", estado: "no_llego" },
  { hora: "11:30", cliente: "Andrés Silva", servicio: "Diagnóstico de caja automática", red: "Facebook", estado: "confirmada" },
  { hora: "14:00", cliente: "Karina Ortiz", servicio: "Cambio de pastillas de freno", red: "Facebook", estado: "confirmada" },
  { hora: "15:30", cliente: "Pablo Herrera", servicio: "Revisión de GLP", red: "TikTok", estado: "agendada" },
  { hora: "17:00", cliente: "Lorena Campos", servicio: "Mantenimiento de caja automática", red: "Instagram", estado: "agendada" },
];

// Meses completos (de más antiguo a más reciente) y el mes en curso hasta hoy.
const MESES_CERRADOS = [
  { ventas: 58200, compras: 27430, manoObra: 14200, entregados: 96 },
  { ventas: 63450, compras: 30820, manoObra: 14200, entregados: 104 },
  { ventas: 61980, compras: 30670, manoObra: 14200, entregados: 99 },
  { ventas: 70120, compras: 35750, manoObra: 14200, entregados: 112 },
  { ventas: 66840, compras: 33080, manoObra: 14200, entregados: 107 },
  { ventas: 74310, compras: 38440, manoObra: 14200, entregados: 118 },
  { ventas: 79560, compras: 41530, manoObra: 14200, entregados: 124 },
];
const MES_EN_CURSO = { ventas: 41870, compras: 21940, manoObra: 7010, entregados: 61 };
/** El mes anterior hasta el mismo día, para comparar parejo. */
const MES_ANTERIOR_AL_MISMO_DIA = { ventas: 39120, compras: 20460, manoObra: 7220, entregados: 64 };

const META_SIN_IGV = 95000;

function etiquetasMeses(ahora: Date, cuantos: number): string[] {
  const [anio, mes] = diaEnLima(ahora).split("-").map(Number);
  const formato = new Intl.DateTimeFormat("es-PE", { month: "short", timeZone: "UTC" });
  return Array.from({ length: cuantos }, (_, i) => {
    const fecha = new Date(Date.UTC(anio, mes - 1 - (cuantos - 1 - i), 1));
    const texto = formato.format(fecha).replace(".", "");
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  });
}

export type ResumenMes = {
  ventas: number;
  compras: number;
  manoObra: number;
  costos: number;
  utilidad: number;
  entregados: number;
};

function resumen(m: { ventas: number; compras: number; manoObra: number; entregados: number }): ResumenMes {
  const costos = m.compras + m.manoObra;
  return { ...m, costos, utilidad: m.ventas - costos };
}

export type DatosPanel = {
  ordenes: (OrdenEjemplo & { momento: Date })[];
  enTaller: (OrdenEjemplo & { momento: Date })[];
  conteoPorEstado: Record<Exclude<EstadoOrden, "entregado">, number>;
  citas: CitaEjemplo[];
  meses: (MesEjemplo & { costos: number; utilidad: number; enCurso: boolean })[];
  mes: ResumenMes;
  mesAnteriorAlMismoDia: ResumenMes;
  diaDelMes: number;
  meta: number;
  zona: string;
};

export function datosPanelEjemplo(ahora: Date = new Date()): DatosPanel {
  const ordenes = ORDENES.map((o) => ({ ...o, momento: new Date(ahora.getTime() - o.hace * 60_000) }));
  const enTaller = ordenes.filter((o) => o.estado !== "entregado");
  const conteoPorEstado = { en_taller: 0, en_proceso: 0, esperando_repuesto: 0, listo: 0 };
  for (const o of enTaller) conteoPorEstado[o.estado as keyof typeof conteoPorEstado] += 1;

  const etiquetas = etiquetasMeses(ahora, MESES_CERRADOS.length + 1);
  const meses = [...MESES_CERRADOS, MES_EN_CURSO].map((m, i) => ({
    etiqueta: etiquetas[i],
    ...resumen(m),
    enCurso: i === MESES_CERRADOS.length,
  }));

  return {
    ordenes,
    enTaller,
    conteoPorEstado,
    citas: CITAS,
    meses,
    mes: resumen(MES_EN_CURSO),
    mesAnteriorAlMismoDia: resumen(MES_ANTERIOR_AL_MISMO_DIA),
    diaDelMes: Number(diaEnLima(ahora).slice(8, 10)),
    meta: META_SIN_IGV,
    zona: ZONA,
  };
}
