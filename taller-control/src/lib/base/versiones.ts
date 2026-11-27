/**
 * Versiones de la base de datos (una por archivo de supabase/migrations).
 * Cada una trae dos formas de saber si ya está aplicada:
 *  - `sql`: una consulta que devuelve true (la usa el actualizador automático);
 *  - `rest`: una tabla y una columna que deben existir (se revisa con la API
 *    cuando no hay conexión directa a la base).
 * Sirve para reconocer lo que se pegó a mano en el editor SQL de Supabase.
 * Funciones puras, con pruebas en tests/.
 */

export type Version = { version: string; nombre: string; sql: string; rest?: [tabla: string, columna: string] };

const tabla = (t: string) => `select to_regclass('public.${t}') is not null`;
const columna = (t: string, c: string) => `select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${t}' and column_name = '${c}')`;
const funcion = (f: string) => `select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${f}')`;

export const VERSIONES: Version[] = [
  { version: "20261116000001", nombre: "Base: talleres, personas y permisos", sql: tabla("empresas"), rest: ["empresas", "id"] },
  { version: "20261116000002", nombre: "Clientes, carros, órdenes y citas", sql: tabla("ordenes_trabajo"), rest: ["ordenes_trabajo", "id"] },
  { version: "20261116000003", nombre: "Compras, ventas, cotizaciones y pagos", sql: tabla("compras"), rest: ["compras", "id"] },
  { version: "20261116000004", nombre: "Registro de compras y cotizaciones", sql: funcion("registrar_compra") },
  { version: "20261116000005", nombre: "Rol de recepción", sql: "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'rol_t' and e.enumlabel = 'recepcion')" },
  { version: "20261116000006", nombre: "Caja y notas de crédito", sql: tabla("cajas"), rest: ["cajas", "id"] },
  { version: "20261116000007", nombre: "Inventario", sql: tabla("repuestos"), rest: ["repuestos", "id"] },
  { version: "20261116000008", nombre: "Documentos leídos por IA", sql: columna("compras", "archivo_path"), rest: ["compras", "archivo_path"] },
  { version: "20261116000009", nombre: "WhatsApp", sql: tabla("mensajes_whatsapp"), rest: ["mensajes_whatsapp", "id"] },
  { version: "20261116000010", nombre: "Avisos", sql: tabla("avisos"), rest: ["avisos", "id"] },
  { version: "20261116000011", nombre: "Hora de entrega prometida", sql: columna("ordenes_trabajo", "entrega_prometida"), rest: ["ordenes_trabajo", "entrega_prometida"] },
  {
    version: "20261116000012",
    nombre: "Recibos, gastos y documentos",
    // Lo último que hace esta versión: aceptar «documento» en la auditoría de WhatsApp.
    sql: "select exists (select 1 from pg_constraint where conname = 'mensajes_whatsapp_resultado_check' and pg_get_constraintdef(oid) like '%documento%')",
    rest: ["recibos", "id"],
  },
  { version: "20261116000013", nombre: "Firmas, respaldos y mantenimiento", sql: tabla("respaldos"), rest: ["respaldos", "id"] },
  {
    version: "20261116000014",
    nombre: "Estados nuevos de la orden",
    sql: "select exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'estado_orden' and e.enumlabel = 'espera_aprobacion')",
  },
  { version: "20261116000015", nombre: "Diagnóstico, facturado y alertas del agente", sql: columna("ordenes_trabajo", "facturado_en"), rest: ["ordenes_trabajo", "facturado_en"] },
  { version: "20261116000016", nombre: "Importar desde Excel", sql: columna("ordenes_trabajo", "importada"), rest: ["ordenes_trabajo", "importada"] },
  { version: "20261116000017", nombre: "Gastos desde la caja", sql: columna("gastos", "movimiento_caja_id"), rest: ["gastos", "movimiento_caja_id"] },
  { version: "20261116000018", nombre: "Historial de técnicos", sql: columna("ordenes_trabajo", "tecnico_asignado_en"), rest: ["ordenes_trabajo", "tecnico_asignado_en"] },
  { version: "20261116000019", nombre: "Editar cotizaciones", sql: columna("cotizaciones", "reemplaza_id"), rest: ["cotizaciones", "reemplaza_id"] },
  { version: "20261116000020", nombre: "Personal: dueño y bajas", sql: columna("miembros", "es_dueno"), rest: ["miembros", "es_dueno"] },
  { version: "20261116000021", nombre: "Hora prometida restringida y comisiones del asesor", sql: columna("comisiones", "gasto_id"), rest: ["comisiones", "gasto_id"] },
  { version: "20261116000022", nombre: "Cajas por área y Caja Maestra", sql: columna("cajas", "tipo_caja"), rest: ["cajas", "tipo_caja"] },
  { version: "20261116000023", nombre: "Fondo de Almacén y comprobantes", sql: columna("movimientos_caja", "transferencia_id"), rest: ["movimientos_caja", "transferencia_id"] },
  { version: "20261116000024", nombre: "Esquema de pago del personal", sql: columna("esquemas_pago", "frecuencia"), rest: ["esquemas_pago", "frecuencia"] },
  { version: "20261116000025", nombre: "Usuario propio para entrar", sql: columna("perfiles", "usuario"), rest: ["perfiles", "usuario"] },
];

