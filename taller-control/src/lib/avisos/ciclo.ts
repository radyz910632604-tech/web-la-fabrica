import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatearCelular } from "@/lib/celulares";
import { stockBajo } from "@/lib/inventario";
import { formatearPlaca } from "@/lib/placas";
import type { Rol } from "@/lib/roles";
import { clienteAdmin } from "@/lib/supabase/admin";
import { cuandoEntrega, duracion } from "@/lib/taller/entrega";
import { NOMBRE_ESTADO, type EstadoOrden, ESTADOS_EN_TRABAJO } from "@/lib/taller/estados";
import { pushAPersona, pushConfigurado } from "./push";
import { aUnaLinea, citaNoLlego, citasDelDia, entregaAtrasada, entregaPorVencer, resumenDelDia, type DatosPersona } from "./textos";

/**
 * Ciclo de avisos: n8n lo llama cada 15 minutos. Arma lo que toca a esa
 * hora (resúmenes, citas del día, citas sin llegada, recordatorios), envía
 * los push y devuelve los WhatsApp pendientes para que n8n los mande.
 *
 * Corre sin sesión de nadie (es un proceso programado), por eso usa la llave
 * de servicio. Solo arma avisos y marca citas como «no llegó», igual que la
 * regla de la base; no toca dinero ni órdenes.
 */

type TipoPersonal = "resumen_mediodia" | "resumen_cierre" | "citas_del_dia" | "cita_no_llego" | "entrega_por_vencer" | "entrega_atrasada";
type Canal = "push" | "whatsapp" | "ambos" | "apagado";

const diaLima = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(d);
const horaLima = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
const inicioDia = (dia: string) => new Date(`${dia}T00:00:00-05:00`);
const uno = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

type Empresa = { id: string; nombre: string; telefono: string | null; mediodia: string; cierre: string; horasSinCambio: number; tolerancia: number; minutosEntrega: number; canales: Map<string, Canal> };

export type AvisoWhatsapp = { id: string; celular: string; plantilla: string | null; idioma: string; variables: string[]; botones: { id: string; titulo: string }[]; texto: string };

export type OrigenCiclo = "n8n" | "interno";

// Un ciclo a la vez: el reloj interno y n8n no se pisan (cada aviso sale una sola vez).
// En globalThis porque el reloj y la API se empaquetan aparte y no comparten variables del archivo.
const turnos = globalThis as { __cicloTaller?: Promise<unknown> };

/**
 * `origen` dice quién lo pidió. El reloj interno arma los avisos y envía los
 * push, pero NO reserva los WhatsApp: esos solo se entregan a n8n, que es
 * quien puede mandarlos.
 */
export function cicloDeAvisos(ahora = new Date(), origen: OrigenCiclo = "n8n") {
  const turno = (turnos.__cicloTaller ?? Promise.resolve()).then(() => cicloReal(ahora, origen));
  turnos.__cicloTaller = turno.catch(() => {});
  return turno;
}

