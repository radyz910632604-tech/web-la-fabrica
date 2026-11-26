-- Cajas por área (Recepción y Almacén), cierre automático a medianoche y Caja Maestra del día.
-- - Cada área abre y cierra su caja con su conteo (sobrante o faltante propio).
-- - A las 00:00 (hora de Lima) el reloj de la app cierra lo que quedó abierto con el saldo
--   del sistema, marca «arqueo pendiente» y arma la Caja Maestra del día anterior.
-- - La Caja Maestra solo la ven gerencia y administración.

-- ---------------------------------------------------------------------
-- 1. Cajas: área, día, tipo de cierre y arqueo pendiente
-- ---------------------------------------------------------------------
alter table public.cajas
  add column tipo_caja text not null default 'recepcion' check (tipo_caja in ('recepcion', 'almacen')),
  add column fecha date,
  add column tipo_cierre text check (tipo_cierre is null or tipo_cierre in ('manual', 'automatico_00h')),
  add column requiere_arqueo boolean not null default false,
  add column arqueo_por uuid references public.perfiles (id),
  add column arqueo_en timestamptz;
-- Relleno de las cajas que ya existen (la regla «cerrada no cambia» se pausa solo para esto).
alter table public.cajas disable trigger cajas_proteger;
alter table public.cajas disable trigger cajas_auditar;
update public.cajas set fecha = (abierta_en at time zone 'America/Lima')::date where fecha is null;
update public.cajas set tipo_cierre = 'manual' where estado = 'cerrada' and tipo_cierre is null;
alter table public.cajas enable trigger cajas_proteger;
alter table public.cajas enable trigger cajas_auditar;
alter table public.cajas alter column fecha set not null;
alter table public.cajas alter column fecha set default (now() at time zone 'America/Lima')::date;

-- Una caja abierta por área (antes: una por taller).
drop index public.cajas_una_abierta;
create unique index cajas_una_abierta_por_area on public.cajas (empresa_id, tipo_caja) where estado = 'abierta';
create index cajas_por_dia on public.cajas (empresa_id, fecha);

