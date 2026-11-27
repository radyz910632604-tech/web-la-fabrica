/** Cálculos puros de los ingresos (con pruebas en tests/ingresos.test.ts). */
import { MEDIOS, redondear, type MedioPago } from "@/lib/dinero";

export type GrupoMedio = "efectivo" | "yape_plin" | "transferencia" | "tarjeta";
export const GRUPOS: [GrupoMedio, string][] = [
  ["efectivo", "Efectivo"],
  ["yape_plin", "Yape / Plin"],
  ["transferencia", "Transferencias"],
  ["tarjeta", "Tarjetas"],
];
export const grupoDe = (m: string): GrupoMedio => (m === "yape" || m === "plin" ? "yape_plin" : m === "transferencia" ? "transferencia" : m === "tarjeta" ? "tarjeta" : "efectivo");

export type Ingreso = {
  id: string;
  momento: string;
  dia: string;
  hora: string;
  ordenId: string;
  orden: number | null;
  cliente: string | null;
  documento: string | null;
  placa: string | null;
  concepto: string;
  medio: MedioPago;
  tipo: string;
  /** Lo que entró (positivo) o salió en una devolución (negativo). */
  monto: number;
  subtotal: number;
  igv: number;
  comprobante: string;
  usuario: string;
  operacion: string | null;
};

export type ResumenIngresos = {
  /** Ingreso neto: lo que entró menos las devoluciones. */
  total: number;
  entradas: number;
  devoluciones: number;
  operaciones: number;
  porGrupo: Record<GrupoMedio, number>;
  porMedio: Record<MedioPago, number>;
};

/** Totales de una lista de ingresos (puro: con pruebas en tests/ingresos.test.ts). */
export function resumirIngresos(lista: Pick<Ingreso, "monto" | "medio">[]): ResumenIngresos {
  const porGrupo = Object.fromEntries(GRUPOS.map(([g]) => [g, 0])) as Record<GrupoMedio, number>;
  const porMedio = Object.fromEntries(Object.keys(MEDIOS).map((m) => [m, 0])) as Record<MedioPago, number>;
  let entradas = 0;
  let devoluciones = 0;
  let operaciones = 0;
  for (const i of lista) {
    porGrupo[grupoDe(i.medio)] = redondear(porGrupo[grupoDe(i.medio)] + i.monto);
    porMedio[i.medio] = redondear((porMedio[i.medio] ?? 0) + i.monto);
    if (i.monto >= 0) {
      entradas = redondear(entradas + i.monto);
      operaciones++;
    } else devoluciones = redondear(devoluciones - i.monto);
  }
  return { total: redondear(entradas - devoluciones), entradas, devoluciones, operaciones, porGrupo, porMedio };
}

const sinSignos = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Búsqueda por cliente, DNI/RUC, placa o número de orden, y filtro por forma de pago. */
export function filtrarIngresos(lista: Ingreso[], q: string, grupo: GrupoMedio | null): Ingreso[] {
  const t = sinSignos(q.trim());
  const llano = t.replace(/[^a-z0-9]/g, "");
  const numero = llano.replace(/^(ot|ord)/, "").replace(/^0+/, "");
  return lista.filter((i) => {
    if (grupo && grupoDe(i.medio) !== grupo) return false;
    if (!t) return true;
    if (numero && /^\d+$/.test(numero) && String(i.orden ?? "") === numero) return true;
    if (llano && i.placa && i.placa.toLowerCase().includes(llano)) return true;
    if (llano && i.documento && i.documento.toLowerCase().includes(llano)) return true;
    return !!i.cliente && sinSignos(i.cliente).includes(t);
  });
}

/** Totales por día y forma de pago (hoja «Métodos de pago»), en orden de fecha. */
export function porDia(lista: Pick<Ingreso, "dia" | "monto" | "medio">[]) {
  const m = new Map<string, Record<GrupoMedio, number> & { total: number }>();
  for (const i of lista) {
    const fila = m.get(i.dia) ?? { efectivo: 0, yape_plin: 0, transferencia: 0, tarjeta: 0, total: 0 };
    const g = grupoDe(i.medio);
    fila[g] = redondear(fila[g] + i.monto);
    fila.total = redondear(fila.total + i.monto);
    m.set(i.dia, fila);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dia, f]) => ({ dia, ...f }));
}

/** Semana del mes (lunes a domingo) de un día YYYY-MM-DD: 1, 2, 3… y sus días extremos dentro del mes. */
export function semanaDelMes(dia: string): number {
  const f = new Date(`${dia}T12:00:00Z`);
  const primero = new Date(`${dia.slice(0, 8)}01T12:00:00Z`);
  const desfase = (primero.getUTCDay() + 6) % 7; // lunes = 0
  return Math.floor((f.getUTCDate() - 1 + desfase) / 7) + 1;
}

/** Ingresos por semana del mes (lunes a domingo). */
export function porSemana(lista: Pick<Ingreso, "dia" | "monto">[]) {
  const m = new Map<number, { semana: number; desde: string; hasta: string; total: number }>();
  for (const i of lista) {
    const s = semanaDelMes(i.dia);
    const fila = m.get(s) ?? { semana: s, desde: i.dia, hasta: i.dia, total: 0 };
    if (i.dia < fila.desde) fila.desde = i.dia;
    if (i.dia > fila.hasta) fila.hasta = i.dia;
    fila.total = redondear(fila.total + i.monto);
    m.set(s, fila);
  }
  return [...m.values()].sort((a, b) => a.semana - b.semana);
}

/** Historial por cliente: sus órdenes, placas, servicios, fechas y total pagado en el periodo. */
export function porCliente(lista: Pick<Ingreso, "cliente" | "documento" | "orden" | "placa" | "concepto" | "dia" | "monto" | "tipo">[]) {
  const m = new Map<string, { cliente: string; documento: string | null; ordenes: Set<number>; placas: Set<string>; servicios: Set<string>; fechas: Set<string>; total: number; pagos: number }>();
  for (const i of lista) {
    const clave = `${i.documento ?? ""}|${i.cliente ?? "Sin cliente"}`;
    const f = m.get(clave) ?? { cliente: i.cliente ?? "Sin cliente", documento: i.documento, ordenes: new Set(), placas: new Set(), servicios: new Set(), fechas: new Set(), total: 0, pagos: 0 };
    if (i.orden != null) f.ordenes.add(i.orden);
    if (i.placa) f.placas.add(i.placa);
    if (i.tipo !== "devolucion" && i.concepto) f.servicios.add(i.concepto);
    f.fechas.add(i.dia);
    f.total = redondear(f.total + i.monto);
    if (i.monto > 0) f.pagos++;
    m.set(clave, f);
  }
  return [...m.values()]
    .map((f) => ({ cliente: f.cliente, documento: f.documento, ordenes: [...f.ordenes].sort((a, b) => a - b), placas: [...f.placas], servicios: [...f.servicios], fechas: [...f.fechas].sort(), total: f.total, pagos: f.pagos }))
    .sort((a, b) => b.total - a.total || a.cliente.localeCompare(b.cliente, "es"));
}