async function cicloReal(ahora: Date, origen: OrigenCiclo) {
  const admin = clienteAdmin();
  const hoy = diaLima(ahora);
  const hora = horaLima(ahora);
  const { data: filas } = await admin
    .from("empresas")
    .select("id, nombre, telefono, configuracion_empresa (hora_resumen_mediodia, hora_cierre, horas_orden_sin_cambio, tolerancia_cita_minutos, minutos_aviso_entrega), config_avisos (tipo, canal)")
    .eq("activa", true);
  const creados: Record<string, number> = {};
  const sumar = (k: string, n = 1) => (creados[k] = (creados[k] ?? 0) + n);

  for (const f of filas ?? []) {
    const cfg = uno(f.configuracion_empresa as never) as { hora_resumen_mediodia: string; hora_cierre: string; horas_orden_sin_cambio: number; tolerancia_cita_minutos: number; minutos_aviso_entrega: number } | null;
    const e: Empresa = {
      id: f.id, nombre: f.nombre, telefono: f.telefono,
      mediodia: (cfg?.hora_resumen_mediodia ?? "12:00").slice(0, 5), cierre: (cfg?.hora_cierre ?? "19:00").slice(0, 5),
      horasSinCambio: cfg?.horas_orden_sin_cambio ?? 48, tolerancia: cfg?.tolerancia_cita_minutos ?? 30, minutosEntrega: cfg?.minutos_aviso_entrega ?? 120,
      canales: new Map(((f.config_avisos ?? []) as { tipo: string; canal: Canal }[]).map((c) => [c.tipo, c.canal])),
    };
    sumar("cita_no_llego", await citasSinLlegada(admin, e, ahora));
    const entregas = await entregasQueVencen(admin, e, ahora);
    sumar("entrega_por_vencer", entregas.porVencer);
    sumar("entrega_atrasada", entregas.atrasadas);
    sumar("recordatorio_mantenimiento", await recordatoriosQueTocan(admin, e, hoy));
    if (hora >= e.mediodia && hora < e.cierre) sumar("resumen_mediodia", await resumenes(admin, e, "mediodia", hoy, ahora));
    if (hora >= e.cierre) sumar("resumen_cierre", await resumenes(admin, e, "cierre", hoy, ahora));
    if (hora >= "07:30") sumar("citas_del_dia", await citasDeHoy(admin, e, hoy));
  }

  // Push pendientes: se envían desde aquí.
  let pushEnviados = 0;
  const { data: push } = await admin.from("avisos").select("id, perfil_id, titulo, texto, enlace").eq("canal", "push").eq("estado", "pendiente").lte("programado_para", ahora.toISOString()).limit(300);
  for (const a of push ?? []) {
    const r = a.perfil_id && pushConfigurado() ? await pushAPersona(admin, a.perfil_id, a) : { enviados: 0 };
    pushEnviados += r.enviados;
    await admin.from("avisos").update(r.enviados ? { estado: "enviado", enviado_en: new Date().toISOString() } : { estado: "omitido", error: pushConfigurado() ? "La persona no activó avisos en su celular." : "Push sin configurar (VAPID)." }).eq("id", a.id);
  }

  // WhatsApp pendientes: los manda n8n. Se reservan 10 minutos para no mandarlos dos veces.
  const { data: wa } = origen !== "n8n" ? { data: [] } : await admin
    .from("avisos")
    .select("id, celular, plantilla, variables, botones, texto, intentos")
    .eq("canal", "whatsapp")
    .eq("estado", "pendiente")
    .lte("programado_para", ahora.toISOString())
    .lt("intentos", 3)
    .order("programado_para")
    .limit(100);
  const whatsapp: AvisoWhatsapp[] = [];
  for (const a of wa ?? []) {
    if (!a.celular) continue;
    await admin.from("avisos").update({ intentos: a.intentos + 1, programado_para: new Date(ahora.getTime() + 10 * 60_000).toISOString() }).eq("id", a.id);
    whatsapp.push({ id: a.id, celular: a.celular.replace(/^\+/, ""), plantilla: a.plantilla, idioma: "es", variables: (a.variables as unknown[]).map(String), botones: a.botones as AvisoWhatsapp["botones"], texto: a.texto });
  }
  // Para «Estado del sistema»: cuándo corrió cada uno por última vez (si la tabla aún no existe, no pasa nada).
  await admin
    .from("estado_sistema")
    .upsert({ clave: origen === "n8n" ? "ciclo_n8n" : "ciclo_interno", valor: { creados, push: pushEnviados, whatsapp: whatsapp.length }, actualizado_en: new Date().toISOString() })
    .then(() => {}, () => {});
  return { creados, push: { enviados: pushEnviados }, whatsapp };
}

