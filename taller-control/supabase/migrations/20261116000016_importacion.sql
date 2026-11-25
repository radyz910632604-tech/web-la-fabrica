-- =====================================================================
-- Importar el Excel anterior del taller
-- ---------------------------------------------------------------------
-- 1. Las órdenes, ventas y compras importadas quedan marcadas: no se
--    confunden con las del día a día ni llenan las alertas.
-- 2. importar_orden_historica(): una orden ya entregada, con su fecha
--    antigua, sin avisos al cliente (no pasa por los cambios de estado).
-- =====================================================================

alter table public.ordenes_trabajo add column importada boolean not null default false;
comment on column public.ordenes_trabajo.importada is 'Viene del Excel anterior (historial): ya estaba entregada al importarse.';

alter table public.comprobantes_venta drop constraint comprobantes_venta_origen_datos_check;
alter table public.comprobantes_venta add constraint comprobantes_venta_origen_datos_check check (origen_datos in ('manual', 'xml_sunat', 'ia', 'importado'));
alter table public.compras drop constraint compras_origen_datos_check;
alter table public.compras add constraint compras_origen_datos_check check (origen_datos in ('manual', 'xml_sunat', 'ia', 'importado'));

-- Una orden del historial: entregada en su fecha, con sus servicios. Solo gerencia y administración.
-- No hay cambio de estado, así que no salen avisos, encuestas ni recordatorios al cliente.
create function public.importar_orden_historica(
  p_empresa uuid, p_vehiculo uuid, p_fecha date, p_servicios text[], p_kilometraje integer default null, p_notas text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehiculo public.vehiculos;
  v_id uuid;
  v_cuando timestamptz := (p_fecha::timestamp + time '12:00') at time zone 'America/Lima';
  s text;
begin
  if not privado.es_gestor(p_empresa) then
    raise exception 'Solo gerencia y administración importan el historial.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_vehiculo from public.vehiculos where id = p_vehiculo and empresa_id = p_empresa;
  if not found then
    raise exception 'El carro no es de este taller.' using errcode = 'no_data_found';
  end if;
  if v_vehiculo.cliente_id is null then
    raise exception 'El carro % no tiene dueño con celular: impórtalo primero en «Clientes y sus carros».', v_vehiculo.placa using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Lima')::date or p_fecha < date '1990-01-01' then
    raise exception 'Fecha no válida.' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(p_servicios, 1), 0) = 0 then
    raise exception 'Falta el servicio.' using errcode = 'check_violation';
  end if;
  -- La misma visita importada dos veces no se duplica.
  select o.id into v_id from public.ordenes_trabajo o
  where o.vehiculo_id = p_vehiculo and o.importada and not o.anulada and (o.ingresado_en at time zone 'America/Lima')::date = p_fecha
  limit 1;
  if v_id is not null then return null; end if;

  insert into public.ordenes_trabajo (empresa_id, vehiculo_id, cliente_id, estado, ingresado_en, kilometraje_ingreso, observaciones_ingreso, importada)
  values (p_empresa, p_vehiculo, v_vehiculo.cliente_id, 'entregado', v_cuando, p_kilometraje, left(nullif(btrim(coalesce(p_notas, '')), ''), 1000), true)
  returning id into v_id;
  -- Las fechas de la visita (al crearse se marcaron con la hora de hoy).
  update public.ordenes_trabajo set listo_en = v_cuando, entregado_en = v_cuando, estado_cambiado_en = v_cuando where id = v_id;
  update public.orden_estados_historial set cambiado_en = v_cuando, nota = 'Importado del Excel' where orden_id = v_id;
  foreach s in array p_servicios loop
    if char_length(btrim(s)) >= 2 then
      insert into public.orden_servicios (empresa_id, orden_id, descripcion) values (p_empresa, v_id, left(btrim(s), 160));
    end if;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.importar_orden_historica(uuid, uuid, date, text[], integer, text) from public, anon;
grant execute on function public.importar_orden_historica(uuid, uuid, date, text[], integer, text) to authenticated;
