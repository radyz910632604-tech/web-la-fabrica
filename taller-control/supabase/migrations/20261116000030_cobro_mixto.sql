-- Cobro de una orden en uno o varios medios a la vez (pago mixto).
-- Todo o nada, sin duplicar: cada cobro lleva un código único (lo crea la
-- pantalla) y si llega dos veces no se registra de nuevo. La base calcula
-- cuánto falta cobrar; no se confía en lo que diga la pantalla.
-- Se puede correr dos veces.

alter table public.pagos add column if not exists cobro_id uuid;
alter table public.pagos add column if not exists cobro_linea smallint;
create unique index if not exists pagos_cobro_linea on public.pagos (cobro_id, cobro_linea) where cobro_id is not null;

-- Lo que se cobra, lo pagado y el saldo de una orden (igual que saldo() en src/lib/dinero.ts):
-- manda la boleta o factura vigente (menos notas de crédito); si no hay, las cotizaciones aprobadas.
create or replace function privado.cuenta_orden(p_orden uuid)
returns table (a_cobrar numeric, pagado numeric, saldo numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select count(*) as n, coalesce(sum(total), 0) as total
    from public.comprobantes_venta where orden_id = p_orden and estado = 'confirmado'
  ), nc as (
    select coalesce(sum(total), 0) as total from public.notas_credito where orden_id = p_orden and estado = 'confirmado'
  ), cot as (
    select coalesce(sum(total), 0) as total from public.cotizaciones where orden_id = p_orden and estado = 'aprobada'
  ), pg as (
    select coalesce(sum(case when tipo = 'devolucion' then -monto else monto end), 0) as total
    from public.pagos where orden_id = p_orden and estado = 'confirmado'
  )
  select round(x.cobrar, 2), round(pg.total, 2), round(x.cobrar - pg.total, 2)
  from (select case when c.n > 0 then c.total - nc.total else cot.total end as cobrar from c, nc, cot) x, pg;
$$;

create or replace function public.registrar_cobro(p_orden uuid, p_cobro uuid, p_lineas jsonb)
returns jsonb
language plpgsql
security definer -- recepción cobra pero no edita órdenes: los permisos se revisan aquí
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_cuenta record;
  v_total numeric := 0;
  v_linea jsonb;
  v_i smallint := 0;
  v_tipo text;
  v_monto numeric;
  v_medio text;
  v_op text;
begin
  if p_cobro is null then raise exception 'Falta el código del cobro.' using errcode = '22023'; end if;
  if not exists (select 1 from public.ordenes_trabajo o where o.id = p_orden and privado.ve_caja(o.empresa_id)) then
    raise exception 'Tu rol no registra pagos en esta orden.' using errcode = '42501';
  end if;
  -- Si este cobro ya se registró (doble clic, se cortó la conexión), no se repite.
  if exists (select 1 from public.pagos where cobro_id = p_cobro and orden_id = p_orden) then
    select * into v_cuenta from privado.cuenta_orden(p_orden);
    return jsonb_build_object('repetido', true, 'a_cobrar', v_cuenta.a_cobrar, 'pagado', v_cuenta.pagado, 'saldo', v_cuenta.saldo);
  end if;

  -- Una orden a la vez: el segundo cobro espera a que termine el primero.
  select * into v_orden from public.ordenes_trabajo where id = p_orden for update;
  if not found or not privado.ve_caja(v_orden.empresa_id) then raise exception 'Tu rol no registra pagos en esta orden.' using errcode = '42501'; end if;
  if v_orden.anulada then raise exception 'La orden está anulada: no se le cobra.' using errcode = '23514'; end if;

  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un monto.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lineas) > 6 then raise exception 'Máximo 6 medios en un cobro.' using errcode = '22023'; end if;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_monto := round((v_linea ->> 'monto')::numeric, 2);
    v_medio := v_linea ->> 'medio';
    if v_monto is null or v_monto <= 0 then raise exception 'Cada monto debe ser mayor que cero.' using errcode = '22023'; end if;
    if v_medio is null or v_medio not in ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia') then
      raise exception 'Medio de pago no válido.' using errcode = '22023';
    end if;
    v_total := v_total + v_monto;
  end loop;

  select * into v_cuenta from privado.cuenta_orden(p_orden);
  -- Con precio definido, no se cobra más de lo que falta (lo de más sería un error de tipeo).
  if v_cuenta.a_cobrar > 0 and v_total > v_cuenta.saldo + 0.009 then
    raise exception 'Es más de lo que falta cobrar (S/ %).', to_char(greatest(v_cuenta.saldo, 0), 'FM999G999G990D00') using errcode = '23514';
  end if;
  v_tipo := case
    when v_cuenta.a_cobrar <= 0 then 'adelanto'
    when v_total >= v_cuenta.saldo - 0.009 then 'saldo'
    else 'abono'
  end;

  for v_linea in select * from jsonb_array_elements(p_lineas) loop
    v_i := v_i + 1;
    v_op := nullif(btrim(coalesce(v_linea ->> 'operacion', '')), '');
    insert into public.pagos (empresa_id, orden_id, monto, tipo, medio, numero_operacion, cobro_id, cobro_linea)
    values (v_orden.empresa_id, p_orden, round((v_linea ->> 'monto')::numeric, 2), v_tipo, v_linea ->> 'medio', left(v_op, 40), p_cobro, v_i);
  end loop;

  select * into v_cuenta from privado.cuenta_orden(p_orden);
  return jsonb_build_object('repetido', false, 'tipo', v_tipo, 'cobrado', v_total, 'a_cobrar', v_cuenta.a_cobrar, 'pagado', v_cuenta.pagado, 'saldo', v_cuenta.saldo);
end;
$$;

revoke all on function public.registrar_cobro(uuid, uuid, jsonb) from public, anon;
grant execute on function public.registrar_cobro(uuid, uuid, jsonb) to authenticated;
revoke all on function privado.cuenta_orden(uuid) from public, anon;
grant execute on function privado.cuenta_orden(uuid) to authenticated;

-- Descuentos autorizados: solo gerencia o administración ponen o cambian un descuento
-- (tipo y valor). Una versión nueva que conserva el descuento ya autorizado sí pasa.
create or replace function privado.descuento_autorizado() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.descuento_tipo is not null and coalesce(new.descuento_valor, 0) > 0
     and (tg_op = 'INSERT' or (new.descuento_tipo, new.descuento_valor) is distinct from (old.descuento_tipo, old.descuento_valor))
     and not privado.es_gestor(new.empresa_id)
     and not exists (
       select 1 from public.cotizaciones c
       where c.id = new.reemplaza_id and c.descuento_tipo = new.descuento_tipo and c.descuento_valor = new.descuento_valor
     ) then
    raise exception 'El descuento lo autoriza gerencia o administración.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists cotizaciones_descuento_autorizado on public.cotizaciones;
create trigger cotizaciones_descuento_autorizado before insert or update of descuento_tipo, descuento_valor on public.cotizaciones
  for each row execute function privado.descuento_autorizado();
