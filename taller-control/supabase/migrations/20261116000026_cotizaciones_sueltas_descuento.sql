-- Cotizaciones como sección propia: número correlativo, cotización suelta (cliente sin orden todavía)
-- y descuento (en soles o en %, con motivo) que se resta del total. Se puede correr más de una vez.

alter table public.cotizaciones alter column orden_id drop not null;
alter table public.cotizaciones
  add column if not exists numero integer,
  add column if not exists cliente_nombre text,
  add column if not exists cliente_celular text,
  add column if not exists cliente_documento text,
  add column if not exists placa text,
  add column if not exists vehiculo text,
  add column if not exists total_lineas numeric(12, 2),
  add column if not exists descuento_tipo text,
  add column if not exists descuento_valor numeric(12, 2),
  add column if not exists descuento numeric(12, 2) not null default 0,
  add column if not exists descuento_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cotizaciones_orden_o_cliente') then
    alter table public.cotizaciones add constraint cotizaciones_orden_o_cliente
      check (orden_id is not null or char_length(btrim(coalesce(cliente_nombre, ''))) >= 2);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cotizaciones_descuento_valido') then
    alter table public.cotizaciones add constraint cotizaciones_descuento_valido check (
      (descuento_tipo is null or descuento_tipo in ('monto', 'porcentaje'))
      and descuento >= 0
      and (descuento_tipo is distinct from 'porcentaje' or descuento_valor between 0 and 100)
      and (descuento = 0 or char_length(btrim(coalesce(descuento_motivo, ''))) >= 3));
  end if;
end $$;

-- Número correlativo por taller (para la lista y el PDF). Los que ya existen, por antigüedad.
update public.cotizaciones c set numero = x.n
from (select id, row_number() over (partition by empresa_id order by creado_en, id) n from public.cotizaciones) x
where x.id = c.id and c.numero is null;
update public.cotizaciones set total_lineas = total where total_lineas is null;
create unique index if not exists cotizaciones_numero on public.cotizaciones (empresa_id, numero);