/** n8n cuenta cómo le fue con cada WhatsApp. */
export async function registrarEnvios(resultados: { id: string; ok: boolean; error?: string }[]) {
  const admin = clienteAdmin();
  for (const r of resultados) {
    await admin.from("avisos").update(r.ok ? { estado: "enviado", enviado_en: new Date().toISOString(), error: null } : { error: (r.error ?? "Error al enviar").slice(0, 500) }).eq("id", r.id).eq("canal", "whatsapp");
  }
  // Tras 3 intentos fallidos queda como fallido.
  await admin.from("avisos").update({ estado: "fallido" }).eq("canal", "whatsapp").eq("estado", "pendiente").gte("intentos", 3).not("error", "is", null);
}

// ---------------------------------------------------------------------------
function canalDe(e: Empresa, tipo: TipoPersonal): Canal {
  return e.canales.get(tipo) ?? "push";
}

/** Arma un aviso al personal en el canal elegido (push, WhatsApp o ambos). */
async function avisoPersonal(admin: SupabaseClient, e: Empresa, tipo: TipoPersonal, perfil: { id: string; nombre: string; celular: string }, a: { titulo: string; texto: string; enlace: string }, clave: string): Promise<number> {
  const canal = canalDe(e, tipo);
  if (canal === "apagado") return 0;
  const filas = [];
  if (canal === "push" || canal === "ambos") filas.push({ canal: "push", clave_unica: `${clave}:push` });
  if (canal === "whatsapp" || canal === "ambos") filas.push({ canal: "whatsapp", clave_unica: `${clave}:wa` });
  const { data } = await admin
    .from("avisos")
    .upsert(
      filas.map((x) => ({
        ...x, empresa_id: e.id, tipo, destino: "personal", perfil_id: perfil.id, celular: perfil.celular, titulo: a.titulo, texto: a.texto, enlace: a.enlace,
        plantilla: x.canal === "whatsapp" ? "aviso_personal" : null, variables: x.canal === "whatsapp" ? [perfil.nombre.split(" ")[0], aUnaLinea(`${a.titulo}: ${a.texto}`)] : [],
      })),
      { onConflict: "clave_unica", ignoreDuplicates: true },
    )
    .select("id");
  return data?.length ?? 0;
}

async function personal(admin: SupabaseClient, empresa: string) {
  const { data } = await admin.from("miembros").select("rol, perfil_id, perfiles (nombre, celular, activo)").eq("empresa_id", empresa).eq("activo", true);
  const por = new Map<string, { id: string; nombre: string; celular: string; roles: Rol[] }>();
  for (const m of data ?? []) {
    const p = uno(m.perfiles as never) as { nombre: string; celular: string; activo: boolean } | null;
    if (!p?.activo) continue;
    const x = por.get(m.perfil_id) ?? { id: m.perfil_id, nombre: p.nombre, celular: p.celular, roles: [] as Rol[] };
    x.roles.push(m.rol as Rol);
    por.set(m.perfil_id, x);
  }
  return [...por.values()];
}

async function citasSinLlegada(admin: SupabaseClient, e: Empresa, ahora: Date): Promise<number> {
  const limite = new Date(ahora.getTime() - e.tolerancia * 60_000).toISOString();
  const { data } = await admin
    .from("citas")
    .update({ estado: "no_llego" })
    .eq("empresa_id", e.id)
    .in("estado", ["agendada", "confirmada"])
    .is("orden_id", null)
    .lt("fecha_hora", limite)
    .gt("fecha_hora", new Date(ahora.getTime() - 3 * 86400_000).toISOString())
    .select("id, vendedor_id, nombre_cliente, servicio, fecha_hora");
  let n = 0;
  if (!data?.length) return 0;
  const gente = new Map((await personal(admin, e.id)).map((p) => [p.id, p]));
  for (const c of data) {
    const v = c.vendedor_id ? gente.get(c.vendedor_id) : null;
    if (!v) continue;
    n += await avisoPersonal(admin, e, "cita_no_llego", v, { ...citaNoLlego(c.nombre_cliente, horaLima(new Date(c.fecha_hora)), c.servicio), enlace: "/citas" }, `cita_no_llego:${c.id}`);
  }
  return n;
}

