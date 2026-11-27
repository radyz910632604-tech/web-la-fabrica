-- Hora prometida restringida y comisiones del asesor (solo gerencia y administración).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(17);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000d1', 'Taller Comisiones');
insert into auth.users (id, email, raw_app_meta_data) values
  ('8b000000-0000-0000-0000-000000000001', 'cg1@prueba.invalid', '{"nombre":"Dueño C","celular":"+51955504101"}'),
  ('8b000000-0000-0000-0000-000000000002', 'ca1@prueba.invalid', '{"nombre":"Admin C","celular":"+51955504102"}'),
  ('8b000000-0000-0000-0000-000000000003', 'cs1@prueba.invalid', '{"nombre":"Asesora C","celular":"+51955504103"}'),
  ('8b000000-0000-0000-0000-000000000004', 'cr1@prueba.invalid', '{"nombre":"Recepción C","celular":"+51955504104"}'),
  ('8b000000-0000-0000-0000-000000000005', 'ct1@prueba.invalid', '{"nombre":"Mecánico C","celular":"+51955504105"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000002', 'administrador'),
  ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000003', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000004', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000005', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('cb000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Cliente C', '+51966600411');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('db000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'COM123', 'cb000000-0000-0000-0000-0000000000d1');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- La asesora registra la orden: queda como su asesora.
select pg_temp.como('8b000000-0000-0000-0000-000000000003');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, entrega_prometida)
values ('fb000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'db000000-0000-0000-0000-0000000000d1', 'cb000000-0000-0000-0000-0000000000d1', now() + interval '3 hours');
reset role;
select is((select asesor_id from ordenes_trabajo where id = 'fb000000-0000-0000-0000-0000000000d1'), '8b000000-0000-0000-0000-000000000003'::uuid, 'Quien registra con rol asesor queda de asesor');

-- Hora prometida: la asesora y el mecánico no la cambian; recepción sí, y queda quién.
select pg_temp.como('8b000000-0000-0000-0000-000000000003');
select throws_ok($$ update ordenes_trabajo set entrega_prometida = now() + interval '5 hours' where id = 'fb000000-0000-0000-0000-0000000000d1' $$, '42501', null, 'La asesora no reprograma la hora');
select throws_ok($$ select cambiar_hora_prometida('fb000000-0000-0000-0000-0000000000d1', now()) $$, '42501', null, 'Tampoco con la función');
reset role;
select pg_temp.como('8b000000-0000-0000-0000-000000000004');
select cambiar_hora_prometida('fb000000-0000-0000-0000-0000000000d1', now() + interval '5 hours');
reset role;
select is((select entrega_cambiada_por from ordenes_trabajo where id = 'fb000000-0000-0000-0000-0000000000d1'), '8b000000-0000-0000-0000-000000000004'::uuid, 'Recepción la reprograma y queda quién');
select is((select entrega_reprogramada from ordenes_trabajo where id = 'fb000000-0000-0000-0000-0000000000d1'), 1, 'Y cuenta la reprogramación');

-- Comisiones: el administrador crea una para la asesora.
select pg_temp.como('8b000000-0000-0000-0000-000000000002');
insert into comisiones (id, empresa_id, perfil_id, orden_id, periodo, concepto, base, monto)
values ('eb000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-0000000000d1', date_trunc('month', now())::date, '5 % de la venta', 400, 20);
select throws_ok($$ insert into comisiones (empresa_id, perfil_id, periodo, concepto, monto) values ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000005', date_trunc('month', now())::date, 'Bono', 10) $$, '23514', null, 'El mecánico no recibe comisiones');
select throws_ok($$ insert into comisiones (empresa_id, perfil_id, orden_id, periodo, concepto, monto) values ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000003', 'fb000000-0000-0000-0000-0000000000d1', date_trunc('month', now())::date, 'Otra vez', 20) $$, '23505', null, 'La misma orden no comisiona dos veces');
reset role;

-- Nadie más las ve: ni la asesora, ni recepción.
select pg_temp.como('8b000000-0000-0000-0000-000000000003');
select is((select count(*)::int from comisiones), 0, 'La asesora no ve comisiones');
reset role;
select pg_temp.como('8b000000-0000-0000-0000-000000000004');
select is((select count(*)::int from comisiones), 0, 'Recepción no ve comisiones');
select throws_ok($$ insert into comisiones (empresa_id, perfil_id, periodo, concepto, monto) values ('a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000003', date_trunc('month', now())::date, 'Bono', 10) $$, '42501', null, 'Recepción no crea comisiones');
reset role;

-- El dueño la modifica, aprueba y paga: un solo gasto.
select pg_temp.como('8b000000-0000-0000-0000-000000000001');
update comisiones set monto = 25 where id = 'eb000000-0000-0000-0000-0000000000d1';
update comisiones set estado = 'aprobada' where id = 'eb000000-0000-0000-0000-0000000000d1';
select throws_ok($$ update comisiones set monto = 30 where id = 'eb000000-0000-0000-0000-0000000000d1' $$, '23514', null, 'Aprobada, el monto ya no cambia');
update comisiones set estado = 'pagada', medio = 'efectivo' where id = 'eb000000-0000-0000-0000-0000000000d1';
reset role;
select is((select count(*)::int from gastos where origen = 'comision' and origen_id = 'eb000000-0000-0000-0000-0000000000d1'), 1, 'Pagada: un solo gasto');
select is((select monto from gastos where origen_id = 'eb000000-0000-0000-0000-0000000000d1'), 25.00::numeric, 'Por el monto de la comisión');

-- Ese gasto no se anula desde Gastos; sí desde la comisión.
select pg_temp.como('8b000000-0000-0000-0000-000000000001');
select throws_ok($$ update gastos set estado = 'anulado', motivo_anulacion = 'Prueba de anular' where origen_id = 'eb000000-0000-0000-0000-0000000000d1' $$, '23514', null, 'El gasto de una comisión no se anula desde Gastos');
delete from comisiones where id = 'eb000000-0000-0000-0000-0000000000d1';
select is((select count(*)::int from comisiones where id = 'eb000000-0000-0000-0000-0000000000d1'), 1, 'Pagada no se elimina');
update comisiones set estado = 'anulada', motivo_anulacion = 'Se calculó mal' where id = 'eb000000-0000-0000-0000-0000000000d1';
reset role;
select is((select estado::text from gastos where origen_id = 'eb000000-0000-0000-0000-0000000000d1'), 'anulado', 'Anular la comisión anula su gasto');

-- Una pendiente sí se elimina.
select pg_temp.como('8b000000-0000-0000-0000-000000000002');
insert into comisiones (id, empresa_id, perfil_id, periodo, concepto, monto) values ('eb000000-0000-0000-0000-0000000000d2', 'a0000000-0000-0000-0000-0000000000d1', '8b000000-0000-0000-0000-000000000003', date_trunc('month', now())::date, 'Bono por meta', 50);
delete from comisiones where id = 'eb000000-0000-0000-0000-0000000000d2';
reset role;
select is((select count(*)::int from comisiones where id = 'eb000000-0000-0000-0000-0000000000d2'), 0, 'Una pendiente se elimina');
select * from finish();
rollback;
