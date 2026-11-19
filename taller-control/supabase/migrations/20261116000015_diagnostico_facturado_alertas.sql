-- =====================================================================
-- Diagnóstico, «facturado» y alertas nuevas del agente de WhatsApp
-- ---------------------------------------------------------------------
-- 1. La orden guarda su diagnóstico (texto) y cuándo se facturó.
-- 2. «Facturado» lo marca la base sola cuando la orden tiene una boleta,
--    factura o recibo vigente (y lo quita si se anulan).
-- 3. Umbral configurable para «espera aprobación del cliente».
-- 4. Tipos de aviso nuevos (todos configurables en Configuración).
-- =====================================================================

-- 1. Diagnóstico y facturado ------------------------------------------------
alter table public.ordenes_trabajo
  add column diagnostico text check (diagnostico is null or char_length(diagnostico) <= 2000),
  add column diagnostico_en timestamptz,
  add column facturado_en timestamptz;

comment on column public.ordenes_trabajo.diagnostico is 'Lo que encontró el taller. Se escribe con registrar_diagnostico() (pantalla o WhatsApp).';
comment on column public.ordenes_trabajo.facturado_en is 'Cuándo tuvo su primer comprobante vigente (boleta, factura o recibo). Lo lleva la base.';

-- El diagnóstico lo escriben quienes trabajan la orden; queda también como avance.
create function public.registrar_diagnostico(p_orden uuid, p_texto text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo;
  v_texto text := btrim(coalesce(p_texto, ''));
begin
  select * into v_orden from public.ordenes_trabajo where id = p_orden;
  if not found or v_orden.anulada then
    raise exception 'La orden no existe o está anulada.' using errcode = 'no_data_found';
  end if;
  if not privado.puede_trabajar_orden(p_orden) then
    raise exception 'No puedes escribir el diagnóstico de esta orden.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_texto) < 3 or char_length(v_texto) > 2000 then
    raise exception 'Escribe el diagnóstico (entre 3 y 2000 letras).' using errcode = 'check_violation';
  end if;
  update public.ordenes_trabajo set diagnostico = v_texto, diagnostico_en = now() where id = p_orden;
  insert into public.orden_avances (empresa_id, orden_id, texto, autor_id)
  values (v_orden.empresa_id, p_orden, left('Diagnóstico: ' || v_texto, 2000), auth.uid());
end;
$$;
revoke all on function public.registrar_diagnostico(uuid, text) from public, anon;
grant execute on function public.registrar_diagnostico(uuid, text) to authenticated;

-- 2. Facturado ---------------------------------------------------------------
create function privado.marcar_facturado() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden uuid := coalesce(new.orden_id, old.orden_id);
begin
  if v_orden is null then return null; end if;
  update public.ordenes_trabajo o
     set facturado_en = (
       select min(x.en) from (
         select c.creado_en as en from public.comprobantes_venta c where c.orden_id = v_orden and c.estado = 'confirmado'
         union all
         select r.emitido_en from public.recibos r where r.orden_id = v_orden and r.estado <> 'anulado'
       ) x)
   where o.id = v_orden
     and o.facturado_en is distinct from (
       select min(x.en) from (
         select c.creado_en as en from public.comprobantes_venta c where c.orden_id = v_orden and c.estado = 'confirmado'
         union all
         select r.emitido_en from public.recibos r where r.orden_id = v_orden and r.estado <> 'anulado'
       ) x);
  return null;
end;
$$;
create trigger comprobantes_facturado after insert or update of estado, orden_id on public.comprobantes_venta
  for each row execute function privado.marcar_facturado();
create trigger recibos_facturado after insert or update of estado on public.recibos
  for each row execute function privado.marcar_facturado();

-- Órdenes que ya tenían comprobante.
update public.ordenes_trabajo o set facturado_en = x.en
from (
  select orden_id, min(en) as en from (
    select orden_id, creado_en as en from public.comprobantes_venta where estado = 'confirmado' and orden_id is not null
    union all
    select orden_id, emitido_en from public.recibos where estado <> 'anulado'
  ) d group by orden_id
) x
where x.orden_id = o.id;

-- Índice de órdenes abiertas con hora prometida: ahora con los estados nuevos.
drop index if exists public.ordenes_entrega_abiertas;
create index ordenes_entrega_abiertas on public.ordenes_trabajo (empresa_id, entrega_prometida)
  where entrega_prometida is not null and not anulada
    and estado in ('en_taller', 'en_diagnostico', 'espera_aprobacion', 'aprobado', 'en_proceso', 'esperando_repuesto');

-- 3. Umbral de espera de aprobación ----------------------------------------
alter table public.configuracion_empresa
  add column horas_espera_aprobacion integer not null default 24 check (horas_espera_aprobacion between 1 and 720),
  add column horas_listo_sin_facturar integer not null default 4 check (horas_listo_sin_facturar between 1 and 720);

-- 4. Tipos de aviso nuevos -------------------------------------------------
alter table public.config_avisos drop constraint config_avisos_tipo_check;
alter table public.config_avisos add constraint config_avisos_tipo_check check (tipo in (
  'resumen_mediodia', 'resumen_cierre', 'citas_del_dia', 'cita_no_llego', 'carro_listo',
  'recordatorio_mantenimiento', 'encuesta', 'cotizacion', 'entrega_por_vencer', 'entrega_atrasada',
  'sin_movimiento', 'espera_aprobacion', 'listo_sin_facturar', 'resumen_para_caja', 'comprobante_no_cuadra', 'repuesto_sin_costo'
));

-- 5. Etiqueta de cada foto (la pone la IA al recibirla por WhatsApp; se puede cambiar en la app).
alter table public.archivos
  add column etiqueta text check (etiqueta is null or etiqueta in ('ingreso', 'dano', 'tablero', 'trabajo', 'salida', 'repuestos', 'documento', 'otro'));
