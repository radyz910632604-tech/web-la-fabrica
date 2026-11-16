/** Tipos de aviso y canales posibles (al cliente solo por WhatsApp). */
export const TIPOS_AVISO = [
  { tipo: "resumen_mediodia", nombre: "Resumen del mediodía", detalle: "A cada persona según su rol.", destino: "personal", defecto: "push" },
  { tipo: "resumen_cierre", nombre: "Resumen del cierre", detalle: "Al final del día, según su rol.", destino: "personal", defecto: "push" },
  { tipo: "citas_del_dia", nombre: "Citas del día", detalle: "Cada mañana, para confirmación.", destino: "personal", defecto: "push" },
  { tipo: "cita_no_llego", nombre: "Cita que no llegó", detalle: "Al vendedor que la agendó.", destino: "personal", defecto: "push" },
  { tipo: "carro_listo", nombre: "Carro listo", detalle: "Al cliente, si aceptó mensajes.", destino: "cliente", defecto: "whatsapp" },
  { tipo: "cotizacion", nombre: "Cotización", detalle: "Al cliente, con botones para aprobar.", destino: "cliente", defecto: "whatsapp" },
  { tipo: "encuesta", nombre: "Encuesta de satisfacción", detalle: "Al cliente, 3 horas después de entregar.", destino: "cliente", defecto: "whatsapp" },
  { tipo: "recordatorio_mantenimiento", nombre: "Recordatorio de mantenimiento", detalle: "Al cliente, cuando toca el servicio.", destino: "cliente", defecto: "whatsapp" },
] as const;

export const CANALES_PERMITIDOS: Record<"personal" | "cliente", string[]> = {
  personal: ["push", "whatsapp", "ambos", "apagado"],
  cliente: ["whatsapp", "apagado"],
};

export const NOMBRE_CANAL: Record<string, string> = { push: "Aviso en el celular (gratis)", whatsapp: "WhatsApp (cuesta)", ambos: "Celular y WhatsApp", apagado: "Apagado" };
