/**
 * Lista de control del sistema para gerencia: qué está listo, qué falta y
 * cómo se arregla, en palabras simples. Función pura, con pruebas en tests/.
 */

export type EstadoPunto = "listo" | "atencion" | "falta" | "opcional";
export type Punto = { clave: string; titulo: string; estado: EstadoPunto; detalle: string; como?: string };

export type DatosSistema = {
  ahora: Date;
  base: { automatica: boolean; faltan: number; error?: string | null };
  respaldo: { ultimo: { creadoEn: string; modo: "completo" | "datos" } | null; ultimoFallo: { creadoEn: string; error: string | null } | null; ultimaDescarga: string | null };
  taller: { ruc: boolean; direccion: boolean; telefono: boolean; correo: boolean; logo: boolean };
  avisos: { llaves: boolean; celulares: number; ultimoCiclo: string | null };
  whatsapp: { clave: boolean; ultimoN8n: string | null };
  ia: { lectura: boolean; audio: boolean };
  direccion: { https: boolean; host: string };
  personal: { activos: number };
};

const horasDesde = (iso: string | null, ahora: Date) => (iso ? (ahora.getTime() - new Date(iso).getTime()) / 3_600_000 : Infinity);
const hace = (iso: string, ahora: Date) => {
  const h = horasDesde(iso, ahora);
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
};

