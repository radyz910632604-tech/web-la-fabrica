import Link from "next/link";
import { notFound } from "next/navigation";
import { Boton } from "@/components/ui/boton";
import { Tarjeta } from "@/components/ui/tarjeta";
import { destinoPorClave } from "@/lib/navegacion";

/** Qué hará cada pantalla que todavía no existe (según la especificación). */
const QUE_HARA: Record<string, { titulo?: string; llega?: string; puntos: string[] }> = {
  ordenes: { puntos: ["Lista de órdenes por estado: en taller, en proceso, esperando repuesto, listo y entregado.", "Cada orden con sus servicios, técnico, fotos, videos y avances.", "Historial completo por placa y marca de reingreso por garantía."] },
  "mis-trabajos": { puntos: ["Los carros que tienes asignados, con sus servicios y fotos.", "Cambiar el estado con un toque y reportar avances con texto o foto.", "Sin precios ni datos del cliente."] },
  citas: { puntos: ["Citas de redes con cliente, celular, servicio, red y campaña.", "Se unen solas con el ingreso del carro el mismo día.", "Si pasa la hora y no llegó, se marca \"no llegó\" y se avisa al vendedor."] },
  clientes: { puntos: ["Ficha con celular, DNI o RUC, origen y permiso para recibir mensajes.", "Sus carros, visitas, total gastado y última visita.", "Lista de clientes que no vienen hace 6 meses."] },
  compras: { puntos: ["Compras con foto, PDF o XML del comprobante.", "Cada línea asignada a un carro o a stock.", "Montos leídos por IA quedan por confirmar."] },
  reportes: { puntos: ["Panel de gerencia por taller y conjunto.", "Reporte mensual por persona con comisiones.", "Exportación a Excel."] },
  "nuevo-ingreso": { puntos: ["Placa, cliente, servicios y fotos en pocos toques.", "Si el carro ya vino antes, se completa solo.", "Si tenía cita ese día, se une sola."] },
  "registrar-pago": { puntos: ["Adelanto o saldo, con medio de pago: efectivo, Yape, Plin, tarjeta o transferencia.", "Saldo pendiente por orden y lista de deudas."] },
  "agendar-cita": { puntos: ["Cliente, celular, fecha y hora, servicio, red y campaña.", "El confirmador la ve en su lista del día."] },
  "confirmar-citas": { puntos: ["Las citas del día en una lista.", "Marcar confirmada con un toque."] },
  "reportar-avance": { puntos: ["Escribir o dictar lo que se hizo en el carro.", "También por WhatsApp desde la Fase 2."] },
  "subir-fotos": { puntos: ["Fotos y videos del carro, reducidos para no gastar datos.", "Quedan guardados en la orden."] },
  "registrar-compra": { puntos: ["Foto del comprobante del proveedor.", "Cada repuesto asignado a un carro o a stock."] },
  "entregar-repuesto": { puntos: ["Registrar qué repuesto del stock se entregó a cada carro."] },
  ayuda: { titulo: "Ayuda", llega: "el cierre de la Fase 1", puntos: ["Una hoja de una página por rol con lo que puedes hacer y cómo.", "Mientras tanto, pregunta a administración."] },
};

export default async function Pronto({ params }: { params: Promise<{ clave: string }> }) {
  const { clave } = await params;
  const destino = destinoPorClave(clave);
  const info = QUE_HARA[clave];
  if (!info) notFound();
  const titulo = info.titulo ?? destino?.nombre ?? clave;
  const llega = info.llega ?? destino?.llega ?? "una próxima entrega";

  return (
    <div className="max-w-2xl">
      <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] md:text-[30px]">{titulo}</h1>
      <p className="mt-2 text-[15px] text-tinta-2">Esta pantalla llega en la {llega}. Así va a funcionar:</p>
      <Tarjeta className="mt-6">
        <ul className="flex flex-col gap-3 text-[15px] leading-6">
          {info.puntos.map((p) => (
            <li key={p} className="flex gap-3">
              <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-acento" />
              {p}
            </li>
          ))}
        </ul>
      </Tarjeta>
      <Boton asChild variante="secundario" className="mt-6">
        <Link href="/">Volver al panel</Link>
      </Boton>
    </div>
  );
}
