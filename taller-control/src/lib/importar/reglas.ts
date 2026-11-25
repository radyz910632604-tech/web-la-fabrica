/**
 * Importar datos desde el Excel anterior del taller. Funciones puras (con
 * pruebas en tests/importar.test.ts): reconocen las columnas por su título,
 * convierten cada celda (celular, placa, montos, fechas, DNI/RUC) y dicen qué
 * fila tiene problemas. Las usa la pantalla (vista previa) y el servidor (que
 * vuelve a validar todo antes de guardar: nunca confía en lo que manda el navegador).
 */
import { normalizarCelular } from "@/lib/celulares";
import { normalizarPlaca } from "@/lib/placas";

export const TIPOS_IMPORTACION = {
  clientes: { nombre: "Clientes y sus carros", detalle: "Nombre, celular, DNI o RUC, placa, marca, modelo, año, color y kilometraje." },
  historial: { nombre: "Historial de servicios", detalle: "Trabajos anteriores por placa: fecha, servicio y kilometraje. No manda mensajes a los clientes." },
  inventario: { nombre: "Inventario de repuestos", detalle: "Código, nombre, stock, costo y precio de venta." },
  ventas: { nombre: "Ventas anteriores", detalle: "Boletas y facturas emitidas: fecha, número, cliente, placa y total." },
  compras: { nombre: "Compras anteriores", detalle: "Compras a proveedores: fecha, proveedor, RUC, número y total. No cambian el stock." },
  gastos: { nombre: "Gastos del taller", detalle: "Fecha, concepto, categoría y monto (alquiler, luz, sueldos…)." },
} as const;
export type TipoImportacion = keyof typeof TIPOS_IMPORTACION;

export type Campo = { clave: string; nombre: string; obligatorio?: boolean; sinonimos: string[] };

/** Qué datos se buscan en cada tipo y con qué títulos suelen venir en un Excel. */
export const CAMPOS = {
  clientes: [
    { clave: "placa", nombre: "Placa", sinonimos: ["placa", "nro placa", "n placa", "placa del vehiculo", "matricula"] },
    { clave: "nombre", nombre: "Nombre del cliente", sinonimos: ["cliente", "nombre", "nombre del cliente", "nombres", "razon social", "propietario", "dueno"] },
    { clave: "celular", nombre: "Celular", sinonimos: ["celular", "telefono", "tel", "cel", "movil", "whatsapp", "numero", "contacto"] },
    { clave: "documento", nombre: "DNI o RUC", sinonimos: ["dni", "ruc", "documento", "dni ruc", "doc", "nro documento", "dni/ruc"] },
    { clave: "marca", nombre: "Marca", sinonimos: ["marca"] },
    { clave: "modelo", nombre: "Modelo", sinonimos: ["modelo"] },
    { clave: "anio", nombre: "Año", sinonimos: ["ano", "anio", "año", "ano de fabricacion", "fabricacion"] },
    { clave: "color", nombre: "Color", sinonimos: ["color"] },
    { clave: "kilometraje", nombre: "Kilometraje", sinonimos: ["kilometraje", "km", "kms", "kilometros", "odometro"] },
    { clave: "combustible", nombre: "Combustible", sinonimos: ["combustible", "tipo de combustible"] },
    { clave: "transmision", nombre: "Caja", sinonimos: ["caja", "transmision", "tipo de caja"] },
    { clave: "notas", nombre: "Notas", sinonimos: ["notas", "observaciones", "obs", "comentarios"] },
  ],
  inventario: [
    { clave: "codigo", nombre: "Código", sinonimos: ["codigo", "cod", "sku", "codigo interno", "item"] },
    { clave: "nombre", nombre: "Nombre", obligatorio: true, sinonimos: ["nombre", "descripcion", "producto", "repuesto", "articulo", "detalle"] },
    { clave: "marca", nombre: "Marca", sinonimos: ["marca"] },
    { clave: "unidad", nombre: "Unidad", sinonimos: ["unidad", "und", "um", "unidad de medida"] },
    { clave: "stock", nombre: "Stock", sinonimos: ["stock", "cantidad", "existencia", "saldo", "cant"] },
    { clave: "stock_minimo", nombre: "Stock mínimo", sinonimos: ["stock minimo", "minimo", "min"] },
    { clave: "costo", nombre: "Costo por unidad", sinonimos: ["costo", "precio de compra", "costo unitario", "p compra", "precio costo"] },
    { clave: "precio", nombre: "Precio de venta", sinonimos: ["precio", "precio de venta", "pv", "p venta", "precio venta"] },
  ],
  gastos: [
    { clave: "fecha", nombre: "Fecha", obligatorio: true, sinonimos: ["fecha", "dia", "fecha de pago"] },
    { clave: "descripcion", nombre: "Concepto", obligatorio: true, sinonimos: ["concepto", "descripcion", "detalle", "gasto", "motivo"] },
    { clave: "monto", nombre: "Monto", obligatorio: true, sinonimos: ["monto", "importe", "total", "valor", "soles", "s/"] },
    { clave: "categoria", nombre: "Categoría", sinonimos: ["categoria", "tipo", "rubro", "clase"] },
    { clave: "medio", nombre: "Cómo se pagó", sinonimos: ["medio", "forma de pago", "metodo", "pago", "medio de pago"] },
    { clave: "comprobante", nombre: "Comprobante", sinonimos: ["comprobante", "recibo", "boleta", "factura", "nro", "numero"] },
  ],
} as Record<TipoImportacion, Campo[]>;

