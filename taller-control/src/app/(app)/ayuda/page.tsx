import { ActivarAvisos } from "@/components/avisos/activar-avisos";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { NOMBRE_ROL, ROLES, type Rol } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";

export const metadata = { title: "Ayuda" };

/** Hoja de uso de una página por rol (especificación, sección 7). */
const GUIAS: Record<Rol, { para: string; pasos: string[] }> = {
  gerencia: {
    para: "Ver cómo va cada taller y decidir.",
    pasos: [
      "El panel muestra los carros en el taller, los listos y los que esperan repuesto. Cambia de taller arriba a la izquierda.",
      "En Personal agregas a tu equipo con su celular y le das uno o varios roles. Si deja de trabajar, lo das de baja: pierde el acceso al instante y su historial se conserva.",
      "En Configuración ajustas la garantía, la tolerancia de citas, el IGV, la meta del mes y si administración puede ver la utilidad.",
      "En Reportes ves ventas, compras, utilidad y comisiones mes a mes, y los descargas en Excel o PDF.",
    ],
  },
  administrador: {
    para: "Dejar todo listo para que el taller funcione.",
    pasos: [
      "Agrega al personal en Personal. No puedes dar el rol de gerencia.",
      "En Configuración: datos del taller, servicios que ofrecen, reglas y meta del mes.",
      "También puedes registrar ingresos y citas como un asesor.",
    ],
  },
  asesor: {
    para: "Recibir carros, seguirlos y entregarlos.",
    pasos: [
      "Nuevo ingreso: escribe la placa. Si el carro ya vino, se completa solo. Elige los servicios, toma fotos y asigna técnico.",
      "En Órdenes ves todo lo que está en el taller por estado. Toca una orden para cambiar su estado o agregar un trabajo adicional.",
      "Cuando el cliente recoge su carro, abre la orden y toca «Entregar al cliente».",
      "En Citas confirmas, reagendas o registras el ingreso de quien llegó por redes.",
    ],
  },
  recepcion: {
    para: "Cobrar, entregar el carro y cuadrar la caja.",
    pasos: [
      "Al empezar el día, en Caja toca «Abrir caja» y escribe con cuánto sencillo empiezas.",
      "Cada pago que registres (adelanto, abono o saldo) entra solo a la caja abierta. Gastos menores y retiros también se anotan ahí.",
      "Registra la boleta o factura que entregaste y, si hay un descuento o devolución, su nota de crédito.",
      "Cuando el cliente recoge su carro listo, abre la orden y toca «Entregar al cliente».",
      "Al terminar, «Cerrar caja»: cuenta el efectivo y el sistema te dice si sobra o falta. Descarga el PDF del cierre.",
    ],
  },
  tecnico: {
    para: "Avisar en qué va cada carro.",
    pasos: [
      "En Mis trabajos están los carros que te asignaron.",
      "Toca un carro: «Empezar trabajo», «Espera repuesto» o «Marcar listo». Un toque basta.",
      "Escribe un avance cuando pase algo importante y sube fotos del trabajo.",
      "No ves precios ni datos del cliente. La entrega al cliente la registra el asesor.",
    ],
  },
  almacen: {
    para: "Saber qué carros esperan repuesto.",
    pasos: [
      "El panel muestra los carros parados por un repuesto. Toca uno para ver sus servicios y avances.",
      "Registrar compra: la factura del proveedor (sube el XML o una foto y se llena sola). En cada línea eliges si va a una orden o al inventario.",
      "En Inventario ves el stock de cada repuesto. «Entregar» lo saca para una orden; los que llegaron a su mínimo salen en rojo.",
      "Por WhatsApp puedes mandar la foto de la factura: queda por confirmar hasta que la revises.",
    ],
  },
  vendedor_redes: {
    para: "Agendar citas y ver si tus clientes llegaron.",
    pasos: [
      "Agendar cita: nombre, celular, fecha, hora, servicio, red y campaña.",
      "Si el cliente llega ese día, la cita se une sola a su ingreso y queda como «Llegó».",
      "Si pasa la hora y no llegó, queda como «No llegó». Puedes reagendarla.",
      "En Citas ves tu asistencia de los últimos 30 días por campaña.",
    ],
  },
  confirmador: {
    para: "Confirmar las citas del día.",
    pasos: [
      "Cada mañana abre Citas: verás las de hoy por hora.",
      "Llama al cliente y toca «Confirmar». Solo puedes confirmar; el resto lo cambia el asesor o el vendedor.",
    ],
  },
};

export default async function Ayuda() {
  const ctx = await obtenerContexto();
  const propios = ROLES.filter((r) => ctx.roles.includes(r));
  const otros = ROLES.filter((r) => !ctx.roles.includes(r));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Ayuda</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">Lo que puedes hacer con tu rol, paso a paso.</p>
      </header>
      <Tarjeta id="avisos" aria-labelledby="t-avisos" className="scroll-mt-24">
        <CabeceraTarjeta id="t-avisos" titulo="Avisos en este celular" />
        <ActivarAvisos clavePublica={process.env.VAPID_PUBLICA ?? null} />
      </Tarjeta>
      <Tarjeta aria-labelledby="t-wa">
        <CabeceraTarjeta id="t-wa" titulo="Por WhatsApp" detalle="Escribe, manda un audio o una foto al número del taller. Antes de guardar te muestro lo que entendí, con «Confirmar» y «Corregir»." />
        <p className="text-[15px] leading-6 text-tinta-2">Escribe «ayuda» en el chat del taller para ver los ejemplos de tu rol. Por ejemplo: «ABC123 listo», «pago ABC123 150 yape», «historial ABC123» o la foto de una factura.</p>
      </Tarjeta>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {propios.map((r) => (
          <Guia key={r} rol={r} />
        ))}
      </div>
      {otros.length ? (
        <details className="rounded-tarjeta bg-tarjeta p-5 shadow-reposo md:p-6">
          <summary className="cursor-pointer text-[17px] font-semibold">Ver la ayuda de los otros roles</summary>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {otros.map((r) => (
              <Guia key={r} rol={r} interna />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function Guia({ rol, interna = false }: { rol: Rol; interna?: boolean }) {
  const g = GUIAS[rol];
  const contenido = (
    <>
      <CabeceraTarjeta titulo={NOMBRE_ROL[rol]} detalle={g.para} />
      <ol className="flex flex-col gap-3 text-[15px] leading-6">
        {g.pasos.map((p, i) => (
          <li key={p} className="flex gap-3">
            <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-acento-suave text-[13px] font-semibold">{i + 1}</span>
            <span>{p}</span>
          </li>
        ))}
      </ol>
    </>
  );
  return interna ? <div className="rounded-interna bg-interna p-4">{contenido}</div> : <Tarjeta>{contenido}</Tarjeta>;
}