/**
 * Hora prometida al cliente: avisa a quien abrió la orden (o a los asesores)
 * cuando falta poco y el carro no está listo, y otra vez, también a gerencia,
 * si la hora pasó. Una sola vez por cada hora prometida: si se reprograma,
 * vuelve a avisar con la hora nueva.
 */
async function entregasQueVencen(admin: SupabaseClient, e: Empresa, ahora: Date): Promise<{ porVencer: number; atrasadas: number }> {
  const cuenta = { porVencer: 0, atrasadas: 0 };
  const { data } = await admin
    .from("ordenes_trabajo")
    .select("id, estado, entrega_prometida, creado_por, clientes (nombre, celular), vehiculos (placa)")
    .eq("empresa_id", e.id)
    .eq("anulada", false)
    .in("estado", [...ESTADOS_EN_TRABAJO])
    .not("entrega_prometida", "is", null)
    .lte("entrega_prometida", new Date(ahora.getTime() + e.minutosEntrega * 60_000).toISOString())
    .gt("entrega_prometida", new Date(ahora.getTime() - 7 * 86_400_000).toISOString())
    .limit(200);
  if (!data?.length) return cuenta;

  const gente = await personal(admin, e.id);
  const porId = new Map(gente.map((p) => [p.id, p]));
  const atiende = (p: (typeof gente)[number]) => p.roles.some((r) => r === "gerencia" || r === "administrador" || r === "asesor");
  const asesores = gente.filter((p) => p.roles.includes("asesor"));
  const gerencia = gente.filter((p) => p.roles.includes("gerencia"));

  for (const o of data) {
    const c = uno(o.clientes as never) as { nombre: string; celular: string } | null;
    const v = uno(o.vehiculos as never) as { placa: string } | null;
    if (!o.entrega_prometida || !c || !v) continue;
    const prometida = new Date(o.entrega_prometida);
    const atrasada = prometida.getTime() <= ahora.getTime();
    const creador = o.creado_por ? porId.get(o.creado_por) : undefined;
    const responsables = creador && atiende(creador) ? [creador] : asesores.length ? asesores : gerencia;
    const destino = atrasada ? [...new Map([...responsables, ...gerencia].map((p) => [p.id, p])).values()] : responsables;
    const tipo = atrasada ? "entrega_atrasada" : "entrega_por_vencer";
    const datos = {
      placa: formatearPlaca(v.placa), cliente: c.nombre, celular: formatearCelular(c.celular), hora: cuandoEntrega(prometida, ahora),
      estado: NOMBRE_ESTADO[o.estado as EstadoOrden] ?? o.estado, minutos: duracion(Math.abs(prometida.getTime() - ahora.getTime()) / 60_000),
    };
    const aviso = { ...(atrasada ? entregaAtrasada(datos) : entregaPorVencer(datos)), enlace: `/ordenes/${o.id}` };
    for (const p of destino) {
      const n = await avisoPersonal(admin, e, tipo, p, aviso, `${tipo}:${o.id}:${prometida.getTime()}:${p.id}`);
      if (atrasada) cuenta.atrasadas += n;
      else cuenta.porVencer += n;
    }
  }
  return cuenta;
}