const PLACA_CLIENTE: Campo[] = [
  { clave: "nombre", nombre: "Nombre del cliente", sinonimos: ["cliente", "nombre", "nombre del cliente", "razon social", "propietario"] },
  { clave: "celular", nombre: "Celular", sinonimos: ["celular", "telefono", "tel", "cel", "movil", "whatsapp", "contacto"] },
  { clave: "marca", nombre: "Marca", sinonimos: ["marca"] },
  { clave: "modelo", nombre: "Modelo", sinonimos: ["modelo"] },
];
CAMPOS.historial = [
  { clave: "placa", nombre: "Placa", obligatorio: true, sinonimos: ["placa", "nro placa", "matricula"] },
  { clave: "fecha", nombre: "Fecha", obligatorio: true, sinonimos: ["fecha", "fecha de ingreso", "fecha ingreso", "dia", "fecha de servicio"] },
  { clave: "servicio", nombre: "Servicio o trabajo", obligatorio: true, sinonimos: ["servicio", "trabajo", "descripcion", "detalle", "trabajo realizado", "servicios", "motivo"] },
  { clave: "kilometraje", nombre: "Kilometraje", sinonimos: ["kilometraje", "km", "kms", "kilometros"] },
  { clave: "monto", nombre: "Monto cobrado", sinonimos: ["monto", "total", "importe", "cobrado", "precio", "soles"] },
  { clave: "notas", nombre: "Observaciones", sinonimos: ["observaciones", "obs", "notas", "comentarios", "diagnostico"] },
  ...PLACA_CLIENTE,
];
CAMPOS.ventas = [
  { clave: "fecha", nombre: "Fecha", obligatorio: true, sinonimos: ["fecha", "fecha de emision", "emision", "dia"] },
  { clave: "tipo", nombre: "Tipo (boleta o factura)", sinonimos: ["tipo", "tipo de comprobante", "comprobante", "documento", "tipo doc"] },
  { clave: "numero", nombre: "Serie y número", sinonimos: ["numero", "nro", "n", "serie numero", "nro comprobante", "correlativo", "numero de comprobante"] },
  { clave: "serie", nombre: "Serie (si va aparte)", sinonimos: ["serie"] },
  { clave: "total", nombre: "Total", obligatorio: true, sinonimos: ["total", "importe", "monto", "importe total", "total s/", "venta"] },
  { clave: "documento", nombre: "DNI o RUC del cliente", sinonimos: ["dni", "ruc", "dni ruc", "doc cliente", "ruc/dni", "documento cliente"] },
  { clave: "placa", nombre: "Placa", sinonimos: ["placa"] },
  { clave: "detalle", nombre: "Detalle", sinonimos: ["detalle", "descripcion", "concepto", "servicio"] },
  { clave: "nombre", nombre: "Cliente", sinonimos: ["cliente", "nombre", "razon social", "senor es", "senores"] },
];
CAMPOS.compras = [
  { clave: "fecha", nombre: "Fecha", obligatorio: true, sinonimos: ["fecha", "fecha de emision", "emision", "dia"] },
  { clave: "proveedor", nombre: "Proveedor", obligatorio: true, sinonimos: ["proveedor", "razon social", "empresa", "tienda", "emisor"] },
  { clave: "ruc", nombre: "RUC del proveedor", sinonimos: ["ruc", "ruc proveedor", "ruc del proveedor"] },
  { clave: "tipo", nombre: "Tipo de comprobante", sinonimos: ["tipo", "tipo de comprobante", "comprobante", "documento", "tipo doc"] },
  { clave: "numero", nombre: "Serie y número", sinonimos: ["numero", "nro", "serie numero", "nro comprobante", "factura", "numero de comprobante"] },
  { clave: "serie", nombre: "Serie (si va aparte)", sinonimos: ["serie"] },
  { clave: "total", nombre: "Total", obligatorio: true, sinonimos: ["total", "importe", "monto", "importe total", "compra"] },
  { clave: "detalle", nombre: "Qué se compró", sinonimos: ["detalle", "descripcion", "concepto", "producto", "repuesto", "articulo"] },
];

