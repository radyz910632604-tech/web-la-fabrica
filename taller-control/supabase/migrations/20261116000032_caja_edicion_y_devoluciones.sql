-- Caja: editar los servicios de la orden en el mismo panel de cobro, IGV de la
-- orden y devoluciones vinculadas al pago original. Se puede correr dos veces.
--
-- Los precios siguen viviendo en la cotización de la orden (no hay un segundo
-- total). Cada cambio crea una versión nueva y la anterior queda guardada con
-- quién la hizo (editar_cotizacion). Reglas:
--   · con recibo, boleta o factura vigente no se cambian precios;
--   · si la orden ya está pagada, ya se entregó, o el nuevo total queda por debajo
--     de lo pagado, el ajuste lo autoriza gerencia o administración;
--   · quitar el IGV a una orden que lo lleva también es de gerencia o administración
--     (el IGV responde al régimen del taller, no a si el cliente pide factura).

alter table public.pagos add column if not exists devuelve_pago_id uuid references public.pagos (id);
-- Las líneas guardan el orden en que se escribieron (dentro de una misma versión también).
alter table public.cotizacion_items alter column creado_en set default clock_timestamp();
create index if not exists pagos_devuelve on public.pagos (devuelve_pago_id) where devuelve_pago_id is not null;

-- Arma las líneas con sus montos a partir del precio SIN IGV por unidad.
-- Una línea que no cambió conserva sus montos guardados (sin centavos de diferencia).
create or replace function privado.lineas_desde_base(p_cot uuid, p_items jsonb, p_tasa numeric)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_cant numeric;
  v_base numeric;
  v_sin numeric;
  v_total numeric;
  v_desc text;
  v_tipo text;
  v_igual record;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_desc := btrim(coalesce(v_item ->> 'descripcion', ''));
    v_tipo := coalesce(v_item ->> 'tipo', 'servicio');
    v_cant := (v_item ->> 'cantidad')::numeric;
    v_base := (v_item ->> 'base')::numeric;
    -- También se acepta el precio CON IGV por unidad («precio»): se respeta exacto, sin céntimos de diferencia.
    if v_item ? 'precio' and v_base is null then
      v_cant := (v_item ->> 'cantidad')::numeric;
      if v_cant is null or v_cant <= 0 or v_cant > 9999 then raise exception 'Revisa la cantidad de «%».', v_desc using errcode = '22023'; end if;
      if (v_item ->> 'precio')::numeric is null or (v_item ->> 'precio')::numeric < 0 or (v_item ->> 'precio')::numeric > 9999999 then
        raise exception 'Revisa el precio de «%».', v_desc using errcode = '22023';
      end if;
      if char_length(v_desc) not between 2 and 200 then raise exception 'Cada línea necesita una descripción (2 a 200 letras).' using errcode = '22023'; end if;
      v_total := round(v_cant * (v_item ->> 'precio')::numeric, 2);
      v_sin := round(v_total / (1 + p_tasa), 2);
      v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'descripcion', v_desc, 'cantidad', v_cant,
        'precio', round(v_total / v_cant, 2), 'sin_igv', v_sin, 'igv', v_total - v_sin, 'total', v_total));
      continue;
    end if;
    if char_length(v_desc) not between 2 and 200 then raise exception 'Cada línea necesita una descripción (2 a 200 letras).' using errcode = '22023'; end if;
    if v_tipo not in ('servicio', 'repuesto') then raise exception 'Tipo de línea no válido.' using errcode = '22023'; end if;
    if v_cant is null or v_cant <= 0 or v_cant > 9999 then raise exception 'Revisa la cantidad de «%».', v_desc using errcode = '22023'; end if;
    if v_base is null or v_base < 0 or v_base > 9999999 then raise exception 'Revisa el precio de «%».', v_desc using errcode = '22023'; end if;
    v_sin := round(v_cant * v_base, 2);
    select i.subtotal_sin_igv, i.igv, i.total, i.precio_unitario_total into v_igual
    from public.cotizacion_items i join public.cotizaciones c on c.id = i.cotizacion_id
    where i.cotizacion_id = p_cot and i.descripcion = v_desc and i.tipo = v_tipo and i.cantidad = v_cant
      and round(i.subtotal_sin_igv / i.cantidad, 2) = round(v_base, 2) and c.tasa_igv = p_tasa
    limit 1;
    if found then
      v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'descripcion', v_desc, 'cantidad', v_cant,
        'precio', v_igual.precio_unitario_total, 'sin_igv', v_igual.subtotal_sin_igv, 'igv', v_igual.igv, 'total', v_igual.total));
    else
      v_total := round(v_sin * (1 + p_tasa), 2);
      v_out := v_out || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'descripcion', v_desc, 'cantidad', v_cant,
        'precio', round(v_total / v_cant, 2), 'sin_igv', v_sin, 'igv', v_total - v_sin, 'total', v_total));
    end if;
  end loop;
  return v_out;
