import { notFound } from "next/navigation";
import { TituloCaja } from "@/components/caja/subnav";
import { Estado, type ColorEstado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { formatearMomento } from "@/lib/formato";
import { estadoIa } from "@/lib/ia/proveedor";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

export const metadata = { title: "Mensajes de WhatsApp" };

const RESULTADO: Record<string, [string, ColorEstado]> = {
  confirmado: ["Guardado", "verde"],
  borrador: ["Esperando confirmar", "amarillo"],
  pide_dato: ["Pidió un dato", "amarillo"],
  respondido: ["Respondido", "gris"],
  corregido: ["Corregido", "gris"],
  encuesta: ["Encuesta", "verde"],
  cotizacion: ["Respuesta a cotización", "verde"],
  rechazado: ["Sin permiso", "rojo"],
  sin_acceso: ["Número no registrado", "rojo"],
  error: ["Error", "rojo"],
  recibido: ["Recibido", "gris"],
};
const INTENCION: Record<string, string> = {
  nuevo_ingreso: "Ingreso", avance: "Avance", compra: "Compra", comprobante_venta: "Comprobante", pago: "Pago", cita: "Cita", cotizacion: "Cotización", historial: "Historial", ayuda: "Ayuda", desconocido: "No entendido",
};

/** Auditoría de WhatsApp: cada mensaje que llegó y qué hizo el sistema. */
export default async function MensajesWhatsapp() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from("mensajes_whatsapp")
    .select("id, celular, perfil_id, tipo, texto, transcripcion, intencion, resultado, respuesta, creado_en")
    .eq("empresa_id", ctx.taller.id)
    .order("creado_en", { ascending: false })
    .limit(60);
  const lista = data ?? [];
  const ids = [...new Set(lista.map((m) => m.perfil_id).filter(Boolean))] as string[];
  const { data: perfiles } = ids.length ? await supabase.from("perfiles").select("id, nombre").in("id", ids) : { data: [] };
  const nombres = new Map((perfiles ?? []).map((p) => [p.id, p.nombre as string]));
  const ia = estadoIa();
  const hoy = new Date();
  const guardados = lista.filter((m) => m.resultado === "confirmado").length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Mensajes de WhatsApp"
        detalle={`Todo lo que llega al número del taller y lo que hizo el sistema. ${lista.length ? `${guardados} de los últimos ${lista.length} terminaron guardados.` : ""}`}
      />
      <Tarjeta aria-labelledby="t-estado-wa">
        <CabeceraTarjeta id="t-estado-wa" titulo="Conexión" />
        <ul className="grid gap-2 text-[15px] sm:grid-cols-3">
          <li className="rounded-2xl bg-interna px-4 py-3">
            <Estado color={process.env.CLAVE_API_INTERNA && process.env.CLAVE_API_INTERNA.length >= 32 ? "verde" : "rojo"} texto={process.env.CLAVE_API_INTERNA && process.env.CLAVE_API_INTERNA.length >= 32 ? "API para n8n encendida" : "API para n8n apagada"} />
            <p className="mt-1 text-[13px] text-tinta-3">Se enciende con CLAVE_API_INTERNA.</p>
          </li>
          <li className="rounded-2xl bg-interna px-4 py-3">
            <Estado color={ia.lectura ? "verde" : "amarillo"} texto={ia.lectura ? `IA para leer: ${ia.proveedor}` : "Sin IA para leer"} />
            <p className="mt-1 text-[13px] text-tinta-3">{ia.lectura ? "Lee fotos, PDF y mensajes." : "Entiende mensajes simples sin IA."}</p>
          </li>
          <li className="rounded-2xl bg-interna px-4 py-3">
            <Estado color={ia.audio ? "verde" : "amarillo"} texto={ia.audio ? "Audios activados" : "Audios apagados"} />
            <p className="mt-1 text-[13px] text-tinta-3">{ia.audio ? "Pasa los audios a texto." : "Falta OPENAI_API_KEY."}</p>
          </li>
        </ul>
      </Tarjeta>
      <Tarjeta aria-labelledby="t-mensajes">
        <CabeceraTarjeta id="t-mensajes" titulo="Últimos mensajes" />
        {lista.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-control px-4 py-6 text-center text-[15px] text-tinta-2">Todavía no llegaron mensajes. Cuando n8n esté conectado, aparecerán aquí.</p>
        ) : (
          <ul className="flex flex-col">
            {lista.map((m) => {
              const [texto, color] = RESULTADO[m.resultado] ?? [m.resultado, "gris"];
              return (
                <li key={m.id} className="grid gap-2 border-t border-regla py-3 first:border-t-0 md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-4">
                  <div className="min-w-0 text-[13px]">
                    <p className="text-[15px] font-medium">{m.perfil_id ? (nombres.get(m.perfil_id) ?? "Personal") : formatearCelular(m.celular)}</p>
                    <p className="text-tinta-3">
                      {formatearMomento(new Date(m.creado_en), hoy)} · {m.tipo}
                    </p>
                  </div>
                  <div className="min-w-0 text-[14px]">
                    <p className="line-clamp-3 break-words">{m.transcripcion ? `🎙 ${m.transcripcion}` : (m.texto ?? (m.tipo === "imagen" ? "(foto)" : m.tipo === "documento" ? "(documento)" : "—"))}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-tinta-2">
                      <Estado color={color} texto={texto} />
                      {m.intencion ? <span>{INTENCION[m.intencion] ?? m.intencion}</span> : null}
                    </p>
                  </div>
                  <p className="line-clamp-3 min-w-0 rounded-2xl bg-interna px-3 py-2 text-[13px] break-words whitespace-pre-line text-tinta-2">{m.respuesta ?? "—"}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
