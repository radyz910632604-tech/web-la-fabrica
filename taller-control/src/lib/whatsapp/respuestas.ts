import type { Rol } from "@/lib/roles";
import type { Intencion } from "@/lib/ia/esquemas";

/**
 * Textos que la app devuelve por WhatsApp. Funciones puras, con pruebas.
 * WhatsApp permite *negrita* y botones de hasta 20 caracteres.
 */

export type Boton = { id: string; titulo: string };
export type Respuesta = { texto: string; botones?: Boton[] };

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const placaBonita = (p: string) => p.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2");

/** Qué puede registrar cada rol por WhatsApp. La base vuelve a revisarlo al guardar. */
export const PERMITIDO: Record<Exclude<Intencion, "ayuda" | "desconocido" | "historial">, readonly Rol[]> = {
  nuevo_ingreso: ["gerencia", "administrador", "asesor"],
  avance: ["gerencia", "administrador", "asesor", "tecnico"],
  compra: ["gerencia", "administrador", "almacen"],
  comprobante_venta: ["gerencia", "administrador", "asesor", "recepcion"],
  pago: ["gerencia", "administrador", "asesor", "recepcion"],
  cita: ["gerencia", "administrador", "asesor", "vendedor_redes"],
  cotizacion: ["gerencia", "administrador", "asesor"],
};

const EJEMPLOS: Record<string, string> = {
  nuevo_ingreso: "• *Ingreso:* «ingreso ABC123 Juan Pérez 987654321 para cambio de aceite, 85000 km, entrega hoy 6pm»",
  avance: "• *Avance:* «ABC123 ya se cambió el embrague» o «ABC123 listo». Puedes mandar fotos o video con la placa escrita.",
  compra: "• *Compra:* manda la foto o el PDF de la factura del proveedor (escribe la placa si es para un carro).",
  comprobante_venta: "• *Boleta o factura:* manda la foto o el PDF de la que entregaste al cliente.",
  pago: "• *Pago:* «pago ABC123 150 yape abono»",
  cita: "• *Cita:* «cita Ana Díaz 987654321 mañana 10am cambio de aceite, Facebook»",
  cotizacion: "• *Cotización:* «cotiza ABC123 pastillas de freno 180, mano de obra 60»",
};

export function ayuda(roles: readonly Rol[], nombre: string): Respuesta {
  const lineas = Object.entries(PERMITIDO)
    .filter(([, quienes]) => quienes.some((r) => roles.includes(r)))
    .map(([k]) => EJEMPLOS[k]);
  const extra = roles.includes("confirmador") ? ["• *Citas del día:* te llegan cada mañana para confirmarlas."] : [];
  return {
    texto: [
      `Hola, ${nombre.split(" ")[0]}. Puedes escribir, mandar un audio o una foto. Ejemplos para ti:`,
      ...lineas,
      ...extra,
      "• *Historial:* «historial ABC123»",
      "Antes de guardar te muestro lo que entendí, con *Confirmar* y *Corregir*.",
    ].join("\n"),
  };
}

export const SIN_ACCESO: Respuesta = { texto: "Este número no está registrado en el sistema del taller, así que no puedo procesar el mensaje. Si trabajas en el taller, pide a administración que registre tu celular." };

const CAMPO: Record<string, string> = {
  placa: "¿Cuál es la *placa*? Escríbela (por ejemplo ABC-123) o manda una foto de la placa.",
  servicios: "¿Qué *servicio* pidió el cliente?",
  cliente_celular: "Es un carro nuevo. ¿Cuál es el *celular del cliente*? (9 dígitos)",
  cliente_nombre: "¿Cuál es el *nombre del cliente*?",
  texto_avance: "¿Qué avance quieres registrar?",
  monto: "¿De cuánto fue el *pago*?",
  medio_pago: "¿Cómo pagó? Efectivo, Yape, Plin, tarjeta o transferencia.",
  fecha_hora: "¿Para qué *día y hora* es la cita?",
  entrega_prometida: "¿Para qué *día y hora* le prometiste el carro al cliente? Por ejemplo «hoy 6pm» o «mañana 10am». Si todavía no se sabe, responde «por definir».",
  items_cotizacion: "¿Qué ítems lleva la cotización? Por ejemplo «pastillas 180, mano de obra 60».",
  orden: "No encontré una orden abierta para esa placa. Revisa la placa.",
};

export function pedirDato(campo: string): string {
  return CAMPO[campo] ?? `Falta el dato: ${campo}.`;
}

export function botonesConfirmar(borradorId: string): Boton[] {
  return [
    { id: `confirmar:${borradorId}`, titulo: "Confirmar" },
    { id: `corregir:${borradorId}`, titulo: "Corregir" },
  ];
}

const ESTADO: Record<string, string> = { en_proceso: "En proceso", esperando_repuesto: "Esperando repuesto", listo: "Listo para entregar" };