end;
$$;

-- Revisa permisos y reglas de una orden antes de cambiar sus importes.
create or replace function privado.puede_ajustar_orden(p_orden uuid)
returns public.ordenes_trabajo
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_cuenta record;
begin
  select * into v_orden from public.ordenes_trabajo where id = p_orden;
  if not found or not privado.ve_caja(v_orden.empresa_id) then
    raise exception 'Tu rol no cambia importes en esta orden.' using errcode = '42501';
  end if;
  if v_orden.anulada then raise exception 'La orden está anulada.' using errcode = '23514'; end if;
  if exists (select 1 from public.recibos where orden_id = p_orden and estado <> 'anulado')
     or exists (select 1 from public.comprobantes_venta where orden_id = p_orden and estado = 'confirmado') then
    raise exception 'La orden ya tiene recibo, boleta o factura: anúlalo primero para cambiar importes.' using errcode = '23514';
  end if;
  select * into v_cuenta from privado.cuenta_orden(p_orden);
  if not privado.es_gestor(v_orden.empresa_id) then
    if v_orden.estado = 'entregado' then
      raise exception 'El carro ya se entregó: el ajuste lo autoriza gerencia o administración.' using errcode = '42501';
    end if;
    if v_cuenta.pagado > 0.009 and v_cuenta.saldo <= 0.009 then
      raise exception 'La orden ya está pagada: el ajuste lo autoriza gerencia o administración.' using errcode = '42501';
    end if;
  end if;
  return v_orden;
end;
$$;

-- Guarda las líneas de UNA cotización de la orden (o crea la primera) desde la caja.
-- p_items: [{tipo, descripcion, cantidad, base}] con el precio SIN IGV por unidad.
-- Lista vacía = se quitan todas las líneas: la cotización se anula (con nota de quién).
-- p_aprobar: el cliente está en caja; lo que se deja aquí queda aprobado en persona.
create or replace function public.editar_lineas_orden(
  p_orden uuid, p_cotizacion uuid, p_items jsonb, p_con_igv boolean default true, p_aprobar boolean default true
) returns jsonb
language plpgsql
security definer -- recepción ajusta importes en caja; los permisos se revisan aquí
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_vieja public.cotizaciones%rowtype;
  v_tasa numeric;
  v_items jsonb;
  v_nueva uuid;
  v_quien text;
  v_cuenta record;
  v_aprobada boolean;
