-- Fondo de Almacén y número de comprobante.
-- 1) Entregar dinero a Almacén (o recibir su vuelto) es un traspaso de efectivo, NO un gasto:
--    el gasto se registra cuando se compra (con su comprobante).
-- 2) Compras, gastos y salidas de caja guardan tipo y número de comprobante; si se guarda en el
--    apuro sin número, queda «comprobante pendiente» y se completa después (solo eso se puede cambiar).

-- ---------------------------------------------------------------------
-- 1. Movimientos de fondo entre cajas
-- ---------------------------------------------------------------------
alter table public.movimientos_caja
  add column clase text not null default 'normal' check (clase in ('normal', 'asignacion_fondo', 'devolucion_fondo')),
  add column transferencia_id uuid,
  add column entregado_por uuid references public.perfiles (id),
  add column recibido_por uuid references public.perfiles (id),
  add constraint movimientos_fondo_no_es_gasto check (clase = 'normal' or (categoria_gasto is null and compra_id is null and medio = 'efectivo'));
create index movimientos_transferencia on public.movimientos_caja (transferencia_id) where transferencia_id is not null;

-- Entregar fondo a Almacén (asignación) o recibir el vuelto de Almacén (devolución).
-- p_origen: 'recepcion' (sale de la Caja de Recepción) o 'externo' (lo da el dueño, fuera de las cajas).
create function public.mover_fondo_almacen(
  p_empresa uuid, p_tipo text, p_monto numeric, p_origen text,
  p_entregado_por uuid, p_recibido_por uuid, p_nota text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_almacen uuid;
  v_recepcion uuid;
  v_id uuid := gen_random_uuid();
  v_clase text;
  v_texto text;
begin
  if p_tipo not in ('asignacion', 'devolucion') or p_origen not in ('recepcion', 'externo') then
    raise exception 'Movimiento de fondo no válido.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'Escribe el monto.' using errcode = 'check_violation';
  end if;
  if not (privado.ve_caja_de(p_empresa, 'almacen') or privado.ve_caja_de(p_empresa, 'recepcion')) then
    raise exception 'Tu rol no maneja las cajas.' using errcode = 'insufficient_privilege';
  end if;
  if p_origen = 'externo' and not privado.es_gestor(p_empresa) then
    raise exception 'El dinero de fuera de las cajas lo registran gerencia o administración.' using errcode = 'insufficient_privilege';
  end if;
  select id into v_almacen from public.cajas where empresa_id = p_empresa and tipo_caja = 'almacen' and estado = 'abierta';
  if v_almacen is null then
    raise exception 'Primero abre la Caja de Almacén.' using errcode = 'check_violation';
  end if;
  if p_origen = 'recepcion' then
    select id into v_recepcion from public.cajas where empresa_id = p_empresa and tipo_caja = 'recepcion' and estado = 'abierta';
    if v_recepcion is null then
      raise exception 'La Caja de Recepción está cerrada: ábrela o registra el dinero como «fuera de las cajas».' using errcode = 'check_violation';
    end if;
  end if;

  v_clase := case p_tipo when 'asignacion' then 'asignacion_fondo' else 'devolucion_fondo' end;
  v_texto := case p_tipo when 'asignacion' then 'Fondo para Almacén' else 'Vuelto de Almacén' end
             || coalesce(' · ' || nullif(btrim(p_nota), ''), '');

  -- Lado de Almacén: entra el fondo o sale el vuelto.
  insert into public.movimientos_caja (empresa_id, caja_id, tipo, concepto, monto, medio, clase, transferencia_id, entregado_por, recibido_por)
  values (p_empresa, v_almacen, case p_tipo when 'asignacion' then 'ingreso' else 'egreso' end, left(v_texto, 200), round(p_monto, 2), 'efectivo',
          v_clase, v_id, p_entregado_por, p_recibido_por);
  -- Lado de Recepción (si el dinero sale de ahí o vuelve ahí).
  if v_recepcion is not null then
    insert into public.movimientos_caja (empresa_id, caja_id, tipo, concepto, monto, medio, clase, transferencia_id, entregado_por, recibido_por)
    values (p_empresa, v_recepcion, case p_tipo when 'asignacion' then 'egreso' else 'ingreso' end, left(v_texto, 200), round(p_monto, 2), 'efectivo',
            v_clase, v_id, p_entregado_por, p_recibido_por);
  end if;
  return v_id;
end;
$$;
revoke all on function public.mover_fondo_almacen(uuid, text, numeric, text, uuid, uuid, text) from public, anon;
grant execute on function public.mover_fondo_almacen(uuid, text, numeric, text, uuid, uuid, text) to authenticated;

-- Anular un lado del traspaso anula el otro (nunca queda la plata en el aire).
create function privado.anular_traspaso() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.transferencia_id is not null and new.estado = 'anulado' and old.estado <> 'anulado'
     and coalesce(current_setting('taller.anulando_traspaso', true), '') <> 'si' then
    perform set_config('taller.anulando_traspaso', 'si', true);
    update public.movimientos_caja set estado = 'anulado', motivo_anulacion = new.motivo_anulacion
     where transferencia_id = new.transferencia_id and id <> new.id and estado <> 'anulado';
    perform set_config('taller.anulando_traspaso', '', true);
  end if;
  return null;
end;
$$;
create trigger movimientos_anular_traspaso after update of estado on public.movimientos_caja
  for each row execute function privado.anular_traspaso();

-- El cálculo de cada caja y la Caja Maestra separan el fondo (no es gasto ni retiro).
alter table public.caja_maestra_diaria add column fondo_almacen numeric(12, 2) not null default 0;

create or replace function privado.calcular_caja(p_caja uuid, out resumen jsonb, out esperado numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with pagos as (
    select medio, sum(case when tipo = 'devolucion' then -monto else monto end) neto, count(*) cuantos
    from public.pagos where caja_id = p_caja and estado = 'confirmado' group by medio
  ), movs as (
    select medio,
           sum(case when tipo = 'ingreso' then monto else 0 end) ingresos,
           sum(case when tipo = 'egreso' then monto else 0 end) egresos,
           sum(case when tipo = 'egreso' and categoria_gasto is not null then monto else 0 end) gastos,
           sum(case when tipo = 'egreso' and compra_id is not null then monto else 0 end) compras,
           sum(case when clase <> 'normal' and tipo = 'ingreso' then monto else 0 end) fondo_entra,
           sum(case when clase <> 'normal' and tipo = 'egreso' then monto else 0 end) fondo_sale
    from public.movimientos_caja where caja_id = p_caja and estado = 'confirmado' group by medio
  ), medios as (
    select m.medio, coalesce(p.neto, 0) cobros, coalesce(p.cuantos, 0) cuantos, coalesce(v.ingresos, 0) ingresos,
           coalesce(v.egresos, 0) egresos, coalesce(v.gastos, 0) gastos, coalesce(v.compras, 0) compras,
           coalesce(v.fondo_entra, 0) fondo_entra, coalesce(v.fondo_sale, 0) fondo_sale
    from (values ('efectivo'), ('yape'), ('plin'), ('tarjeta'), ('transferencia')) m (medio)
    left join pagos p on p.medio = m.medio left join movs v on v.medio = m.medio
  )
  select jsonb_object_agg(medio, jsonb_build_object('cobros', cobros, 'pagos', cuantos, 'ingresos', ingresos, 'egresos', egresos, 'gastos', gastos, 'compras', compras, 'fondo_entra', fondo_entra, 'fondo_sale', fondo_sale)),
         (select monto_inicial from public.cajas where id = p_caja) + coalesce(sum(cobros + ingresos - egresos) filter (where medio = 'efectivo'), 0)
  from medios;
$$;

create or replace function privado.consolidar_dia(p_empresa uuid, p_fecha date, p_origen text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  with cajas as (
    select c.*,
           coalesce(c.efectivo_contado, c.efectivo_esperado) as efectivo_final,
           (select coalesce(sum((value ->> 'egresos')::numeric), 0) from jsonb_each(c.resumen)) egresos,
           (select coalesce(sum((value ->> 'gastos')::numeric), 0) from jsonb_each(c.resumen)) gastos,
           (select coalesce(sum((value ->> 'compras')::numeric), 0) from jsonb_each(c.resumen)) compras,
           (select coalesce(sum((value ->> 'fondo_sale')::numeric), 0) from jsonb_each(c.resumen)) fondo_sale,
           (select coalesce(sum((value ->> 'fondo_entra')::numeric), 0) from jsonb_each(c.resumen)) fondo_entra
    from public.cajas c
    where c.empresa_id = p_empresa and c.fecha = p_fecha and c.estado = 'cerrada'
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'tipo', tipo_caja, 'tipo_cierre', tipo_cierre, 'abierta_en', abierta_en, 'cerrada_en', cerrada_en,
      'abierta_por', abierta_por, 'cerrada_por', cerrada_por, 'monto_inicial', monto_inicial,
      'esperado', efectivo_esperado, 'contado', efectivo_contado, 'diferencia', diferencia,
      'requiere_arqueo', requiere_arqueo, 'medios', resumen) order by tipo_caja desc, abierta_en), '[]'::jsonb) detalle,
    coalesce(sum(efectivo_esperado), 0) esperado,
    coalesce(sum(efectivo_final), 0) neto,
    coalesce(sum(diferencia) filter (where efectivo_contado is not null), 0) diferencia,
    coalesce(sum(((resumen -> 'yape' ->> 'cobros')::numeric + (resumen -> 'yape' ->> 'ingresos')::numeric - (resumen -> 'yape' ->> 'egresos')::numeric)
               + ((resumen -> 'plin' ->> 'cobros')::numeric + (resumen -> 'plin' ->> 'ingresos')::numeric - (resumen -> 'plin' ->> 'egresos')::numeric)), 0) yape_plin,
    coalesce(sum((resumen -> 'tarjeta' ->> 'cobros')::numeric + (resumen -> 'tarjeta' ->> 'ingresos')::numeric - (resumen -> 'tarjeta' ->> 'egresos')::numeric), 0) tarjeta,
    coalesce(sum((resumen -> 'transferencia' ->> 'cobros')::numeric + (resumen -> 'transferencia' ->> 'ingresos')::numeric - (resumen -> 'transferencia' ->> 'egresos')::numeric), 0) transferencia,
    coalesce(sum((select sum((value ->> 'cobros')::numeric) from jsonb_each(resumen))), 0) cobrado,
    coalesce(sum(gastos), 0) gastos,
    coalesce(sum(compras), 0) compras,
    coalesce(sum(egresos - gastos - compras - fondo_sale), 0) otros,
    -- Fondo de Almacén: lo que recibió menos el vuelto que devolvió (no es gasto).
    coalesce(sum(fondo_entra - fondo_sale) filter (where tipo_caja = 'almacen'), 0) fondo,
    count(*) filter (where tipo_cierre = 'automatico_00h') automaticos,
    coalesce(bool_or(requiere_arqueo), false) arqueo,
    count(*) cuantas
  into v
  from cajas;

  if v.cuantas = 0 then
    return;
  end if;
  insert into public.caja_maestra_diaria as m (
    empresa_id, fecha, cajas, efectivo_esperado, efectivo_neto, diferencia, yape_plin, tarjeta, transferencia, cobrado,
    egresos_gastos, egresos_compras, egresos_otros, fondo_almacen, cierres_automaticos, requiere_arqueo, generada_en, generada_por)
  values (p_empresa, p_fecha, v.detalle, v.esperado, v.neto, v.diferencia, v.yape_plin, v.tarjeta, v.transferencia, v.cobrado,
          v.gastos, v.compras, v.otros, v.fondo, v.automaticos, v.arqueo, now(), p_origen)
  on conflict (empresa_id, fecha) do update set
    cajas = excluded.cajas, efectivo_esperado = excluded.efectivo_esperado, efectivo_neto = excluded.efectivo_neto,
    diferencia = excluded.diferencia, yape_plin = excluded.yape_plin, tarjeta = excluded.tarjeta,
    transferencia = excluded.transferencia, cobrado = excluded.cobrado, egresos_gastos = excluded.egresos_gastos,
    egresos_compras = excluded.egresos_compras, egresos_otros = excluded.egresos_otros, fondo_almacen = excluded.fondo_almacen,
    cierres_automaticos = excluded.cierres_automaticos, requiere_arqueo = excluded.requiere_arqueo,
    generada_en = excluded.generada_en, generada_por = excluded.generada_por;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Comprobante: tipo, número y «pendiente»
-- ---------------------------------------------------------------------
-- Compras: se suman «recibo» y «otro», y el número puede quedar para después.
alter table public.compras drop constraint compras_tipo_comprobante_check;
alter table public.compras add constraint compras_tipo_comprobante_check
  check (tipo_comprobante in ('factura', 'boleta', 'recibo', 'nota_venta', 'ticket', 'otro', 'sin_comprobante'));
alter table public.compras add column comprobante_pendiente boolean generated always as
  (tipo_comprobante in ('factura', 'boleta', 'recibo', 'nota_venta', 'ticket') and nullif(btrim(coalesce(numero, '')), '') is null) stored;

-- Gastos: tipo de comprobante (el número va en «comprobante», como antes).
alter table public.gastos add column tipo_comprobante text not null default 'sin_comprobante'
  check (tipo_comprobante in ('factura', 'boleta', 'recibo', 'otro', 'sin_comprobante'));
alter table public.gastos disable trigger gastos_proteger;
alter table public.gastos disable trigger gastos_solo_desde_origen;
alter table public.gastos disable trigger gastos_auditar;
update public.gastos set tipo_comprobante = 'otro' where comprobante is not null;
alter table public.gastos enable trigger gastos_proteger;
alter table public.gastos enable trigger gastos_solo_desde_origen;
alter table public.gastos enable trigger gastos_auditar;
alter table public.gastos add column comprobante_pendiente boolean generated always as
  (tipo_comprobante in ('factura', 'boleta', 'recibo') and nullif(btrim(coalesce(comprobante, '')), '') is null) stored;
create index gastos_pendientes on public.gastos (empresa_id) where comprobante_pendiente and estado <> 'anulado';
create index compras_pendientes on public.compras (empresa_id) where comprobante_pendiente and estado <> 'anulado';

-- Salidas de caja que son gasto: su comprobante pasa al gasto (la traza queda completa).
alter table public.movimientos_caja
  add column tipo_comprobante text check (tipo_comprobante is null or tipo_comprobante in ('factura', 'boleta', 'recibo', 'otro', 'sin_comprobante')),
  add column numero_comprobante text check (numero_comprobante is null or char_length(numero_comprobante) <= 40);

create or replace function privado.gasto_desde_caja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'egreso' and new.categoria_gasto is not null then
      insert into public.gastos (empresa_id, fecha, categoria, descripcion, monto, medio, movimiento_caja_id, tipo_comprobante, comprobante)
      values (new.empresa_id, (new.creado_en at time zone 'America/Lima')::date, new.categoria_gasto, left(new.concepto, 200), new.monto, new.medio, new.id,
              coalesce(new.tipo_comprobante, 'sin_comprobante'), nullif(btrim(coalesce(new.numero_comprobante, '')), ''));
    end if;
  elsif new.estado = 'anulado' and old.estado <> 'anulado' then
    update public.gastos
       set estado = 'anulado', motivo_anulacion = left('Anulado en la caja: ' || coalesce(new.motivo_anulacion, ''), 500)
     where movimiento_caja_id = new.id and estado <> 'anulado';
  end if;
  return null;
end;
$$;

-- Un registro confirmado con dinero no se edita... salvo completar su comprobante pendiente.
create or replace function privado.proteger_dinero() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_libres text[] := array['actualizado_en', 'actualizado_por', 'orden_id'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Los registros con dinero no se borran: se anulan con motivo.' using errcode = 'insufficient_privilege';
  end if;
  if old.estado = 'anulado' then
    raise exception 'Este registro está anulado y ya no se puede cambiar.' using errcode = 'check_violation';
  end if;
  -- Con el comprobante pendiente, se puede completar su número (y su tipo); nada más.
  if coalesce((to_jsonb(old) ->> 'comprobante_pendiente')::boolean, false) then
    v_libres := v_libres || array['serie', 'numero', 'comprobante', 'tipo_comprobante', 'comprobante_pendiente'];
  end if;
  if old.estado = 'confirmado' and new.estado = 'confirmado'
     and (to_jsonb(new) - v_libres) is distinct from (to_jsonb(old) - v_libres) then
    raise exception 'Un registro confirmado no se edita: anúlalo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  if new.estado = 'anulado' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 5 then
      raise exception 'Para anular escribe el motivo.' using errcode = 'check_violation';
    end if;
    new.anulado_en := now();
    new.anulado_por := auth.uid();
  end if;
  if new.estado = 'confirmado' and old.estado = 'por_confirmar' then
    new.confirmado_en := now();
    new.confirmado_por := auth.uid();
  end if;
  return new;
end;
$$;