-- Quién maneja cada caja: Recepción (los de caja) y Almacén (almacén); gerencia y administración, ambas.
create function privado.ve_caja_de(p_empresa uuid, p_tipo text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_tipo
    when 'almacen' then privado.tiene_rol(p_empresa, array['gerencia', 'administrador', 'almacen']::public.rol_t[])
    else privado.ve_caja(p_empresa)
  end;
$$;
create function privado.ve_caja_id(p_caja uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.cajas c where c.id = p_caja and privado.ve_caja_de(c.empresa_id, c.tipo_caja));
$$;
revoke all on function privado.ve_caja_de(uuid, text) from public, anon;
revoke all on function privado.ve_caja_id(uuid) from public, anon;
grant execute on function privado.ve_caja_de(uuid, text) to authenticated, service_role;
grant execute on function privado.ve_caja_id(uuid) to authenticated, service_role;

drop policy "cajas: ver" on public.cajas;
drop policy "cajas: abrir" on public.cajas;
drop policy "cajas: cerrar" on public.cajas;
create policy "cajas: ver" on public.cajas for select to authenticated using (privado.ve_caja_de(empresa_id, tipo_caja));
create policy "cajas: abrir" on public.cajas for insert to authenticated with check (privado.ve_caja_de(empresa_id, tipo_caja));
create policy "cajas: cerrar" on public.cajas for update to authenticated using (privado.ve_caja_de(empresa_id, tipo_caja)) with check (privado.ve_caja_de(empresa_id, tipo_caja));
drop policy "movimientos: ver" on public.movimientos_caja;
drop policy "movimientos: crear" on public.movimientos_caja;
drop policy "movimientos: anular" on public.movimientos_caja;
create policy "movimientos: ver" on public.movimientos_caja for select to authenticated using (privado.ve_caja_id(caja_id));
create policy "movimientos: crear" on public.movimientos_caja for insert to authenticated with check (privado.ve_caja_id(caja_id));
create policy "movimientos: anular" on public.movimientos_caja for update to authenticated using (privado.ve_caja_id(caja_id)) with check (privado.ve_caja_id(caja_id));

-- Los cobros a clientes entran a la caja de Recepción (los de WhatsApp, al confirmarse).
create or replace function privado.pago_a_caja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_estado text;
begin
  if tg_op = 'INSERT' then
    new.caja_id := case when new.estado = 'confirmado' and new.origen <> 'whatsapp'
                        then (select id from public.cajas where empresa_id = new.empresa_id and tipo_caja = 'recepcion' and estado = 'abierta') end;
  elsif new.caja_id is distinct from old.caja_id then
    raise exception 'El pago no cambia de caja.' using errcode = 'check_violation';
  elsif old.estado = 'por_confirmar' and new.estado = 'confirmado' then
    new.caja_id := (select id from public.cajas where empresa_id = new.empresa_id and tipo_caja = 'recepcion' and estado = 'abierta');
  elsif old.caja_id is not null and new.estado = 'anulado' and old.estado <> 'anulado' then
    select estado into v_estado from public.cajas where id = old.caja_id;
    if v_estado = 'cerrada' then
      raise exception 'Este pago es de una caja ya cerrada: registra una devolución en la caja de hoy.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Apertura, cierre (manual con conteo o automático sin él) y arqueo posterior del dueño.
create or replace function privado.proteger_caja() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una caja no se borra.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'abierta' then
      raise exception 'Una caja se abre y después se cierra.' using errcode = 'check_violation';
    end if;
    new.abierta_por := coalesce(auth.uid(), new.abierta_por);
    new.abierta_en := now();
    new.fecha := (now() at time zone 'America/Lima')::date;
    new.tipo_cierre := null;
    new.requiere_arqueo := false;
    return new;
  end if;
  if old.estado = 'cerrada' then
    -- Lo único que cambia en una caja cerrada: el arqueo que hace el dueño después del cierre automático.
    if coalesce(current_setting('taller.arqueo_caja', true), '') = 'si' and old.requiere_arqueo
       and new.estado = 'cerrada' and new.efectivo_esperado = old.efectivo_esperado and new.resumen = old.resumen then
      return new;
    end if;
    raise exception 'Esta caja ya está cerrada.' using errcode = 'check_violation';
  end if;
  if new.monto_inicial <> old.monto_inicial or new.abierta_en <> old.abierta_en or new.abierta_por is distinct from old.abierta_por
     or new.tipo_caja <> old.tipo_caja or new.fecha <> old.fecha then
    raise exception 'La apertura de la caja no se cambia.' using errcode = 'check_violation';
  end if;
  if new.estado = 'cerrada' then
    if coalesce(new.tipo_cierre, 'manual') = 'manual' and new.efectivo_contado is null then
      raise exception 'Para cerrar la caja cuenta el efectivo.' using errcode = 'check_violation';
    end if;
    new.tipo_cierre := coalesce(new.tipo_cierre, 'manual');
    new.cerrada_por := auth.uid();
    new.cerrada_en := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Salidas de caja que pagan una compra (repuesto para una orden)
-- ---------------------------------------------------------------------
-- Una compra ya es costo: su salida de caja no crea gasto (si no, se contaría dos veces).
alter table public.movimientos_caja
  add column compra_id uuid unique references public.compras (id),
  add constraint movimientos_compra_sin_gasto check (compra_id is null or (tipo = 'egreso' and categoria_gasto is null));

-- ---------------------------------------------------------------------
-- 3. Cálculo de una caja (lo usan el cierre manual, el automático y la Caja Maestra)
-- ---------------------------------------------------------------------
create function privado.calcular_caja(p_caja uuid, out resumen jsonb, out esperado numeric)
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
           sum(case when tipo = 'egreso' and compra_id is not null then monto else 0 end) compras
    from public.movimientos_caja where caja_id = p_caja and estado = 'confirmado' group by medio
  ), medios as (
    select m.medio, coalesce(p.neto, 0) cobros, coalesce(p.cuantos, 0) cuantos, coalesce(v.ingresos, 0) ingresos,
           coalesce(v.egresos, 0) egresos, coalesce(v.gastos, 0) gastos, coalesce(v.compras, 0) compras
    from (values ('efectivo'), ('yape'), ('plin'), ('tarjeta'), ('transferencia')) m (medio)
    left join pagos p on p.medio = m.medio left join movs v on v.medio = m.medio
  )
  select jsonb_object_agg(medio, jsonb_build_object('cobros', cobros, 'pagos', cuantos, 'ingresos', ingresos, 'egresos', egresos, 'gastos', gastos, 'compras', compras)),
         (select monto_inicial from public.cajas where id = p_caja) + coalesce(sum(cobros + ingresos - egresos) filter (where medio = 'efectivo'), 0)
  from medios;