create or replace function privado.numerar_cotizacion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext('cotizacion:' || new.empresa_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from public.cotizaciones where empresa_id = new.empresa_id;
  end if;
  return new;
end;
$$;
drop trigger if exists cotizaciones_numerar on public.cotizaciones;
create trigger cotizaciones_numerar before insert on public.cotizaciones for each row execute function privado.numerar_cotizacion();

-- Recalcula totales de una cotización: suma de líneas − descuento; IGV sacado del total.
create or replace function privado.totales_cotizacion(p_cot uuid) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_lineas numeric;
  v_tasa numeric;
  v_tipo text;
  v_valor numeric;
  v_desc numeric := 0;
  v_total numeric;
  v_sin numeric;
begin
  select tasa_igv, descuento_tipo, coalesce(descuento_valor, 0) into v_tasa, v_tipo, v_valor from public.cotizaciones where id = p_cot;
  select coalesce(sum(total), 0) into v_lineas from public.cotizacion_items where cotizacion_id = p_cot;
  if v_tipo = 'monto' then v_desc := least(round(v_valor, 2), v_lineas);
  elsif v_tipo = 'porcentaje' then v_desc := round(v_lineas * v_valor / 100, 2);
  end if;
  v_total := v_lineas - v_desc;
  v_sin := round(v_total / (1 + v_tasa), 2);
  update public.cotizaciones set total_lineas = v_lineas, descuento = v_desc, total = v_total,
    subtotal_sin_igv = v_sin, igv = v_total - v_sin
  where id = p_cot;
end;
$$;

-- Guardar una cotización (nueva o editada), de una orden o suelta, con su descuento.
-- - De una orden ya creada: se edita como hasta ahora (versión nueva, la anterior queda anulada).
-- - Suelta: se corrige en el mismo registro (todavía no hay orden ni dinero de por medio).
create or replace function public.guardar_cotizacion(
  p_empresa uuid, p_id uuid, p_orden uuid, p_cliente jsonb, p_items jsonb, p_con_igv boolean,
  p_descuento jsonb default null, p_adicional boolean default false
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_actual public.cotizaciones;
  v_tasa numeric;
  v_item jsonb;
  v_tipo text := nullif(p_descuento ->> 'tipo', '');
  v_valor numeric := coalesce((p_descuento ->> 'valor')::numeric, 0);
  v_motivo text := nullif(btrim(coalesce(p_descuento ->> 'motivo', '')), '');
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La cotización necesita al menos una línea.' using errcode = 'check_violation';
  end if;
  if v_valor <= 0 then v_tipo := null; v_valor := 0; end if;
  if v_tipo is not null and v_motivo is null then
    raise exception 'Escribe el motivo del descuento.' using errcode = 'check_violation';
  end if;

  if p_id is not null then
    select * into v_actual from public.cotizaciones where id = p_id;
    if not found then raise exception 'No se encontró la cotización.' using errcode = 'no_data_found'; end if;
    if v_actual.orden_id is not null then
      v_id := public.editar_cotizacion(p_id, p_items, p_con_igv);
    else
      if v_actual.estado = 'anulada' then
        raise exception 'Esta cotización está anulada.' using errcode = 'check_violation';
      end if;
      select c.tasa_igv into v_tasa from public.configuracion_empresa c where c.empresa_id = v_actual.empresa_id;
      delete from public.cotizacion_items where cotizacion_id = p_id;
      update public.cotizaciones set
        tasa_igv = case when coalesce(p_con_igv, true) then v_tasa else 0 end,
        cliente_nombre = coalesce(nullif(btrim(p_cliente ->> 'nombre'), ''), cliente_nombre),
        cliente_celular = nullif(btrim(coalesce(p_cliente ->> 'celular', '')), ''),
        cliente_documento = nullif(btrim(coalesce(p_cliente ->> 'documento', '')), ''),
        placa = nullif(upper(btrim(coalesce(p_cliente ->> 'placa', ''))), ''),
        vehiculo = nullif(btrim(coalesce(p_cliente ->> 'vehiculo', '')), '')
      where id = p_id;
      for v_item in select value from jsonb_array_elements(p_items) loop
        insert into public.cotizacion_items (empresa_id, cotizacion_id, tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total)
        values (v_actual.empresa_id, p_id, v_item ->> 'tipo', btrim(v_item ->> 'descripcion'), (v_item ->> 'cantidad')::numeric,
                (v_item ->> 'precio')::numeric, (v_item ->> 'sin_igv')::numeric, (v_item ->> 'igv')::numeric, (v_item ->> 'total')::numeric);
      end loop;
      v_id := p_id;
    end if;
  elsif p_orden is not null then
    v_id := public.crear_cotizacion(p_orden, coalesce(p_adicional, false), p_items, p_con_igv);
  else
    if char_length(btrim(coalesce(p_cliente ->> 'nombre', ''))) < 2 then
      raise exception 'Escribe el nombre del cliente.' using errcode = 'check_violation';
    end if;
    select c.tasa_igv into v_tasa from public.configuracion_empresa c where c.empresa_id = p_empresa;
    insert into public.cotizaciones (empresa_id, orden_id, version, tasa_igv, cliente_nombre, cliente_celular, cliente_documento, placa, vehiculo)
    values (p_empresa, null, 1, case when coalesce(p_con_igv, true) then v_tasa else 0 end,
            btrim(p_cliente ->> 'nombre'), nullif(btrim(coalesce(p_cliente ->> 'celular', '')), ''),
            nullif(btrim(coalesce(p_cliente ->> 'documento', '')), ''), nullif(upper(btrim(coalesce(p_cliente ->> 'placa', ''))), ''),
            nullif(btrim(coalesce(p_cliente ->> 'vehiculo', '')), ''))
    returning id into v_id;
    for v_item in select value from jsonb_array_elements(p_items) loop
      insert into public.cotizacion_items (empresa_id, cotizacion_id, tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total)
      values (p_empresa, v_id, v_item ->> 'tipo', btrim(v_item ->> 'descripcion'), (v_item ->> 'cantidad')::numeric,
              (v_item ->> 'precio')::numeric, (v_item ->> 'sin_igv')::numeric, (v_item ->> 'igv')::numeric, (v_item ->> 'total')::numeric);
    end loop;
  end if;

  update public.cotizaciones set descuento_tipo = v_tipo, descuento_valor = case when v_tipo is null then null else v_valor end,
    descuento_motivo = case when v_tipo is null then null else v_motivo end
  where id = v_id;
  perform privado.totales_cotizacion(v_id);
  return v_id;
end;
$$;
revoke all on function public.guardar_cotizacion(uuid, uuid, uuid, jsonb, jsonb, boolean, jsonb, boolean) from public, anon;
grant execute on function public.guardar_cotizacion(uuid, uuid, uuid, jsonb, jsonb, boolean, jsonb, boolean) to authenticated;

-- Pasar una cotización suelta a una orden (cuando el carro llega).
create or replace function public.asignar_cotizacion_a_orden(p_cot uuid, p_orden uuid) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
begin
  if not exists (select 1 from public.cotizaciones where id = p_cot and orden_id is null and estado <> 'anulada') then
    raise exception 'Esta cotización ya está en una orden o está anulada.' using errcode = 'check_violation';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.cotizaciones where orden_id = p_orden;
  update public.cotizaciones set orden_id = p_orden, version = v_version where id = p_cot;
end;
$$;
revoke all on function public.asignar_cotizacion_a_orden(uuid, uuid) from public, anon;
grant execute on function public.asignar_cotizacion_a_orden(uuid, uuid) to authenticated;