export const simple = (t: unknown) =>
  String(t ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .trim();

export type Mapa = Record<string, number | null>;

/** La fila donde están los títulos: la primera (de las 15 de arriba) que reconoce más columnas. */
export function filaDeTitulos(filas: string[][], tipo: TipoImportacion): number {
  let mejor = 0;
  let puntos = -1;
  filas.slice(0, 15).forEach((f, i) => {
    const p = Object.values(detectarColumnas(f, tipo)).filter((x) => x !== null).length;
    if (p > puntos) {
      puntos = p;
      mejor = i;
    }
  });
  return mejor;
}

/** Qué columna es cada dato, por el título (primero igual, después «contiene»). Una columna sirve a un solo dato. */
export function detectarColumnas(titulos: string[], tipo: TipoImportacion): Mapa {
  const t = titulos.map(simple);
  const usadas = new Set<number>();
  const mapa: Mapa = {};
  for (const modo of ["igual", "contiene"] as const) {
    for (const c of CAMPOS[tipo]) {
      if (mapa[c.clave] != null) continue;
      const i = t.findIndex((x, j) => !usadas.has(j) && x && c.sinonimos.some((s) => (modo === "igual" ? x === simple(s) : x.includes(simple(s)) && simple(s).length >= 3)));
      if (i >= 0) {
        mapa[c.clave] = i;
        usadas.add(i);
      }
    }
  }
  for (const c of CAMPOS[tipo]) mapa[c.clave] ??= null;
  return mapa;
}

// ---------------------------------------------------------------------------
// Conversión de celdas
// ---------------------------------------------------------------------------

/** «S/ 1,234.50», «1.234,50», «85 000», «85mil» → número. Vacío o texto → null. */
export function aNumero(v: unknown): number | null {
  let t = String(v ?? "").trim().toLowerCase().replace(/s\/\.?|soles|pen|usd|\$/g, "").trim();
  if (!t) return null;
  const mil = /^(\d+(?:[.,]\d+)?)\s*mil$/.exec(t);
  if (mil) return Math.round(Number(mil[1].replace(",", ".")) * 1000);
  t = t.replace(/\s+/g, "");
  if (!/^-?[\d.,]+$/.test(t)) return null;
  const coma = t.lastIndexOf(",");
  const punto = t.lastIndexOf(".");
  if (coma > -1 && punto > -1) t = coma > punto ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (coma > -1) t = /,\d{3}$/.test(t) && !/,\d{3},?\d*,/.test(t) && t.split(",").length > 1 && t.split(",").slice(1).every((x) => x.length === 3) ? t.replace(/,/g, "") : t.replace(",", ".");
  else if (punto > -1 && t.split(".").length > 2) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Fecha como AAAA-MM-DD: número de serie de Excel, 15/11/2026, 15-11-26, 2026-11-15 o ISO. */
export function aFecha(v: unknown): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  let a: number, m: number, d: number;
  if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [d, m, a] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3])];
  else if (/^\d{5}(\.\d+)?$/.test(t)) {
    // Número de serie de Excel (días desde el 30/12/1899).
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000);
    [a, m, d] = [f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate()];
  } else return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d || a < 1990 || a > 2100) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** DNI (8 dígitos), RUC (11, empieza en 10/15/17/20) o carné de extranjería. */