begin
  v_orden := privado.puede_ajustar_orden(p_orden);
  perform 1 from public.ordenes_trabajo where id = p_orden for update;
  select nombre into v_quien from public.perfiles where id = auth.uid();
  select c.tasa_igv into v_tasa from public.configuracion_empresa c where c.empresa_id = v_orden.empresa_id;
  v_tasa := coalesce(v_tasa, 0.18);

  if p_cotizacion is not null then
    select * into v_vieja from public.cotizaciones where id = p_cotizacion and orden_id = p_orden for update;
    if not found or v_vieja.estado in ('anulada', 'rechazada') then
      raise exception 'Esa cotización ya no está vigente: recarga la orden.' using errcode = '23514';
    end if;
    -- Quitar el IGV a lo que lo lleva: gerencia o administración.
    if v_vieja.tasa_igv > 0 and not coalesce(p_con_igv, true) and not privado.es_gestor(v_orden.empresa_id) then
      raise exception 'Quitar el IGV lo autoriza gerencia o administración.' using errcode = '42501';
    end if;
  end if;
  if not coalesce(p_con_igv, true) then v_tasa := 0; end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    if p_cotizacion is null then raise exception 'Agrega al menos una línea.' using errcode = '22023'; end if;
    update public.cotizaciones set estado = 'anulada',
      respuesta_texto = left('Quitada en caja por ' || coalesce(v_quien, 'el taller'), 500)
    where id = p_cotizacion;
  else
    v_items := privado.lineas_desde_base(p_cotizacion, p_items, v_tasa);
    if p_cotizacion is null then
      v_aprobada := exists (select 1 from public.cotizaciones where orden_id = p_orden and estado = 'aprobada');
      v_nueva := public.crear_cotizacion(p_orden, v_aprobada, v_items, coalesce(p_con_igv, true));
    else
      v_nueva := public.editar_cotizacion(p_cotizacion, v_items, coalesce(p_con_igv, true));
      -- El descuento ya autorizado se conserva en la versión nueva.
      update public.cotizaciones set descuento_tipo = v_vieja.descuento_tipo, descuento_valor = v_vieja.descuento_valor,
        descuento_motivo = v_vieja.descuento_motivo
      where id = v_nueva and v_vieja.descuento_tipo is not null;
    end if;
    perform privado.totales_cotizacion(v_nueva);
    if coalesce(p_aprobar, true) then
      update public.cotizaciones set estado = 'aprobada', aprobada_por_medio = coalesce(aprobada_por_medio, 'presencial'),
        respuesta_en = coalesce(respuesta_en, now()),
        respuesta_texto = coalesce(respuesta_texto, left('Aprobada en caja por ' || coalesce(v_quien, 'el taller'), 500))
      where id = v_nueva and estado <> 'aprobada';
    end if;
  end if;

  -- La lista de trabajos (lo que ve el técnico) sigue a los servicios con precio:
  -- un servicio nuevo entra; uno que se quitó de todas las cotizaciones vigentes sale.
  insert into public.orden_servicios (empresa_id, orden_id, descripcion, es_adicional)
  select distinct on (lower(btrim(i.descripcion))) v_orden.empresa_id, p_orden, btrim(i.descripcion),
         exists (select 1 from public.cotizaciones c2 where c2.orden_id = p_orden and c2.estado = 'aprobada' and c2.id <> coalesce(v_nueva, '00000000-0000-0000-0000-000000000000'::uuid))
  from public.cotizacion_items i join public.cotizaciones c on c.id = i.cotizacion_id
  where c.orden_id = p_orden and c.estado in ('borrador', 'enviada', 'aprobada') and i.tipo = 'servicio'
    and not exists (select 1 from public.orden_servicios s where s.orden_id = p_orden and lower(btrim(s.descripcion)) = lower(btrim(i.descripcion)));
  if p_cotizacion is not null and v_orden.estado <> 'entregado' then
    delete from public.orden_servicios s
    where s.orden_id = p_orden
      and exists (select 1 from public.cotizacion_items i where i.cotizacion_id = p_cotizacion and i.tipo = 'servicio' and lower(btrim(i.descripcion)) = lower(btrim(s.descripcion)))
      and not exists (select 1 from public.cotizacion_items i join public.cotizaciones c on c.id = i.cotizacion_id
                      where c.orden_id = p_orden and c.estado in ('borrador', 'enviada', 'aprobada') and i.tipo = 'servicio'
                        and lower(btrim(i.descripcion)) = lower(btrim(s.descripcion)));
  end if;

  -- Si el nuevo total queda por debajo de lo ya pagado, solo gerencia o administración.
  select * into v_cuenta from privado.cuenta_orden(p_orden);
  if v_cuenta.saldo < -0.009 and not privado.es_gestor(v_orden.empresa_id) then
    raise exception 'El nuevo total (S/ %) es menor que lo ya pagado (S/ %): lo autoriza gerencia o administración.',
      to_char(v_cuenta.a_cobrar, 'FM999G999G990D00'), to_char(v_cuenta.pagado, 'FM999G999G990D00') using errcode = '42501';
  end if;
  return jsonb_build_object('cotizacion', v_nueva, 'a_cobrar', v_cuenta.a_cobrar, 'pagado', v_cuenta.pagado, 'saldo', v_cuenta.saldo);
end;
$$;

