import { notFound } from "next/navigation";
import { diaEnLima, nombreMes } from "@/lib/formato";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogo } from "@/lib/taller/consultas";
import { FormMeta, FormNuevoTaller, FormPermisosAdmin, FormReglas, FormServicios, FormTaller, Seccion } from "./formularios";

export const metadata = { title: "Configuración del taller" };

export default async function Configuracion() {
  const ctx = await obtenerContexto();
  if (!esGestor(ctx.roles)) notFound();

  const supabase = await clienteServidor();
  const [anio, mes] = diaEnLima(new Date()).split("-").map(Number);
  const [{ data: taller }, { data: config }, { data: meta }, servicios] = await Promise.all([
    supabase.from("empresas").select("nombre, razon_social, ruc, direccion, telefono").eq("id", ctx.taller.id).single(),
    supabase.from("configuracion_empresa").select("*").eq("empresa_id", ctx.taller.id).single(),
    supabase.from("metas_ventas").select("meta_sin_igv").eq("empresa_id", ctx.taller.id).eq("anio", anio).eq("mes", mes).maybeSingle(),
    catalogo(ctx.taller.id, false),
  ]);
  if (!taller || !config) notFound();

  const esGerencia = ctx.roles.includes("gerencia");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Configuración del taller</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
          Estos ajustes son de {ctx.taller.nombre}. Cada otro taller tiene los suyos.
        </p>
      </header>

      <Seccion titulo="Datos del taller" descripcion="Aparecen en los mensajes al cliente y en los reportes.">
        <FormTaller valores={taller} />
      </Seccion>

      <Seccion titulo="Reglas del taller" descripcion="Cuándo una cita cuenta como &quot;no llegó&quot;, cuánto dura la garantía y a qué hora salen los resúmenes.">
        <FormReglas
          valores={{
            tolerancia_cita_minutos: config.tolerancia_cita_minutos,
            dias_garantia_defecto: config.dias_garantia_defecto,
            dias_cliente_inactivo: config.dias_cliente_inactivo,
            horas_orden_sin_cambio: config.horas_orden_sin_cambio,
            margen_minimo_pct: Number(config.margen_minimo_pct),
            igv_pct: Math.round(Number(config.tasa_igv) * 10000) / 100,
            hora_resumen_mediodia: String(config.hora_resumen_mediodia).slice(0, 5),
            hora_cierre: String(config.hora_cierre).slice(0, 5),
          }}
        />
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

      <Seccion titulo="Agregar un taller" descripcion="Para manejar otro local en el mismo sistema. Tendrá su propio personal, datos y reportes.">
        <FormNuevoTaller />
      </Seccion>
    </div>
  );
}
