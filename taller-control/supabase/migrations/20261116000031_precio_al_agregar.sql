-- Agregar un servicio o producto a la orden con su precio, en un solo paso.
-- El precio vive en la cotización de la orden (la que ya alimenta el bloque Dinero
-- y el cobro), así no hay dos totales: se suma a la cotización en borrador o, si no
-- hay, se crea una (adicional si ya hubo una aprobada). Lo hacen gerencia,
-- administración, asesor y recepción. Cada línea guarda quién la puso y cuándo.
-- Se puede correr dos veces.

alter table public.cotizacion_items add column if not exists creado_por uuid default auth.uid();
alter table public.cotizacion_items add column if not exists creado_en timestamptz default now();

drop function if exists public.agregar_a_orden(uuid, text, text, numeric, numeric);
-- p_nuevo_trabajo = false: solo pone precio a un servicio que ya está en la orden (no lo repite).
create or replace function public.agregar_a_orden(
  p_orden uuid, p_tipo text, p_descripcion text, p_cantidad numeric, p_precio numeric, p_nuevo_trabajo boolean default true
) returns jsonb
language plpgsql
security definer -- recepción pone precios pero no edita órdenes: los permisos se revisan aquí
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_desc text := btrim(coalesce(p_descripcion, ''));
  v_cot uuid;
  v_tasa numeric;
  v_total numeric;
  v_sin numeric;
  v_aprobada boolean;
  v_catalogo uuid;
begin
  select * into v_orden from public.ordenes_trabajo where id = p_orden for update;
  if not found or not privado.ve_caja(v_orden.empresa_id) then
    raise exception 'Tu rol no pone precios en esta orden.' using errcode = '42501';
  end if;
  if v_orden.anulada then raise exception 'La orden está anulada.' using errcode = '23514'; end if;
  if v_orden.estado = 'entregado' then raise exception 'El carro ya se entregó: la orden ya no cambia.' using errcode = '23514'; end if;
  if p_tipo not in ('servicio', 'repuesto') then raise exception 'Elige servicio o producto.' using errcode = '22023'; end if;
  if char_length(v_desc) not between 2 and 160 then raise exception 'Escribe qué es (de 2 a 160 letras).' using errcode = '22023'; end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 9999 then raise exception 'Revisa la cantidad.' using errcode = '22023'; end if;
  if p_precio is null or p_precio < 0 or p_precio > 9999999 then raise exception 'Revisa el precio.' using errcode = '22023'; end if;
  -- Con recibo, boleta o factura vigente los precios ya no cambian (igual que al editar la cotización).
  if exists (select 1 from public.recibos where orden_id = p_orden and estado <> 'anulado')
     or exists (select 1 from public.comprobantes_venta where orden_id = p_orden and estado = 'confirmado') then
    raise exception 'La orden ya tiene recibo, boleta o factura: anúlalo primero para cambiar precios.' using errcode = '23514';
  end if;

  v_aprobada := exists (select 1 from public.cotizaciones where orden_id = p_orden and estado = 'aprobada');

  -- El servicio también queda en la lista de trabajos de la orden (lo que ve el técnico, sin precio).
  if p_tipo = 'servicio' and coalesce(p_nuevo_trabajo, true) then
    select id into v_catalogo from public.catalogo_servicios
      where empresa_id = v_orden.empresa_id and lower(nombre) = lower(v_desc) limit 1;
    insert into public.orden_servicios (empresa_id, orden_id, servicio_id, descripcion, es_adicional)
    values (v_orden.empresa_id, p_orden, v_catalogo, v_desc, v_aprobada);
  end if;

  v_total := round(p_cantidad * p_precio, 2);
  select id, tasa_igv into v_cot, v_tasa from public.cotizaciones
    where orden_id = p_orden and estado = 'borrador' order by version desc limit 1 for update;
  if v_cot is null then
    select c.tasa_igv into v_tasa from public.configuracion_empresa c where c.empresa_id = v_orden.empresa_id;
    v_tasa := coalesce(v_tasa, 0.18);
    v_sin := round(v_total / (1 + v_tasa), 2);
    v_cot := public.crear_cotizacion(p_orden, v_aprobada,
      jsonb_build_array(jsonb_build_object('tipo', p_tipo, 'descripcion', v_desc, 'cantidad', p_cantidad, 'precio', p_precio,
                                           'sin_igv', v_sin, 'igv', v_total - v_sin, 'total', v_total)),
      true);
  else
    v_sin := round(v_total / (1 + v_tasa), 2);
    insert into public.cotizacion_items (empresa_id, cotizacion_id, tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total)
    values (v_orden.empresa_id, v_cot, p_tipo, v_desc, p_cantidad, p_precio, v_sin, v_total - v_sin, v_total);
  end if;
  perform privado.totales_cotizacion(v_cot);

  return jsonb_build_object('cotizacion', v_cot, 'total', (select total from public.cotizaciones where id = v_cot));
end;
$$;

revoke all on function public.agregar_a_orden(uuid, text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.agregar_a_orden(uuid, text, text, numeric, numeric, boolean) to authenticated;