$$;
revoke all on function privado.calcular_caja(uuid) from public, anon;
grant execute on function privado.calcular_caja(uuid) to authenticated, service_role;

create or replace function public.cerrar_caja(p_caja uuid, p_contado numeric, p_observaciones text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_calc record;
begin
  select * into v_caja from public.cajas where id = p_caja;
  if not found then
    raise exception 'No se encontró la caja.' using errcode = 'no_data_found';
  end if;
  if v_caja.estado <> 'abierta' then
    raise exception 'Esta caja ya está cerrada.' using errcode = 'check_violation';
  end if;
  select * into v_calc from privado.calcular_caja(p_caja);
  update public.cajas set
    estado = 'cerrada', tipo_cierre = 'manual',
    efectivo_esperado = v_calc.esperado, efectivo_contado = p_contado,
    diferencia = round(p_contado - v_calc.esperado, 2), resumen = v_calc.resumen,
    observaciones = nullif(btrim(coalesce(p_observaciones, '')), '')
  where id = p_caja;
  return jsonb_build_object('esperado', v_calc.esperado, 'contado', p_contado, 'diferencia', round(p_contado - v_calc.esperado, 2), 'medios', v_calc.resumen);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Caja Maestra del día
-- ---------------------------------------------------------------------
create table public.caja_maestra_diaria (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  fecha date not null,
  cajas jsonb not null default '[]'::jsonb,               -- desglose de cada caja del día
  efectivo_esperado numeric(12, 2) not null default 0,
  efectivo_neto numeric(12, 2) not null default 0,        -- contado (o esperado si falta el arqueo)
  diferencia numeric(12, 2) not null default 0,           -- de los cierres con conteo
  yape_plin numeric(12, 2) not null default 0,
  tarjeta numeric(12, 2) not null default 0,
  transferencia numeric(12, 2) not null default 0,
  cobrado numeric(12, 2) not null default 0,              -- cobros a clientes, todos los medios
  egresos_gastos numeric(12, 2) not null default 0,       -- ya están en Gastos (1 a 1)
  egresos_compras numeric(12, 2) not null default 0,      -- compras de repuestos (costo, no gasto)
  egresos_otros numeric(12, 2) not null default 0,        -- retiros y otras salidas
  cierres_automaticos integer not null default 0,
  requiere_arqueo boolean not null default false,
  generada_en timestamptz not null default now(),
  generada_por text not null default 'automatico_00h' check (generada_por in ('automatico_00h', 'arqueo', 'manual')),
  unique (empresa_id, fecha)
);
alter table public.caja_maestra_diaria enable row level security;
revoke all on public.caja_maestra_diaria from anon, authenticated;
grant select on public.caja_maestra_diaria to authenticated;
create policy "caja maestra: ver" on public.caja_maestra_diaria for select to authenticated using (privado.es_gestor(empresa_id));

-- Arma (o rehace) la Caja Maestra de un día con las cajas cerradas de ese día.
create function privado.consolidar_dia(p_empresa uuid, p_fecha date, p_origen text) returns void
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
           (select coalesce(sum((value ->> 'compras')::numeric), 0) from jsonb_each(c.resumen)) compras
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
    coalesce(sum(egresos - gastos - compras), 0) otros,
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
    egresos_gastos, egresos_compras, egresos_otros, cierres_automaticos, requiere_arqueo, generada_en, generada_por)
  values (p_empresa, p_fecha, v.detalle, v.esperado, v.neto, v.diferencia, v.yape_plin, v.tarjeta, v.transferencia, v.cobrado,
          v.gastos, v.compras, v.otros, v.automaticos, v.arqueo, now(), p_origen)
  on conflict (empresa_id, fecha) do update set
    cajas = excluded.cajas, efectivo_esperado = excluded.efectivo_esperado, efectivo_neto = excluded.efectivo_neto,
    diferencia = excluded.diferencia, yape_plin = excluded.yape_plin, tarjeta = excluded.tarjeta,
    transferencia = excluded.transferencia, cobrado = excluded.cobrado, egresos_gastos = excluded.egresos_gastos,
    egresos_compras = excluded.egresos_compras, egresos_otros = excluded.egresos_otros,
    cierres_automaticos = excluded.cierres_automaticos, requiere_arqueo = excluded.requiere_arqueo,
    generada_en = excluded.generada_en, generada_por = excluded.generada_por;
