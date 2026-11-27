/**
 * Lista de la pantalla «Caja – Órdenes y Cobro»: estado de pago de cada orden,
 * búsqueda y filtros. Funciones puras (con pruebas en tests/caja-cobro.test.ts).
 */
import { estadoPago, type EstadoPago } from "@/lib/dinero";

export type FiltroPago = "todas" | "pendientes" | "abonadas" | "pagadas";
export type OrdenCaja = {
  id: string;
  numero: number;
  placa: string;
  vehiculo: string;
  cliente: string | null;
  documento: string | null;
  estado: string;
  ingresadoEn: string;
  aCobrar: number;
  pagado: number;
  saldo: number;
};

/** Pendiente (incluye «sin precio»), abonada (pagó una parte) o pagada (incluye saldo a favor). */
export function grupoPago(o: { aCobrar: number; pagado: number }): Exclude<FiltroPago, "todas"> {
  const e: EstadoPago = estadoPago(o);
  return e === "parcial" ? "abonadas" : e === "pagada" || e === "a_favor" ? "pagadas" : "pendientes";
}

const sinSignos = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Busca por número de orden (con o sin «OT-» y ceros), placa (con o sin guion), cliente o DNI/RUC. */
export function coincide(o: OrdenCaja, q: string): boolean {
  const t = sinSignos(q.trim());
  if (!t) return true;
  const soloLetrasNumeros = t.replace(/[^a-z0-9]/g, "");
  const numero = soloLetrasNumeros.replace(/^(ot|ord)/, "").replace(/^0+/, "");
  if (numero && /^\d+$/.test(numero) && String(o.numero) === numero) return true;
  if (soloLetrasNumeros && o.placa.toLowerCase().replace(/[^a-z0-9]/g, "").includes(soloLetrasNumeros)) return true;
  if (o.documento && soloLetrasNumeros && o.documento.toLowerCase().includes(soloLetrasNumeros)) return true;
  return !!o.cliente && sinSignos(o.cliente).includes(t);
}

export function filtrarOrdenes(ordenes: OrdenCaja[], q: string, filtro: FiltroPago) {
  const buscadas = ordenes.filter((o) => coincide(o, q));
  const conteo = { todas: buscadas.length, pendientes: 0, abonadas: 0, pagadas: 0 } as Record<FiltroPago, number>;
  for (const o of buscadas) conteo[grupoPago(o)]++;
  return { lista: filtro === "todas" ? buscadas : buscadas.filter((o) => grupoPago(o) === filtro), conteo };
}
