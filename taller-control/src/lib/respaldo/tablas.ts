/**
 * Tablas que entran en la copia de seguridad. La lista de `public` se usa
 * cuando no hay conexión directa a la base (se lee por la API). Una prueba
 * revisa que no falte ninguna tabla nueva.
 * No van: `respaldos` (el registro de las propias copias) ni `estado_sistema`.
 */
export const TABLAS_PUBLICAS = [
  "empresas", "perfiles", "miembros", "configuracion_empresa", "metas_ventas", "catalogo_servicios", "clientes", "vehiculos", "citas",
  "ordenes_trabajo", "orden_servicios", "orden_estados_historial", "orden_avances", "archivos", "proveedores", "compras", "compra_items",
  "comprobantes_venta", "notas_credito", "cotizaciones", "cotizacion_items", "pagos", "recibos", "gastos", "costos_personal", "esquemas_pago",
  "mano_obra_servicio", "reglas_comision", "comisiones", "cierres_diarios", "cajas", "movimientos_caja", "caja_maestra_diaria", "repuestos", "movimientos_inventario",
  "mensajes_whatsapp", "borradores_whatsapp", "preferencias_whatsapp", "config_avisos", "avisos", "encuestas",
  "recordatorios_mantenimiento", "suscripciones_push", "auditoria",
] as const;

export const TABLAS_EXCLUIDAS = ["respaldos", "estado_sistema"] as const;

/** Con conexión directa también se guardan los accesos (correo interno y contraseña cifrada). */
export const TABLAS_AUTH = ["users", "identities"] as const;

export type ArchivoRespaldo = {
  formato: "taller-control-respaldo";
  version: 1;
  creado_en: string;
  modo: "completo" | "datos";
  versiones_base: string[];
  tablas: Record<string, Record<string, unknown>[]>;
};

/** Nombre del archivo: 2026/2026-11-17-0310.json.gz (hora de Lima). */
export function rutaRespaldo(ahora: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(ahora)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}/${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.json.gz`;
}

/**
 * ¿Toca hacer la copia diaria? De madrugada (1 a 5 a. m. de Lima) si la última
 * tiene más de 20 horas; a cualquier hora si ya pasaron 36 (el servidor estuvo
 * apagado o falló) o si nunca se hizo.
 */
export function tocaRespaldo(ahora: Date, ultimo: Date | null): boolean {
  if (!ultimo) return true;
  const horas = (ahora.getTime() - ultimo.getTime()) / 3_600_000;
  if (horas >= 36) return true;
  const horaLima = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", hourCycle: "h23" }).format(ahora));
  return horas >= 20 && horaLima >= 1 && horaLima < 5;
}

/** Qué copias viejas se borran: las de más de 30 días, pero siempre quedan las 7 más nuevas. */
export function respaldosABorrar<T extends { creado_en: string }>(lista: T[], ahora: Date): T[] {
  const orden = [...lista].sort((a, b) => b.creado_en.localeCompare(a.creado_en));
  const limite = ahora.getTime() - 30 * 86_400_000;
  return orden.slice(7).filter((r) => new Date(r.creado_en).getTime() < limite);
}