export function puntosDelSistema(d: DatosSistema): Punto[] {
  const p: Punto[] = [];

  // 1. Base de datos
  if (d.base.error) p.push({ clave: "base", titulo: "Base de datos", estado: "falta", detalle: `La actualización automática falló. ${d.base.error}`, como: "Revisa SUPABASE_DB_URL y SUPABASE_DB_PASSWORD en EasyPanel y toca «Implementar»." });
  else if (d.base.faltan) p.push({ clave: "base", titulo: "Base de datos", estado: "falta", detalle: `Faltan ${d.base.faltan} ${d.base.faltan === 1 ? "actualización" : "actualizaciones"}.`, como: "Abre /actualizar para ver los pasos." });
  else if (d.base.automatica) p.push({ clave: "base", titulo: "Base de datos", estado: "listo", detalle: "Al día. Se actualiza sola cada vez que tocas «Implementar»." });
  else p.push({ clave: "base", titulo: "Base de datos", estado: "atencion", detalle: "Al día, pero cada mejora nueva habrá que pegarla a mano en Supabase.", como: "Pon la conexión de la base en EasyPanel (abajo está cómo) y se actualizará sola." });

  // 2. Copias de seguridad
  const r = d.respaldo;
  const falloReciente = r.ultimoFallo && (!r.ultimo || r.ultimoFallo.creadoEn > r.ultimo.creadoEn);
  if (!r.ultimo) p.push({ clave: "respaldo", titulo: "Copias de seguridad", estado: "falta", detalle: falloReciente ? `La copia falló: ${r.ultimoFallo!.error ?? "sin detalle"}.` : "Todavía no hay ninguna copia.", como: "Toca «Hacer una copia ahora». Después se hace sola cada madrugada." });
  else if (falloReciente || horasDesde(r.ultimo.creadoEn, d.ahora) > 48) p.push({ clave: "respaldo", titulo: "Copias de seguridad", estado: "falta", detalle: falloReciente ? `La última copia falló (${hace(r.ultimoFallo!.creadoEn, d.ahora)}): ${r.ultimoFallo!.error ?? "sin detalle"}.` : `La última copia es de ${hace(r.ultimo.creadoEn, d.ahora)}.`, como: "Toca «Hacer una copia ahora» y revisa que el servidor esté encendido." });
  else if (horasDesde(r.ultimaDescarga, d.ahora) > 8 * 24) p.push({ clave: "respaldo", titulo: "Copias de seguridad", estado: "atencion", detalle: `Hay copia de ${hace(r.ultimo.creadoEn, d.ahora)}, pero ${r.ultimaDescarga ? "hace más de una semana que no bajas una" : "nunca bajaste una"} a tu computadora o Drive.`, como: "Descarga la última y guárdala fuera del sistema, una vez por semana." });
  else if (r.ultimo.modo === "datos") p.push({ clave: "respaldo", titulo: "Copias de seguridad", estado: "atencion", detalle: `Copia de ${hace(r.ultimo.creadoEn, d.ahora)}, sin las contraseñas del personal.`, como: "Con la conexión de la base en EasyPanel, la copia sale completa." });
  else p.push({ clave: "respaldo", titulo: "Copias de seguridad", estado: "listo", detalle: `Copia completa de ${hace(r.ultimo.creadoEn, d.ahora)}. Se hace sola cada madrugada y se guardan 30 días.` });

  // 3. Datos del taller para los documentos
  const faltanDatos = [!d.taller.ruc && "RUC", !d.taller.direccion && "dirección", !d.taller.telefono && "teléfono", !d.taller.correo && "correo", !d.taller.logo && "logo"].filter(Boolean) as string[];
  p.push(
    faltanDatos.length
      ? { clave: "taller", titulo: "Datos del taller en los documentos", estado: "falta", detalle: `Falta: ${faltanDatos.join(", ")}. Los recibos y proformas salen incompletos.`, como: "Complétalos en Configuración → Datos del taller y Logo." }
      : { clave: "taller", titulo: "Datos del taller en los documentos", estado: "listo", detalle: "RUC, dirección, teléfono, correo y logo completos." },
  );

  // 4. Avisos en el celular
  if (!d.avisos.llaves) p.push({ clave: "avisos", titulo: "Avisos en el celular", estado: "falta", detalle: "Faltan las llaves de avisos: nadie recibe alertas en su celular.", como: "Crea las llaves aquí abajo y pégalas en EasyPanel." });
  else if (!d.avisos.celulares) p.push({ clave: "avisos", titulo: "Avisos en el celular", estado: "atencion", detalle: "Las llaves están, pero nadie activó los avisos en su celular.", como: "Cada persona entra a Ayuda → «Avisos en este celular» y toca Activar." });
  else if (horasDesde(d.avisos.ultimoCiclo, d.ahora) > 0.5) p.push({ clave: "avisos", titulo: "Avisos en el celular", estado: "atencion", detalle: d.avisos.ultimoCiclo ? `El reloj de avisos no corre desde ${hace(d.avisos.ultimoCiclo, d.ahora)}.` : "El reloj de avisos todavía no corrió.", como: "Arranca solo a los pocos minutos de «Implementar». Si sigue así, reinicia el servicio en EasyPanel." });
  else p.push({ clave: "avisos", titulo: "Avisos en el celular", estado: "listo", detalle: `${d.avisos.celulares} ${d.avisos.celulares === 1 ? "celular activado" : "celulares activados"}. El reloj revisa cada 5 minutos.` });

  // 5. WhatsApp
  if (!d.whatsapp.clave) p.push({ clave: "whatsapp", titulo: "WhatsApp", estado: "opcional", detalle: "Sin conectar. El sistema funciona igual; solo no se registra ni se avisa por WhatsApp.", como: "Crea la clave para n8n aquí abajo y sigue la guía n8n/README.md." });
  else if (horasDesde(d.whatsapp.ultimoN8n, d.ahora) > 1) p.push({ clave: "whatsapp", titulo: "WhatsApp", estado: "atencion", detalle: d.whatsapp.ultimoN8n ? `n8n no llama desde ${hace(d.whatsapp.ultimoN8n, d.ahora)}.` : "La clave está, pero n8n todavía no se conectó.", como: "Revisa en n8n que los dos flujos estén activos." });
  else p.push({ clave: "whatsapp", titulo: "WhatsApp", estado: "listo", detalle: "Conectado: n8n está llamando." });

  // 6. Inteligencia artificial
  if (d.ia.lectura && d.ia.audio) p.push({ clave: "ia", titulo: "Lectura con IA", estado: "listo", detalle: "Lee facturas, placas y notas de voz. Todo queda por confirmar." });
  else p.push({ clave: "ia", titulo: "Lectura con IA", estado: "opcional", detalle: `${d.ia.lectura ? "Lee fotos y PDF" : "No lee fotos ni PDF"}; ${d.ia.audio ? "entiende notas de voz" : "no entiende notas de voz"}. Sin IA todo se registra a mano.`, como: "Pon ANTHROPIC_API_KEY (fotos y PDF) y OPENAI_API_KEY (notas de voz) en EasyPanel. Cada lectura cuesta unos céntimos." });

  // 7. Dirección de la app
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(d.direccion.host)) p.push({ clave: "direccion", titulo: "Dirección de la app", estado: "opcional", detalle: "Estás en una computadora de pruebas, no en la app publicada." });
  else if (!d.direccion.https) p.push({ clave: "direccion", titulo: "Dirección de la app", estado: "falta", detalle: "Se está abriendo sin candado (http). Los avisos y la cámara no funcionan así.", como: "Abre la app con la dirección que empieza con https://." });
  else if (/\.easypanel\.host$/.test(d.direccion.host)) p.push({ clave: "direccion", titulo: "Dirección de la app", estado: "atencion", detalle: `Usas la dirección de prueba (${d.direccion.host}).`, como: "En EasyPanel → Dominios agrega tu dirección propia, por ejemplo taller.tudominio.com." });
  else p.push({ clave: "direccion", titulo: "Dirección de la app", estado: "listo", detalle: `${d.direccion.host}, con candado.` });

  // 8. Personal
  p.push(
    d.personal.activos <= 1
      ? { clave: "personal", titulo: "Personal", estado: "atencion", detalle: "Solo estás tú. Cada persona debe entrar con su propio celular.", como: "Agrégalas en Personal y roles." }
      : { clave: "personal", titulo: "Personal", estado: "listo", detalle: `${d.personal.activos} personas con acceso.` },
  );
  return p;
}

export function resumenSistema(puntos: Punto[]): { listos: number; total: number; urgentes: number } {
  const obligatorios = puntos.filter((x) => x.estado !== "opcional");
  return { listos: obligatorios.filter((x) => x.estado === "listo").length, total: obligatorios.length, urgentes: puntos.filter((x) => x.estado === "falta").length };
}
