import { NOMBRE_ESTADO } from "@/lib/taller/estados";
import type { Rol } from "@/lib/roles";
import type { Intencion } from "@/lib/ia/esquemas";

/**
 * Textos que la app devuelve por WhatsApp. Funciones puras, con pruebas.
 * WhatsApp permite *negrita* y botones de hasta 20 caracteres.
 */

export type Boton = { id: string; titulo: string };
/** Texto, botones y, si se pidió, un PDF (enlace que vence en una hora) para mandarlo como documento. */
export type Respuesta = { texto: string; botones?: Boton[]; documento?: { url: string; nombre: string } };

const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const placaBonita = (p: string) => p.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2");

/** Qué puede registrar cada rol por WhatsApp. La base vuelve a revisarlo al guardar. */
export const PERMITIDO: Record<Exclude<Intencion, "ayuda" | "desconocido" | "historial">, readonly Rol[]> = {
  nuevo_ingreso: ["gerencia", "administrador", "asesor"],
  avance: ["gerencia", "administrador", "asesor", "tecnico"],
  correccion: ["gerencia", "administrador", "asesor", "tecnico"],
  repuestos: ["gerencia", "administrador", "almacen"],
  compra: ["gerencia", "administrador", "almacen"],
  recepcion: ["gerencia", "administrador", "almacen"],
  documento: ["gerencia", "administrador", "asesor"],
  comprobante_venta: ["gerencia", "administrador", "asesor", "recepcion"],
  pago: ["gerencia", "administrador", "asesor", "recepcion"],
  cita: ["gerencia", "administrador", "asesor", "vendedor_redes"],
  cotizacion: ["gerencia", "administrador", "asesor"],
};

const EJEMPLOS: Record<string, string> = {
  nuevo_ingreso: "• *Ingreso:* «Ingresa placa ABC-123, Toyota Yaris 2018 plomo, 85 mil km, cliente Juan Pérez 987654321, por ruido en la caja, entrega mañana 5pm»",
  avance: "• *Avances:* «ABC-123 diagnóstico: sincronizador de tercera gastado», «ABC-123 el cliente aprobó y ya pedí los repuestos», «ABC-123 listo». Fotos: mándalas con la placa escrita, o sola y te pregunto de qué carro son.",
  correccion: "• *Corregir:* justo después de guardar, «No, el kilometraje es 58 mil» o «el celular es 987654321».",
  repuestos: "• *Repuestos para un carro:* foto de los repuestos o del vale con la placa escrita, o una nota de voz: «ABC-123 salieron 1 sincronizador de tercera y 4 litros de aceite ATF».",
  compra: "• *Compra:* manda la foto o el PDF de la factura del proveedor (escribe la placa si es para un carro).",
  recepcion: "• *Llegaron repuestos:* manda una nota de voz («llegaron 4 galones de aceite 10W40 de Lubricantes Demo, factura F001-123, a 85 cada uno») y después la foto de los repuestos o de la factura.",
  documento: "• *Pedir un PDF:* «recibo ABC123», «cotización ABC123», «orden ABC123» o «cierre de caja».",
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
      "Guardo al toque y te digo qué guardé; si algo salió mal, me lo corriges. Pagos y cotizaciones te los muestro antes con *Confirmar*.",
    ].join("\n"),
  };
}

export const SIN_ACCESO: Respuesta = { texto: "Este número es de uso interno del taller." };

const CAMPO: Record<string, string> = {
  placa: "¿De qué placa es esto? Escríbela (por ejemplo ABC-123) o manda una foto de la placa.",
  servicios: "¿Qué *servicio* pidió el cliente?",
  cliente_celular: "Es un carro nuevo. ¿Cuál es el *celular del cliente*? (9 dígitos)",
  cliente_nombre: "¿Cuál es el *nombre del cliente*?",
  texto_avance: "¿Qué pasó con el carro? Cuéntame el avance, el diagnóstico o el estado.",
  monto: "¿De cuánto fue el *pago*?",
  medio_pago: "¿Cómo pagó? Efectivo, Yape, Plin, tarjeta o transferencia.",
  fecha_hora: "¿Para qué *día y hora* es la cita?",
  entrega_prometida: "¿Para qué *día y hora* le prometiste el carro al cliente? Por ejemplo «hoy 6pm» o «mañana 10am». Si todavía no se sabe, responde «por definir».",
  items_cotizacion: "¿Qué ítems lleva la cotización? Por ejemplo «pastillas 180, mano de obra 60».",
  items_compra: "¿Qué repuestos llegaron? Di la cantidad, el nombre y el precio por unidad, por ejemplo «4 aceite 10W40 a 85, 2 filtros a 30».",
  proveedor: "¿De qué *proveedor* son? (el nombre de la tienda o empresa)",
  foto_evidencia: "Manda la *foto* de los repuestos o de la factura como evidencia. Si no tienes foto, responde «sin foto».",
  orden: "No encontré una orden abierta para esa placa. Revisa la placa.",
};

export function pedirDato(campo: string, datos?: Record<string, unknown>): string {
  // Costo de un repuesto que no está en el inventario: «costo:2» es el tercer ítem.
  if (campo.startsWith("costo:")) {
    const item = ((datos?.items ?? []) as { descripcion: string }[])[Number(campo.slice(6))];
    return `«${item?.descripcion ?? "ese repuesto"}» no está en el inventario. ¿Cuánto costó cada uno? (con IGV, por ejemplo «180»)`;
  }
  return CAMPO[campo] ?? `Falta el dato: ${campo}.`;
}

export function botonesConfirmar(borradorId: string): Boton[] {
  return [
    { id: `confirmar:${borradorId}`, titulo: "Confirmar" },
    { id: `corregir:${borradorId}`, titulo: "Corregir" },
  ];
}

const ESTADO: Record<string, string> = { ...NOMBRE_ESTADO, listo: "Listo para entregar" };

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
        d.diagnostico ? `Diagnóstico: ${d.diagnostico}` : null,
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
    case "repuestos": {
      const items = (d.items ?? []) as { descripcion: string; cantidad: number; repuesto: string | null; costo: number | null; stock: number | null }[];
      return [
        `📦 *Repuestos para ${placa}*${orden}`,
        ...items.map((i) => `• ${i.cantidad}× ${i.descripcion}${i.costo !== null ? ` — ${soles(i.costo)}${i.cantidad !== 1 ? " c/u" : ""}` : ""}${i.repuesto ? " (del inventario)" : " (repuesto nuevo)"}`),
      ].join("\n");
    }
    case "recepcion": {
      const items = (d.items ?? []) as { descripcion: string; cantidad: number; precio: number | null; repuesto: string | null }[];
      const total = items.reduce((a, i) => a + (i.precio ?? 0) * i.cantidad, 0);
      return [
        "*Llegaron repuestos*",
        `Proveedor: ${d.proveedor ?? "—"}${d.comprobante ? ` · ${d.comprobante}` : " · sin comprobante"}`,
        ...items.map((i) => `• ${i.cantidad} × ${i.descripcion}${i.precio !== null ? ` a ${soles(i.precio)}` : " (sin precio)"}${placa ? "" : i.repuesto ? ` → inventario: ${i.repuesto}` : " → no está en el inventario"}`),
        total ? `Total: ${soles(total)}` : null,
        placa ? `Para ${placa}${orden}` : null,
        Array.isArray(d.fotos) && d.fotos.length ? `Foto de evidencia: ${d.fotos.length}` : "Sin foto de evidencia",
        "Quedará *por confirmar* en Compras; al confirmarla, entra al inventario.",
      ].filter(Boolean).join("\n");
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
