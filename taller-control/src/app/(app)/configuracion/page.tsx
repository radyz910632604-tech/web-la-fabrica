import { notFound } from "next/navigation";
import { diaEnLima, nombreMes } from "@/lib/formato";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { NOMBRE_ROL, type Rol } from "@/lib/roles";
import { catalogo } from "@/lib/taller/consultas";
import { costosVigentes } from "@/lib/taller/dinero-consultas";
import { FormAvisos } from "./avisos";
import { FormComisiones, FormCostos, FormManoObra, FormManoObraServicios } from "./dinero";
import { FormLogo, FormMeta, FormNuevoTaller, FormPermisosAdmin, FormReglas, FormServicios, FormTaller, Seccion } from "./formularios";

export const metadata = { title: "Configuración del taller" };

export default async function Configuracion() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();

  const supabase = await clienteServidor();
  const [anio, mes] = diaEnLima(new Date()).split("-").map(Number);
  const [{ data: taller }, { data: config }, { data: meta }, servicios] = await Promise.all([
    supabase.from("empresas").select("nombre, razon_social, ruc, direccion, telefono, correo, lema, logo_ruta").eq("id", ctx.taller.id).single(),
    supabase.from("configuracion_empresa").select("*").eq("empresa_id", ctx.taller.id).single(),
    supabase.from("metas_ventas").select("meta_sin_igv").eq("empresa_id", ctx.taller.id).eq("anio", anio).eq("mes", mes).maybeSingle(),
    catalogo(ctx.taller.id, false),
  ]);
  if (!taller || !config) notFound();
  const logoUrl = taller.logo_ruta ? ((await supabase.storage.from("marca").createSignedUrl(taller.logo_ruta, 3600)).data?.signedUrl ?? null) : null;

  const esGerencia = ctx.roles.includes("gerencia");
  const { data: canales } = await supabase.from("config_avisos").select("tipo, canal").eq("empresa_id", ctx.taller.id);
  const [{ data: personas }, costos, { data: fijos }, { data: reglas }] = esGerencia
    ? await Promise.all([
        supabase.rpc("directorio", { p_empresa: ctx.taller.id }),
        costosVigentes(ctx.taller.id),
        supabase.from("mano_obra_servicio").select("servicio_id, monto").eq("empresa_id", ctx.taller.id),
        supabase.from("reglas_comision").select("id, nombre, evento, tipo_monto, valor, activa").eq("empresa_id", ctx.taller.id).order("creado_en"),
      ])
    : [{ data: [] }, new Map<string, number>(), { data: [] }, { data: [] }];
  const fijoPor = new Map(((fijos ?? []) as { servicio_id: string; monto: number }[]).map((f) => [f.servicio_id, Number(f.monto)]));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Configuración del taller</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
          Estos ajustes son de {ctx.taller.nombre}. Cada otro taller tiene los suyos.
        </p>
      </header>

      <Seccion titulo="Datos del taller" descripcion="Aparecen en los recibos, proformas, órdenes y reportes en PDF, y en los mensajes al cliente.">
        <FormTaller valores={taller} />
      </Seccion>

      <Seccion titulo="Logo" descripcion="Sale arriba a la izquierda en todos los documentos PDF.">
        <FormLogo url={logoUrl} />
      </Seccion>

      <Seccion titulo="Reglas del taller" descripcion="Cuándo una cita cuenta como &quot;no llegó&quot;, cuánto antes se avisa de una entrega, cuánto dura la garantía y a qué hora salen los resúmenes.">
        <FormReglas
          valores={{
            tolerancia_cita_minutos: config.tolerancia_cita_minutos,
            dias_garantia_defecto: config.dias_garantia_defecto,
            dias_cliente_inactivo: config.dias_cliente_inactivo,
            horas_orden_sin_cambio: config.horas_orden_sin_cambio,
            minutos_aviso_entrega: config.minutos_aviso_entrega,
            horas_espera_aprobacion: config.horas_espera_aprobacion,
            horas_listo_sin_facturar: config.horas_listo_sin_facturar,
            margen_minimo_pct: Number(config.margen_minimo_pct),
            igv_pct: Math.round(Number(config.tasa_igv) * 10000) / 100,
            hora_resumen_mediodia: String(config.hora_resumen_mediodia).slice(0, 5),
            hora_cierre: String(config.hora_cierre).slice(0, 5),
            recibo_inicial: config.recibo_inicial,
          }}
        />
      </Seccion>

      <Seccion titulo="Avisos" descripcion="Por dónde sale cada aviso. El aviso en el celular es gratis; WhatsApp cuesta por conversación.">
        <FormAvisos canales={Object.fromEntries(((canales ?? []) as { tipo: string; canal: string }[]).map((c) => [c.tipo, c.canal]))} />
      </Seccion>

      <Seccion titulo="Servicios del taller" descripcion="Los que aparecen para tocar al registrar un ingreso. Cada uno puede tener su propio plazo de garantía.">
        <FormServicios servicios={servicios} />
      </Seccion>

      <Seccion titulo={`Meta de ventas de ${nombreMes(new Date())}`} descripcion="Sin IGV. Se ve como barra de avance en el panel.">
        <FormMeta valor={meta ? Number(meta.meta_sin_igv) : null} />
      </Seccion>

      {esGerencia ? (
        <Seccion titulo="Lo que ve administración" descripcion="Por defecto, administración no ve la utilidad ni los sueldos. Solo gerencia lo cambia.">
          <FormPermisosAdmin utilidad={config.admin_ve_utilidad} sueldos={config.admin_ve_sueldos} />
        </Seccion>
      ) : null}

      {esGerencia ? (
        <>
          <Seccion titulo="Mano de obra" descripcion="Cómo se calcula el costo de mano de obra de cada orden, para su utilidad.">
            <FormManoObra regla={config.regla_mano_obra} />
          </Seccion>
          <Seccion titulo="Costo mensual del personal" descripcion="Sueldo más cargas, por mes. Solo lo ve gerencia (y administración si se lo permites). Un cambio vale desde hoy.">
            <FormCostos
              personas={((personas ?? []) as { perfil_id: string; nombre: string; roles: Rol[]; activo: boolean }[])
                .filter((p) => p.activo)
                .map((p) => ({ id: p.perfil_id, nombre: p.nombre, roles: p.roles.map((r) => NOMBRE_ROL[r]).join(", "), costo: costos.get(p.perfil_id) ?? null }))}
            />
          </Seccion>
          {config.regla_mano_obra === "fijo_por_servicio" ? (
            <Seccion titulo="Mano de obra por servicio" descripcion="Monto fijo de mano de obra de cada servicio, sin IGV. Vacío = cero.">
              <FormManoObraServicios servicios={servicios.filter((s) => s.activo).map((s) => ({ id: s.id, nombre: s.nombre, monto: fijoPor.get(s.id) ?? null }))} />
            </Seccion>
          ) : null}
          <Seccion titulo="Comisiones" descripcion="Se calculan solas cada mes y salen en Reportes. Puedes pausar una regla sin borrarla.">
            <FormComisiones
              reglas={((reglas ?? []) as { id: string; nombre: string; evento: string; tipo_monto: string; valor: number; activa: boolean }[]).map((r) => ({
                id: r.id,
                nombre: r.nombre,
                evento: r.evento,
                tipo: r.tipo_monto,
                valor: Number(r.valor),
                activa: r.activa,
              }))}
            />
          </Seccion>
        </>
      ) : null}

      <Seccion titulo="Agregar un taller" descripcion="Para manejar otro local en el mismo sistema. Tendrá su propio personal, datos y reportes.">
        <FormNuevoTaller />
      </Seccion>
    </div>
  );
}