async function recordatoriosQueTocan(admin: SupabaseClient, e: Empresa, hoy: string): Promise<number> {
  if ((e.canales.get("recordatorio_mantenimiento") ?? "whatsapp") === "apagado") return 0;
  const { data } = await admin
    .from("recordatorios_mantenimiento")
    .select("id, servicio, km_objetivo, cliente_id, clientes (nombre, celular, acepta_mensajes), vehiculos (placa), ordenes_trabajo (entregado_en)")
    .eq("empresa_id", e.id)
    .eq("estado", "pendiente")
    .lte("fecha_objetivo", hoy)
    .limit(200);
  let n = 0;
  for (const r of data ?? []) {
    const c = uno(r.clientes as never) as { nombre: string; celular: string; acepta_mensajes: boolean } | null;
    const v = uno(r.vehiculos as never) as { placa: string } | null;
    const o = uno(r.ordenes_trabajo as never) as { entregado_en: string | null } | null;
    if (!c?.acepta_mensajes || !v) continue; // sin consentimiento no se escribe: queda en la lista para llamarlo
    const ultima = o?.entregado_en ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(o.entregado_en)) : "tu última visita";
    const placa = v.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2");
    const km = r.km_objetivo ? `, o al llegar a ${r.km_objetivo.toLocaleString("es-PE")} km` : "";
    const nombre = c.nombre.split(" ")[0];
    const { data: hecho } = await admin
      .from("avisos")
      .upsert(
        {
          empresa_id: e.id, tipo: "recordatorio_mantenimiento", destino: "cliente", cliente_id: r.cliente_id, celular: c.celular, canal: "whatsapp", titulo: "Mantenimiento",
          texto: `Hola ${nombre}, ya toca ${r.servicio.toLowerCase()} para tu carro ${placa} (la última vez fue el ${ultima}${km}). Escríbenos para separar tu cita en ${e.nombre}.`,
          plantilla: "recordatorio_mantenimiento", variables: [nombre, r.servicio.toLowerCase(), placa, `${ultima}${km}`, e.nombre], ref_id: r.id, clave_unica: `recordatorio:${r.id}`,
        },
        { onConflict: "clave_unica", ignoreDuplicates: true },
      )
      .select("id");
    await admin.from("recordatorios_mantenimiento").update({ estado: "enviado" }).eq("id", r.id);
    n += hecho?.length ?? 0;
  }
  return n;
}