-- Prende o apaga el IGV de toda la orden: cada cotización vigente se guarda otra vez
-- sobre el mismo precio sin IGV (versión nueva, con quién lo hizo). Apagarlo: gestores.
create or replace function public.cambiar_igv_orden(p_orden uuid, p_con_igv boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_cot record;
  v_items jsonb;
  v_res jsonb := '{}'::jsonb;
begin
  v_orden := privado.puede_ajustar_orden(p_orden);
  if not p_con_igv and not privado.es_gestor(v_orden.empresa_id) then
    raise exception 'Quitar el IGV lo autoriza gerencia o administración.' using errcode = '42501';
  end if;
  for v_cot in
    select id, tasa_igv, estado from public.cotizaciones
    where orden_id = p_orden and estado in ('borrador', 'enviada', 'aprobada') and (tasa_igv > 0) <> p_con_igv
    order by version
  loop
    select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'descripcion', descripcion, 'cantidad', cantidad,
             'base', round(subtotal_sin_igv / cantidad, 4)) order by id), '[]'::jsonb)
      into v_items from public.cotizacion_items where cotizacion_id = v_cot.id;
    v_res := public.editar_lineas_orden(p_orden, v_cot.id, v_items, p_con_igv, v_cot.estado = 'aprobada');
  end loop;
  return v_res;
end;
$$;

-- Devolución al cliente: movimiento aparte, vinculado al pago original, por el mismo medio.
-- No borra ni cambia el pago. Solo hasta lo que el cliente tiene a favor y lo que queda de ese pago.
create or replace function public.registrar_devolucion(p_pago uuid, p_monto numeric, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pago public.pagos%rowtype;
  v_devuelto numeric;
  v_cuenta record;
  v_id uuid;
begin
  select * into v_pago from public.pagos where id = p_pago for update;
  if not found or not privado.ve_caja(v_pago.empresa_id) then raise exception 'Tu rol no registra devoluciones.' using errcode = '42501'; end if;
  if v_pago.estado <> 'confirmado' or v_pago.tipo = 'devolucion' then raise exception 'Solo se devuelve de un pago confirmado.' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo de la devolución.' using errcode = '22023'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor que cero.' using errcode = '22023'; end if;
  perform 1 from public.ordenes_trabajo where id = v_pago.orden_id for update;
  select coalesce(sum(monto), 0) into v_devuelto from public.pagos where devuelve_pago_id = p_pago and estado = 'confirmado';
  if round(p_monto, 2) > v_pago.monto - v_devuelto + 0.009 then
    raise exception 'De ese pago solo quedan S/ % por devolver.', to_char(v_pago.monto - v_devuelto, 'FM999G999G990D00') using errcode = '23514';
  end if;
  select * into v_cuenta from privado.cuenta_orden(v_pago.orden_id);
  if round(p_monto, 2) > -v_cuenta.saldo + 0.009 then
    raise exception 'El cliente tiene S/ % a favor: no se puede devolver más.', to_char(greatest(-v_cuenta.saldo, 0), 'FM999G999G990D00') using errcode = '23514';
  end if;
  insert into public.pagos (empresa_id, orden_id, monto, tipo, medio, numero_operacion, devuelve_pago_id)
  values (v_pago.empresa_id, v_pago.orden_id, round(p_monto, 2), 'devolucion', v_pago.medio,
          left('Devolución: ' || btrim(p_motivo), 40), p_pago)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function privado.lineas_desde_base(uuid, jsonb, numeric) from public, anon;
revoke all on function privado.puede_ajustar_orden(uuid) from public, anon;
grant execute on function privado.puede_ajustar_orden(uuid) to authenticated;
grant execute on function privado.lineas_desde_base(uuid, jsonb, numeric) to authenticated;
revoke all on function public.editar_lineas_orden(uuid, uuid, jsonb, boolean, boolean) from public, anon;
grant execute on function public.editar_lineas_orden(uuid, uuid, jsonb, boolean, boolean) to authenticated;
revoke all on function public.cambiar_igv_orden(uuid, boolean) from public, anon;
grant execute on function public.cambiar_igv_orden(uuid, boolean) to authenticated;
revoke all on function public.registrar_devolucion(uuid, numeric, text) from public, anon;
grant execute on function public.registrar_devolucion(uuid, numeric, text) to authenticated;
