-- Registro de compras y cotizaciones en un solo paso (todo o nada).
-- Corren con los permisos de quien llama (security invoker): las reglas RLS
-- de compras, proveedores y cotizaciones siguen mandando.

create function public.registrar_compra(p_empresa uuid, p_proveedor jsonb, p_compra jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prov uuid := nullif(p_proveedor ->> 'id', '')::uuid;
  v_compra uuid;
  v_item jsonb;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La compra necesita al menos una línea.' using errcode = 'check_violation';
  end if;
  if v_prov is null and coalesce(p_proveedor ->> 'ruc', '') <> '' then
    select id into v_prov from public.proveedores where empresa_id = p_empresa and ruc = p_proveedor ->> 'ruc';
  end if;
  if v_prov is null then
    insert into public.proveedores (empresa_id, ruc, razon_social)
    values (p_empresa, nullif(p_proveedor ->> 'ruc', ''), btrim(p_proveedor ->> 'razon_social'))
    returning id into v_prov;
  end if;

  insert into public.compras (empresa_id, proveedor_id, tipo_comprobante, serie, numero, fecha_emision, moneda, tipo_cambio,
                              tasa_igv, subtotal_sin_igv, igv, total, origen_datos)
  values (p_empresa, v_prov, p_compra ->> 'tipo', nullif(p_compra ->> 'serie', ''), nullif(p_compra ->> 'numero', ''),
          (p_compra ->> 'fecha')::date, p_compra ->> 'moneda', (p_compra ->> 'tipo_cambio')::numeric,
          (p_compra ->> 'tasa_igv')::numeric, (p_compra ->> 'sin_igv')::numeric, (p_compra ->> 'igv')::numeric,
          (p_compra ->> 'total')::numeric, coalesce(p_compra ->> 'origen', 'manual'))
  returning id into v_compra;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.compra_items (empresa_id, compra_id, descripcion, cantidad, precio_unitario_sin_igv, subtotal_sin_igv, igv, total, destino, orden_id)
    values (p_empresa, v_compra, btrim(v_item ->> 'descripcion'), (v_item ->> 'cantidad')::numeric, (v_item ->> 'precio_sin_igv')::numeric,
            (v_item ->> 'sin_igv')::numeric, (v_item ->> 'igv')::numeric, (v_item ->> 'total')::numeric,
            case when nullif(v_item ->> 'orden', '') is null then 'stock' else 'orden' end, nullif(v_item ->> 'orden', '')::uuid);
  end loop;
  return v_compra;
end;
$$;

create function public.crear_cotizacion(p_orden uuid, p_adicional boolean, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_tasa numeric;
  v_cot uuid;
  v_version integer;
  v_item jsonb;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La cotización necesita al menos una línea.' using errcode = 'check_violation';
  end if;
  select o.empresa_id, c.tasa_igv into v_empresa, v_tasa
  from public.ordenes_trabajo o join public.configuracion_empresa c on c.empresa_id = o.empresa_id
  where o.id = p_orden;
  if v_empresa is null then
    raise exception 'No se encontró la orden.' using errcode = 'no_data_found';
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.cotizaciones where orden_id = p_orden;

  insert into public.cotizaciones (empresa_id, orden_id, version, es_adicional, tasa_igv)
  values (v_empresa, p_orden, v_version, coalesce(p_adicional, false), v_tasa)
  returning id into v_cot;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.cotizacion_items (empresa_id, cotizacion_id, tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total)
    values (v_empresa, v_cot, v_item ->> 'tipo', btrim(v_item ->> 'descripcion'), (v_item ->> 'cantidad')::numeric,
            (v_item ->> 'precio')::numeric, (v_item ->> 'sin_igv')::numeric, (v_item ->> 'igv')::numeric, (v_item ->> 'total')::numeric);
  end loop;

  update public.cotizaciones c set
    subtotal_sin_igv = s.sin_igv, igv = s.igv, total = s.total
  from (select sum(subtotal_sin_igv) sin_igv, sum(igv) igv, sum(total) total from public.cotizacion_items where cotizacion_id = v_cot) s
  where c.id = v_cot;
  return v_cot;
end;
$$;

revoke execute on function public.registrar_compra(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke execute on function public.crear_cotizacion(uuid, boolean, jsonb) from public, anon;
grant execute on function public.registrar_compra(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.crear_cotizacion(uuid, boolean, jsonb) to authenticated;