async function resumenes(admin: SupabaseClient, e: Empresa, momento: "mediodia" | "cierre", hoy: string, ahora: Date): Promise<number> {
  const tipo = momento === "mediodia" ? "resumen_mediodia" : "resumen_cierre";
  if (canalDe(e, tipo) === "apagado") return 0;
  const gente = (await personal(admin, e.id)).filter((p) => !(p.roles.length === 1 && p.roles[0] === "confirmador"));
  // ¿Ya se armó hoy? (la clave única también lo evita)
  const { count } = await admin.from("avisos").select("id", { count: "exact", head: true }).eq("empresa_id", e.id).eq("tipo", tipo).gte("creado_en", inicioDia(hoy).toISOString());
  if ((count ?? 0) >= gente.length) return 0;

  const [{ data: abiertas }, { count: entregadosHoy }, { data: entregadasHoy }, { data: repuestos }, { data: citas }] = await Promise.all([
    admin.from("ordenes_trabajo").select("estado, tecnico_id, estado_cambiado_en").eq("empresa_id", e.id).eq("anulada", false).neq("estado", "entregado"),
    admin.from("ordenes_trabajo").select("id", { count: "exact", head: true }).eq("empresa_id", e.id).eq("estado", "entregado").gte("entregado_en", inicioDia(hoy).toISOString()),
    admin.from("orden_estados_historial").select("orden_id, cambiado_por, ordenes_trabajo!inner (tecnico_id)").eq("empresa_id", e.id).eq("estado_nuevo", "listo").gte("cambiado_en", inicioDia(hoy).toISOString()),
    admin.from("repuestos").select("stock, stock_minimo").eq("empresa_id", e.id).eq("activo", true).gt("stock_minimo", 0),
    admin.from("citas").select("vendedor_id, estado").eq("empresa_id", e.id).gte("fecha_hora", inicioDia(hoy).toISOString()).lt("fecha_hora", new Date(inicioDia(hoy).getTime() + 86400_000).toISOString()),
  ]);
  const lista = abiertas ?? [];
  const limite = ahora.getTime() - e.horasSinCambio * 3600_000;
  const t = {
    taller: e.nombre,
    enTaller: lista.filter((o) => o.estado === "en_taller" || o.estado === "en_diagnostico").length,
    enProceso: lista.filter((o) => o.estado === "en_proceso" || o.estado === "aprobado").length,
    esperandoRepuesto: lista.filter((o) => o.estado === "esperando_repuesto").length,
    esperaAprobacion: lista.filter((o) => o.estado === "espera_aprobacion").length,
    listos: lista.filter((o) => o.estado === "listo").length,
    entregadosHoy: entregadosHoy ?? 0,
    atrasados: lista.filter((o) => o.estado !== "listo" && new Date(o.estado_cambiado_en).getTime() < limite).length,
    horasSinCambio: e.horasSinCambio,
  };
  const bajos = (repuestos ?? []).filter((r) => stockBajo({ stock: Number(r.stock), stockMinimo: Number(r.stock_minimo) })).length;
  let n = 0;
  for (const p of gente) {
    let datos: DatosPersona;
    if (p.roles.some((r) => ["gerencia", "administrador", "asesor", "recepcion"].includes(r))) datos = { tipo: "general" };
    else if (p.roles.includes("tecnico")) {
      const suyas = lista.filter((o) => o.tecnico_id === p.id);
      const listosHoy = ((entregadasHoy ?? []) as { ordenes_trabajo: { tecnico_id: string } | { tecnico_id: string }[] }[]).filter((x) => uno(x.ordenes_trabajo)?.tecnico_id === p.id).length;
      datos = { tipo: "tecnico", pendientes: suyas.filter((o) => ["en_taller", "en_diagnostico", "espera_aprobacion", "aprobado"].includes(o.estado)).length, enProceso: suyas.filter((o) => o.estado === "en_proceso").length, esperandoRepuesto: suyas.filter((o) => o.estado === "esperando_repuesto").length, listosHoy };
    } else if (p.roles.includes("almacen")) datos = { tipo: "almacen", esperandoRepuesto: t.esperandoRepuesto, stockBajo: bajos };
    else if (p.roles.includes("vendedor_redes")) {
      const suyas = (citas ?? []).filter((c) => c.vendedor_id === p.id);
      datos = { tipo: "vendedor", citasHoy: suyas.length, llegaron: suyas.filter((c) => c.estado === "llego").length, noLlegaron: suyas.filter((c) => c.estado === "no_llego").length };
    } else continue;
    n += await avisoPersonal(admin, e, tipo, p, { ...resumenDelDia(momento, p.nombre, t, datos), enlace: datos.tipo === "tecnico" ? "/mis-trabajos" : "/" }, `${tipo}:${p.id}:${hoy}`);
  }
  return n;
}

async function citasDeHoy(admin: SupabaseClient, e: Empresa, hoy: string): Promise<number> {
  if (canalDe(e, "citas_del_dia") === "apagado") return 0;
  const confirmadores = (await personal(admin, e.id)).filter((p) => p.roles.includes("confirmador"));
  if (!confirmadores.length) return 0;
  const { data } = await admin
    .from("citas")
    .select("fecha_hora, nombre_cliente, servicio, estado")
    .eq("empresa_id", e.id)
    .in("estado", ["agendada", "confirmada"])
    .gte("fecha_hora", inicioDia(hoy).toISOString())
    .lt("fecha_hora", new Date(inicioDia(hoy).getTime() + 86400_000).toISOString())
    .order("fecha_hora");
  const aviso = citasDelDia(e.nombre, (data ?? []).map((c) => ({ hora: horaLima(new Date(c.fecha_hora)), nombre: c.nombre_cliente, servicio: c.servicio, confirmada: c.estado === "confirmada" })));
  let n = 0;
  for (const p of confirmadores) n += await avisoPersonal(admin, e, "citas_del_dia", p, { ...aviso, enlace: "/citas" }, `citas_del_dia:${p.id}:${hoy}`);
  return n;
}
