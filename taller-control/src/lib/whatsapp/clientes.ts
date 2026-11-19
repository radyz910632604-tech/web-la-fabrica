import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entrada, Salida } from "./procesar";

/**
 * Mensajes de CLIENTES (no del personal): botones de la encuesta de
 * satisfacción y de la aprobación de cotizaciones, y un comentario después
 * de la encuesta. Se verifica siempre que el celular sea del cliente.
 * No hay sesión de una persona del taller: se usa la llave de servicio solo
 * para estas tres respuestas, y queda todo en la auditoría de mensajes.
 */
export async function atenderCliente(admin: SupabaseClient, celular: string, e: Entrada): Promise<{ salida: Salida; empresaId: string; clienteId: string } | null> {
  const { data: clientes } = await admin.from("clientes").select("id, empresa_id, nombre, empresas (nombre, telefono)").eq("celular", celular);
  if (!clientes?.length) return null;
  const taller = (c: (typeof clientes)[number]) => {
    const t = Array.isArray(c.empresas) ? c.empresas[0] : c.empresas;
    return { nombre: (t as { nombre?: string } | null)?.nombre ?? "el taller", telefono: (t as { telefono?: string | null } | null)?.telefono ?? null };
  };
  const boton = e.boton_id ?? "";

  // Encuesta: «encuesta:<id>:<puntaje>»
  const enc = /^encuesta:([0-9a-f-]{36}):([1-5])$/.exec(boton);
  if (enc) {
    const { data: fila } = await admin.from("encuestas").select("id, empresa_id, cliente_id, respondida_en").eq("id", enc[1]).maybeSingle();
    const c = clientes.find((x) => x.id === fila?.cliente_id);
    if (!fila || !c) return null;
    if (!fila.respondida_en) await admin.from("encuestas").update({ puntaje: Number(enc[2]), respondida_en: new Date().toISOString() }).eq("id", fila.id);
    const bien = Number(enc[2]) >= 4;
    return {
      empresaId: fila.empresa_id,
      clienteId: c.id,
      salida: { resultado: "encuesta", respuesta: { texto: bien ? `¡Gracias, ${c.nombre.split(" ")[0]}! Nos alegra que te haya ido bien en ${taller(c).nombre}.` : `Gracias por contarnos, ${c.nombre.split(" ")[0]}. ¿Qué podemos mejorar? Escríbelo en un mensaje y lo revisamos.` } },
    };
  }

  // Cotización: «cot:<id>:si|no»
  const cot = /^cot:([0-9a-f-]{36}):(si|no)$/.exec(boton);
  if (cot) {
    const { data: k } = await admin.from("cotizaciones").select("empresa_id, ordenes_trabajo (cliente_id)").eq("id", cot[1]).maybeSingle();
    const clienteId = (Array.isArray(k?.ordenes_trabajo) ? k?.ordenes_trabajo[0] : k?.ordenes_trabajo)?.cliente_id as string | undefined;
    const c = clientes.find((x) => x.id === clienteId);
    if (!k || !c) return null;
    const { data: r } = await admin.rpc("respuesta_cotizacion_cliente", { p_cotizacion: cot[1], p_celular: celular, p_aprueba: cot[2] === "si" });
    const t = taller(c);
    const texto =
      r === "aprobada"
        ? `¡Gracias, ${c.nombre.split(" ")[0]}! Quedó aprobada. Empezamos con el trabajo y te avisamos cuando esté listo.`
        : r === "rechazada"
          ? `Entendido, no haremos ese trabajo.${t.telefono ? ` Si quieres conversarlo, llámanos al ${t.telefono}.` : ""}`
          : "Esa cotización ya estaba respondida. Si cambiaste de opinión, llámanos.";
    return { empresaId: k.empresa_id, clienteId: c.id, salida: { resultado: "cotizacion", respuesta: { texto } } };
  }

  // Comentario después de una encuesta (hasta 2 días después)
  const texto = (e.texto ?? "").trim();
  if (texto) {
    const { data: ultima } = await admin
      .from("encuestas")
      .select("id, empresa_id, cliente_id, comentario, respondida_en")
      .in("cliente_id", clientes.map((c) => c.id))
      .not("respondida_en", "is", null)
      .is("comentario", null)
      .gte("respondida_en", new Date(Date.now() - 2 * 86400_000).toISOString())
      .order("respondida_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultima) {
      await admin.from("encuestas").update({ comentario: texto.slice(0, 1000) }).eq("id", ultima.id);
      return { empresaId: ultima.empresa_id, clienteId: ultima.cliente_id, salida: { resultado: "encuesta", respuesta: { texto: "Gracias por tu comentario. Lo va a leer el equipo del taller." } } };
    }
  }

  // Cualquier otro mensaje de un cliente: este número no atiende consultas.
  const c = clientes[0];
  const t = taller(c);
  return {
    empresaId: c.empresa_id,
    clienteId: c.id,
    salida: { resultado: "respondido", respuesta: { texto: `Hola ${c.nombre.split(" ")[0]}, este número solo envía avisos de ${t.nombre}.${t.telefono ? ` Para atenderte, llámanos o escríbenos al ${t.telefono}.` : " Para atenderte, comunícate con el taller."}` } },
  };
}