export const versionDe = (archivo: string) => /^(\d{14})_/.exec(archivo)?.[1] ?? null;

export type Plan = { detectadas: string[]; porAplicar: string[] };

/**
 * Qué hacer con cada archivo: si ya está anotado, nada; si la base ya lo
 * tiene (sonda en true), solo se anota; si no, se aplica. En orden.
 */
export function planear(archivos: string[], anotadas: ReadonlySet<string>, sondas: ReadonlyMap<string, boolean>): Plan {
  const plan: Plan = { detectadas: [], porAplicar: [] };
  for (const archivo of [...archivos].sort()) {
    const v = versionDe(archivo);
    if (!v || anotadas.has(v)) continue;
    // Si una anterior falta, las siguientes no se dan por hechas aunque su sonda diga que sí.
    if (sondas.get(v) && plan.porAplicar.length === 0) plan.detectadas.push(archivo);
    else plan.porAplicar.push(archivo);
  }
  return plan;
}

/**
 * Para pegar a mano: junta los archivos pendientes en bloques. Se corta
 * después de un archivo que agrega un valor a un tipo (Postgres no deja
 * usarlo en la misma ejecución).
 */
export function enBloques(pendientes: { archivo: string; sql: string }[]): { archivos: string[]; sql: string }[] {
  const bloques: { archivos: string[]; sql: string }[] = [];
  let actual: { archivos: string[]; sql: string } | null = null;
  for (const p of pendientes) {
    actual ??= { archivos: [], sql: "" };
    actual.archivos.push(p.archivo);
    actual.sql += `-- ===== ${p.archivo} =====\n${p.sql.trim()}\n\n`;
    if (/alter\s+type\s+[\w.]+\s+add\s+value/i.test(p.sql)) {
      bloques.push(actual);
      actual = null;
    }
  }
  if (actual) bloques.push(actual);
  return bloques;
}

/**
 * Con solo las sondas de la API: versiones que faltan. Una versión sin sonda
 * de API se da por aplicada si la siguiente que sí tiene sonda lo está.
 */
export function faltantesPorRest(existe: ReadonlyMap<string, boolean>): string[] {
  const faltan: string[] = [];
  let pendientesSinSonda: string[] = [];
  for (const v of VERSIONES) {
    if (!v.rest) {
      pendientesSinSonda.push(v.version);
      continue;
    }
    if (existe.get(v.version)) pendientesSinSonda = [];
    else {
      faltan.push(...pendientesSinSonda, v.version);
      pendientesSinSonda = [];
    }
  }
  return faltan;
}