export function aDocumento(v: unknown): { tipo: "dni" | "ruc" | "ce"; numero: string } | null {
  const t = String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!t) return null;
  if (/^\d{8}$/.test(t)) return { tipo: "dni", numero: t };
  if (/^(10|15|17|20)\d{9}$/.test(t)) return { tipo: "ruc", numero: t };
  if (/^\d{7}$/.test(t)) return { tipo: "dni", numero: `0${t}` }; // Excel le quita el cero del inicio
  if (/^[A-Z0-9]{6,12}$/.test(t) && /[A-Z]/.test(t)) return { tipo: "ce", numero: t };
  return null;
}

const COMBUSTIBLES: [RegExp, string][] = [[/dual|gnv.*gas|gas.*gnv|bi.?fuel/, "dual"], [/gnv|gas natural/, "gnv"], [/glp/, "glp"], [/diesel|petroleo/, "diesel"], [/electr/, "electrico"], [/hibrid/, "hibrido"], [/gasolin|nafta/, "gasolina"]];
const CAJAS: [RegExp, string][] = [[/cvt/, "cvt"], [/auto|at\b/, "automatica"], [/mec|manual|sincr|mt\b/, "mecanica"]];
const UNIDADES: [RegExp, string][] = [[/litro|lt|\bl\b/, "litro"], [/galon|gl\b|gln/, "galon"], [/juego|jgo/, "juego"], [/kit/, "kit"], [/metro|\bm\b|mt/, "metro"], [/kilo|kg/, "kilo"]];
const CATEGORIAS: [RegExp, string][] = [
  [/alquiler|renta|arriendo/, "alquiler"], [/\bluz\b|electric|enel|luz del sur/, "luz"], [/agua|sedapal/, "agua"], [/internet|telefon|celular|claro|movistar|entel|bitel/, "internet_telefono"],
  [/sueldo|planilla|pago personal|jornal|quincena|gratificacion|cts/, "sueldos"], [/movilidad|combustible|gasolina|taxi|pasaje|peaje/, "movilidad"], [/publicidad|anuncio|facebook|marketing|volante/, "publicidad"],
  [/herramienta|equipo|maquina/, "herramientas"], [/limpieza/, "limpieza"], [/impuesto|sunat|tramite|municipal|licencia|arbitrio/, "impuestos"], [/mantenimiento|reparacion del local|pintura/, "mantenimiento_local"], [/contador|contabilidad/, "contador"],
];
const MEDIOS: [RegExp, string][] = [[/yape/, "yape"], [/plin/, "plin"], [/tarjeta|pos|visa|master/, "tarjeta"], [/transfer|deposito|banco|bcp|bbva|interbank|scotiabank/, "transferencia"], [/efectivo|cash|caja/, "efectivo"]];
const buscar = (t: string, tabla: [RegExp, string][]) => tabla.find(([r]) => r.test(t))?.[1] ?? null;