/** Resumen de lo que se va a guardar, para que la persona confirme. */
export function resumen(intencion: string, d: Record<string, unknown>): string {
  const placa = typeof d.placa === "string" ? placaBonita(d.placa) : "";
  const orden = typeof d.ordenNumero === "number" ? ` (OT-${String(d.ordenNumero).padStart(6, "0")})` : "";
  switch (intencion) {
    case "nuevo_ingreso": {
      const c = (d.cliente ?? {}) as { nombre?: string; celular?: string; nuevo?: boolean };
      return [
        `*Nuevo ingreso* ${placa}`,
        `Cliente: ${c.nombre ?? "—"}${c.celular ? ` · ${c.celular.replace(/^\+51/, "")}` : ""}${c.nuevo ? " (nuevo)" : ""}`,
        `Servicios: ${(d.servicios as string[]).join(", ")}`,
        d.kilometraje ? `Kilometraje: ${Number(d.kilometraje).toLocaleString("es-PE")} km` : null,
        d.observaciones ? `Observaciones: ${d.observaciones}` : null,
        `Entrega prometida: ${typeof d.entregaTexto === "string" ? d.entregaTexto : "por definir"}`,
      ].filter(Boolean).join("\n");
    }
    case "avance":
      return [
        `*Avance* ${placa}${orden}`,
        d.texto ? `«${d.texto}»` : null,
        d.estado ? `Nuevo estado: ${ESTADO[d.estado as string] ?? d.estado}` : null,
        Array.isArray(d.archivos) && d.archivos.length ? `${d.archivos.length} ${d.archivos.length === 1 ? "foto o video" : "fotos o videos"} para la orden` : null,
      ].filter(Boolean).join("\n");
    case "pago":
      return [
        `*Pago* ${placa}${orden}`,
        `${soles(Number(d.monto))} · ${String(d.medio)} · ${d.tipo === "saldo" ? "saldo (pago final)" : d.tipo}`,
        typeof d.saldo === "number" ? `Saldo pendiente antes de este pago: ${soles(d.saldo)}` : null,
        "Quedará *por confirmar* en Caja → Cobros.",
      ].filter(Boolean).join("\n");
    case "cita":
      return [
        "*Cita*",
        `${d.nombre} · ${String(d.celular).replace(/^\+51/, "")}`,
        `${d.cuandoTexto}`,
        `Servicio: ${d.servicio} · ${d.red}${d.campana ? ` · ${d.campana}` : ""}`,
      ].join("\n");
    case "cotizacion": {
      const items = (d.items ?? []) as { descripcion: string; cantidad: number; precio: number }[];
      const total = items.reduce((a, i) => a + i.cantidad * i.precio, 0);
      return [`*Cotización* ${placa}${orden}`, ...items.map((i) => `• ${i.cantidad !== 1 ? `${i.cantidad} × ` : ""}${i.descripcion}: ${soles(i.cantidad * i.precio)}`), `Total con IGV: ${soles(total)}`].join("\n");
    }
    case "compra":
    case "comprobante_venta": {
      const l = d.lectura as { tipo: string; serie: string | null; numero: string | null; emisor_nombre: string | null; total: number | null; fecha: string | null; lineas: { descripcion: string }[] };
      return [
        `*${intencion === "compra" ? "Compra" : "Comprobante de venta"}* (leído por IA)`,
        `${l.tipo} ${l.serie ?? ""}-${l.numero ?? ""}${l.emisor_nombre && intencion === "compra" ? ` · ${l.emisor_nombre}` : ""}`,
        l.fecha ? `Fecha: ${l.fecha.split("-").reverse().join("/")}` : null,
        l.total !== null ? `Total: ${soles(l.total)}` : null,
        l.lineas.length ? `${l.lineas.length} ${l.lineas.length === 1 ? "línea" : "líneas"}: ${l.lineas.slice(0, 3).map((x) => x.descripcion).join(", ")}${l.lineas.length > 3 ? "…" : ""}` : null,
        placa ? `Para ${placa}${orden}` : intencion === "compra" ? "Va al stock" : "Sin orden",
        "Quedará *por confirmar* hasta que alguien lo revise en la app.",
      ].filter(Boolean).join("\n");
    }
    default:
      return "Registro";
  }
}

/** Historial de un carro en pocas líneas. */
export function historial(placa: string, visitas: { numero: number; fecha: string; estado: string; servicios: string[] }[]): string {
  if (!visitas.length) return `No encontré visitas de ${placaBonita(placa)} que puedas ver.`;
  return [
    `*Historial de ${placaBonita(placa)}*`,
    ...visitas.slice(0, 6).map((v) => `• ${v.fecha.split("-").reverse().join("/")} · OT-${String(v.numero).padStart(6, "0")} · ${v.servicios.join(", ") || "sin servicios"} (${v.estado.replace("_", " ")})`),
  ].join("\n");
}