end;
$$;
revoke all on function privado.consolidar_dia(uuid, date, text) from public, anon, authenticated;

-- El corte de medianoche (lo llama el reloj de la app con la llave de servicio, nunca una persona).
-- p_hoy = el día que empieza en Lima. Cierra lo que quedó abierto de días anteriores y consolida.
create function public.corte_medianoche(p_empresa uuid, p_hoy date) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caja record;
  v_calc record;
  v_cerradas integer := 0;
  v_dias date[] := array[p_hoy - 1];
  v_dia date;
begin
  for v_caja in select id, fecha from public.cajas where empresa_id = p_empresa and estado = 'abierta' and fecha < p_hoy for update loop
    select * into v_calc from privado.calcular_caja(v_caja.id);
    update public.cajas set
      estado = 'cerrada', tipo_cierre = 'automatico_00h', requiere_arqueo = true,
      efectivo_esperado = v_calc.esperado, efectivo_contado = null, diferencia = null, resumen = v_calc.resumen,
      observaciones = 'Cerrada automáticamente a las 00:00 con el saldo del sistema: falta el conteo.'
    where id = v_caja.id;
    v_cerradas := v_cerradas + 1;
    if not v_caja.fecha = any (v_dias) then v_dias := v_dias || v_caja.fecha; end if;
  end loop;
  foreach v_dia in array v_dias loop
    perform privado.consolidar_dia(p_empresa, v_dia, 'automatico_00h');
  end loop;
  return jsonb_build_object('cerradas', v_cerradas, 'dias', to_jsonb(v_dias));
end;
$$;
revoke all on function public.corte_medianoche(uuid, date) from public, anon, authenticated;
grant execute on function public.corte_medianoche(uuid, date) to service_role;

-- El dueño o administración cuentan después el efectivo de una caja cerrada automáticamente.
create function public.registrar_arqueo(p_caja uuid, p_contado numeric, p_observaciones text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caja public.cajas;
begin
  select * into v_caja from public.cajas where id = p_caja for update;
  if not found then
    raise exception 'No se encontró la caja.' using errcode = 'no_data_found';
  end if;
  if not privado.es_gestor(v_caja.empresa_id) then
    raise exception 'El arqueo pendiente lo registran gerencia o administración.' using errcode = 'insufficient_privilege';
  end if;
  if not v_caja.requiere_arqueo then
    raise exception 'Esta caja no tiene arqueo pendiente.' using errcode = 'check_violation';
  end if;
  if p_contado is null or p_contado < 0 then
    raise exception 'Escribe cuánto efectivo se contó.' using errcode = 'check_violation';
  end if;
  perform set_config('taller.arqueo_caja', 'si', true);
  update public.cajas set
    efectivo_contado = p_contado, diferencia = round(p_contado - v_caja.efectivo_esperado, 2),
    requiere_arqueo = false, arqueo_por = auth.uid(), arqueo_en = now(),
    observaciones = left(coalesce(observaciones || ' ', '') || coalesce('Arqueo: ' || nullif(btrim(p_observaciones), ''), ''), 1000)
  where id = p_caja;
  perform set_config('taller.arqueo_caja', '', true);
  perform privado.consolidar_dia(v_caja.empresa_id, v_caja.fecha, 'arqueo');
  return jsonb_build_object('esperado', v_caja.efectivo_esperado, 'contado', p_contado, 'diferencia', round(p_contado - v_caja.efectivo_esperado, 2));
end;
$$;
revoke all on function public.registrar_arqueo(uuid, numeric, text) from public, anon;
grant execute on function public.registrar_arqueo(uuid, numeric, text) to authenticated;

-- Si una caja de un día ya consolidado se cierra a mano, la Caja Maestra se rehace sola.
create function privado.reconsolidar_al_cerrar() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'cerrada' and old.estado = 'abierta' and new.tipo_cierre = 'manual'
     and exists (select 1 from public.caja_maestra_diaria where empresa_id = new.empresa_id and fecha = new.fecha) then
    perform privado.consolidar_dia(new.empresa_id, new.fecha, 'manual');
  end if;
  return null;
end;
$$;
create trigger cajas_reconsolidar after update of estado on public.cajas
  for each row execute function privado.reconsolidar_al_cerrar();