/** «B001-123», «F001 - 00000123», o serie y número en columnas separadas. */
export function aSerieNumero(numero: unknown, serieAparte?: unknown): { serie: string; numero: string } | null {
  const t = String(numero ?? "").toUpperCase().replace(/\s+/g, "");
  const sa = String(serieAparte ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const junto = /^([A-Z0-9]{1,4})-0*(\d{1,8})$/.exec(t);
  if (junto && !sa) return { serie: junto[1], numero: junto[2] };
  const solo = /^0*(\d{1,8})$/.exec(t.replace(/^N[°º]?/, ""));
  if (sa && sa.length <= 4 && solo) return { serie: sa, numero: solo[1] };
  if (junto) return { serie: junto[1], numero: junto[2] };
  return null;
}

/** Boleta o factura por la columna de tipo, la serie (F… / B…) o el documento del cliente (RUC → factura). */
function tipoVenta(tipo: string, serie: string | null, ruc: boolean): "boleta" | "factura" {
  const t = simple(tipo);
  if (/factura|^f\b|^fa/.test(t)) return "factura";
  if (/boleta|^b\b|^bv/.test(t)) return "boleta";
  if (serie?.startsWith("F")) return "factura";
  if (serie?.startsWith("B")) return "boleta";
  return ruc ? "factura" : "boleta";
}

// ---------------------------------------------------------------------------
// Validar una fila
// ---------------------------------------------------------------------------

export type FilaValidada = { fila: number; ok: boolean; datos: Record<string, unknown>; errores: string[]; avisos: string[] };

const celda = (fila: string[], mapa: Mapa, clave: string) => {
  const i = mapa[clave];
  return i == null ? "" : String(fila[i] ?? "").trim();
};

/** Convierte una fila del Excel en datos listos para guardar, con sus problemas en palabras simples. */
export function validarFila(tipo: TipoImportacion, fila: string[], mapa: Mapa, numero: number, opciones: { costosConIgv?: boolean; hoy?: string } = {}): FilaValidada {
  const c = (k: string) => celda(fila, mapa, k);
  const errores: string[] = [];
  const avisos: string[] = [];
  const datos: Record<string, unknown> = {};
  const vacia = fila.every((x) => !String(x ?? "").trim());
  if (vacia) return { fila: numero, ok: false, datos, errores: ["Fila vacía"], avisos };

  if (tipo === "clientes") {
    const placaCruda = c("placa");
    const placa = placaCruda ? normalizarPlaca(placaCruda) : "";
    if (placaCruda && !/^[A-Z0-9]{4,8}$/.test(placa)) errores.push(`Placa «${placaCruda}» no válida`);
    else if (placa) datos.placa = placa;
    const celCrudo = c("celular");
    const celular = celCrudo ? normalizarCelular(celCrudo.replace(/[^\d+]/g, "")) : null;
    if (celCrudo && !celular) avisos.push(`Celular «${celCrudo}» no válido: se guarda solo el carro`);
    const nombre = c("nombre").replace(/\s+/g, " ").slice(0, 120);
    if (celular && nombre.length >= 2) {
      datos.celular = celular;
      datos.nombre = nombre;
    } else if (celular && nombre.length < 2) avisos.push("Sin nombre: no se crea el cliente");
    else if (!celular && nombre.length >= 2 && !celCrudo) avisos.push("Sin celular: no se crea el cliente (el celular es su identificador)");
    const doc = aDocumento(c("documento"));
    if (c("documento") && !doc) avisos.push(`Documento «${c("documento")}» no reconocido`);
    if (doc) datos.documento = doc;
    if (!datos.placa && !datos.celular) errores.push("Sin placa ni cliente con celular");
    const anio = aNumero(c("anio"));
    if (anio && anio >= 1950 && anio <= 2100) datos.anio = Math.round(anio);
    const km = aNumero(c("kilometraje"));
    if (km !== null && km >= 0 && km < 3_000_000) datos.kilometraje = Math.round(km);
    for (const k of ["marca", "modelo", "color"] as const) if (c(k)) datos[k] = c(k).slice(0, k === "modelo" ? 60 : k === "color" ? 30 : 40);
    const comb = buscar(simple(c("combustible")), COMBUSTIBLES);
    if (comb) datos.combustible = comb;
    const caja = buscar(simple(c("transmision")), CAJAS);
    if (caja) datos.transmision = caja;
    if (c("notas")) datos.notas = c("notas").slice(0, 1000);
  }

  if (tipo === "inventario") {
    const nombre = c("nombre").replace(/\s+/g, " ");
    if (nombre.length < 2) errores.push("Sin nombre del repuesto");
    else datos.nombre = nombre.slice(0, 160);
    const codigo = c("codigo").toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9./-]/g, "").replace(/^[^A-Z0-9]+/, "").slice(0, 30);
    if (codigo) datos.codigo = codigo;
    if (c("marca")) datos.marca = c("marca").slice(0, 60);
    datos.unidad = buscar(simple(c("unidad")), UNIDADES) ?? "unidad";
    const stock = aNumero(c("stock"));
    if (c("stock") && (stock === null || stock < 0)) errores.push(`Stock «${c("stock")}» no válido`);
    else datos.stock = stock ?? 0;
    const minimo = aNumero(c("stock_minimo"));
    if (minimo !== null && minimo >= 0) datos.stock_minimo = minimo;
    const igv = opciones.costosConIgv !== false ? 1.18 : 1;
    const costo = aNumero(c("costo"));
    if (c("costo") && (costo === null || costo < 0)) errores.push(`Costo «${c("costo")}» no válido`);
    else if (costo !== null) datos.costo_sin_igv = Math.round((costo / igv) * 10000) / 10000;
    const precio = aNumero(c("precio"));
    if (precio !== null && precio >= 0) datos.precio_sin_igv = Math.round((precio / igv) * 10000) / 10000;
    if ((datos.stock as number) > 0 && datos.costo_sin_igv === undefined) avisos.push("Tiene stock pero no costo: la ganancia saldrá incompleta");
  }

  if (tipo === "gastos") {
    const fecha = aFecha(c("fecha"));
    if (!fecha) errores.push(c("fecha") ? `Fecha «${c("fecha")}» no válida` : "Sin fecha");
    else datos.fecha = fecha;
    const descripcion = c("descripcion").replace(/\s+/g, " ");
    if (descripcion.length < 2) errores.push("Sin concepto");
    else datos.descripcion = descripcion.slice(0, 200);
    const monto = aNumero(c("monto"));
    if (monto === null || monto <= 0) errores.push(c("monto") ? `Monto «${c("monto")}» no válido` : "Sin monto");
    else datos.monto = Math.round(monto * 100) / 100;
    datos.categoria = buscar(simple(`${c("categoria")} ${descripcion}`), CATEGORIAS) ?? "otros";
    const medio = buscar(simple(c("medio")), MEDIOS);
    if (medio) datos.medio = medio;
    if (c("comprobante")) datos.comprobante = c("comprobante").slice(0, 40);
  }

  if (tipo === "historial") {
    const placaCruda = c("placa");
    const placa = placaCruda ? normalizarPlaca(placaCruda) : "";
    if (!/^[A-Z0-9]{4,8}$/.test(placa)) errores.push(placaCruda ? `Placa «${placaCruda}» no válida` : "Sin placa");
    else datos.placa = placa;
    const fecha = aFecha(c("fecha"));
    if (!fecha) errores.push(c("fecha") ? `Fecha «${c("fecha")}» no válida` : "Sin fecha");
    else if (opciones.hoy && fecha > opciones.hoy) errores.push("La fecha es futura");
    else datos.fecha = fecha;
    const servicios = c("servicio").split(/\s*(?:\+|;|\n|\s-\s|\/)\s*/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 10);
    if (!servicios.length) errores.push("Sin servicio");
    else datos.servicios = servicios.map((x) => x.slice(0, 160));
    const km = aNumero(c("kilometraje"));
    if (km !== null && km >= 0 && km < 3_000_000) datos.kilometraje = Math.round(km);
    const monto = aNumero(c("monto"));
    if (monto !== null && monto > 0) datos.monto = Math.round(monto * 100) / 100;
    if (c("notas")) datos.notas = c("notas").slice(0, 800);
    const celular = c("celular") ? normalizarCelular(c("celular").replace(/[^\d+]/g, "")) : null;
    if (celular && c("nombre").length >= 2) {
      datos.celular = celular;
      datos.nombre = c("nombre").replace(/\s+/g, " ").slice(0, 120);
    }
    if (c("marca")) datos.marca = c("marca").slice(0, 40);
    if (c("modelo")) datos.modelo = c("modelo").slice(0, 60);
  }

  if (tipo === "ventas" || tipo === "compras") {
    const fecha = aFecha(c("fecha"));
    if (!fecha) errores.push(c("fecha") ? `Fecha «${c("fecha")}» no válida` : "Sin fecha");
    else datos.fecha = fecha;
    const total = aNumero(c("total"));
    if (total === null || total <= 0) errores.push(c("total") ? `Total «${c("total")}» no válido` : "Sin total");
    else datos.total = Math.round(total * 100) / 100;
    const sn = aSerieNumero(c("numero"), c("serie"));
    if (sn) Object.assign(datos, sn);
    if (c("detalle")) datos.detalle = c("detalle").replace(/\s+/g, " ").slice(0, tipo === "ventas" ? 2000 : 200);
  }

  if (tipo === "ventas") {
    const doc = aDocumento(c("documento"));
    if (doc) datos.documento = doc;
    datos.tipo = tipoVenta(c("tipo"), (datos.serie as string) ?? null, doc?.tipo === "ruc");
    if (!datos.serie) avisos.push("Sin serie y número: se guarda como venta del Excel");
    const placa = c("placa") ? normalizarPlaca(c("placa")) : "";
    if (/^[A-Z0-9]{4,8}$/.test(placa)) datos.placa = placa;
    if (c("nombre")) datos.nombre = c("nombre").slice(0, 120);
  }

  if (tipo === "compras") {
    const prov = c("proveedor").replace(/\s+/g, " ");
    if (prov.length < 2) errores.push("Sin proveedor");
    else datos.proveedor = prov.slice(0, 160);
    const ruc = String(c("ruc")).replace(/\D/g, "");
    if (/^(10|15|17|20)\d{9}$/.test(ruc)) datos.ruc = ruc;
    else if (c("ruc")) avisos.push(`RUC «${c("ruc")}» no válido`);
    const t = simple(c("tipo"));
    datos.tipo = /factura/.test(t) || (datos.serie as string | undefined)?.startsWith("F") ? "factura" : /boleta/.test(t) || (datos.serie as string | undefined)?.startsWith("B") ? "boleta" : /ticket/.test(t) ? "ticket" : /nota/.test(t) ? "nota_venta" : datos.serie ? "factura" : "sin_comprobante";
  }

  return { fila: numero, ok: errores.length === 0, datos, errores, avisos };
}

/** Lo que falta mapear para poder importar. */
export function faltanObligatorios(tipo: TipoImportacion, mapa: Mapa): string[] {
  const faltan = CAMPOS[tipo].filter((c) => c.obligatorio && mapa[c.clave] == null).map((c) => c.nombre);
  if (tipo === "clientes" && mapa.placa == null && mapa.celular == null) faltan.push("Placa o Celular");
  return faltan;
}
