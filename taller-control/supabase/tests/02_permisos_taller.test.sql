-- Pruebas del taller (Entrega 1B): clientes, vehículos, órdenes, citas y permisos por rol.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(28);

insert into empresas (id, nombre) values
  ('a0000000-0000-0000-0000-0000000000aa', 'Taller Prueba A'),
  ('b0000000-0000-0000-0000-0000000000bb', 'Taller Prueba B');

insert into auth.users (id, email, raw_app_meta_data) values
  ('10000000-0000-0000-0000-000000000001', 'tg@prueba.invalid', '{"nombre":"Gerencia","celular":"+51922222201"}'),
  ('10000000-0000-0000-0000-000000000002', 'ta@prueba.invalid', '{"nombre":"Asesor","celular":"+51922222202"}'),
  ('10000000-0000-0000-0000-000000000003', 'tt@prueba.invalid', '{"nombre":"Tecnico Uno","celular":"+51922222203"}'),
  ('10000000-0000-0000-0000-000000000004', 'tt2@prueba.invalid', '{"nombre":"Tecnico Dos","celular":"+51922222204"}'),
  ('10000000-0000-0000-0000-000000000005', 'tal@prueba.invalid', '{"nombre":"Almacen","celular":"+51922222205"}'),
  ('10000000-0000-0000-0000-000000000006', 'tv@prueba.invalid', '{"nombre":"Vendedor","celular":"+51922222206"}'),
  ('10000000-0000-0000-0000-000000000007', 'tc@prueba.invalid', '{"nombre":"Confirmador","celular":"+51922222207"}'),
  ('10000000-0000-0000-0000-000000000008', 'tv2@prueba.invalid', '{"nombre":"Vendedor Dos","celular":"+51922222208"}');

insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000002', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000003', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000004', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000005', 'almacen'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000006', 'vendedor_redes'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000007', 'confirmador'),
  ('a0000000-0000-0000-0000-0000000000aa', '10000000-0000-0000-0000-000000000008', 'vendedor_redes'),
  ('b0000000-0000-0000-0000-0000000000bb', '10000000-0000-0000-0000-000000000001', 'gerencia');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.filas(q text) returns int language plpgsql as $$
declare n int;
begin execute q; get diagnostics n = row_count; return n; end;
$$;

-- Datos de partida (como sistema)
insert into clientes (id, empresa_id, nombre, celular, origen) values
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000aa', 'Cliente Uno', '+51933333301', 'redes'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000aa', 'Cliente Dos', '+51933333302', 'otro');
insert into vehiculos (id, empresa_id, placa, cliente_id) values
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000aa', 'ABC123', 'c0000000-0000-0000-0000-000000000001'),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000aa', 'XYZ789', 'c0000000-0000-0000-0000-000000000002');
insert into citas (id, empresa_id, nombre_cliente, celular, fecha_hora, servicio, red, vendedor_id) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000aa', 'Cliente Uno', '+51933333301', now(), 'Cambio de aceite', 'facebook', '10000000-0000-0000-0000-000000000006'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000aa', 'Otra Persona', '+51933333399', now() - interval '3 hours', 'Frenos', 'tiktok', '10000000-0000-0000-0000-000000000008'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000aa', 'Por Confirmar', '+51933333398', now() + interval '5 hours', 'GNV', 'instagram', '10000000-0000-0000-0000-000000000006');

-- ---------------------------------------------------------------
-- 1. El asesor registra un ingreso: número correlativo, cita unida, historial
-- ---------------------------------------------------------------
select pg_temp.como('10000000-0000-0000-0000-000000000002');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id, kilometraje_ingreso) values
  ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000aa', 'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 45000);
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id) values
  ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000aa', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ insert into vehiculos (empresa_id, placa) values ('a0000000-0000-0000-0000-0000000000aa', 'NEW111') returning id $$,
  'El asesor crea un carro y recibe su id de vuelta'
);
select lives_ok(
  $$ insert into ordenes_trabajo (empresa_id, vehiculo_id, cliente_id)
     select 'a0000000-0000-0000-0000-0000000000aa', id, 'c0000000-0000-0000-0000-000000000002' from vehiculos where placa = 'NEW111'
     returning id $$,
  'El asesor abre una orden y recibe su id de vuelta'
);
select results_eq(
  $$ select numero from ordenes_trabajo where numero <= 2 order by numero $$,
  array[1, 2],
  'Las órdenes se numeran solas, una tras otra'
);
select is(
  (select estado::text from citas where id = 'e0000000-0000-0000-0000-000000000001'),
  'llego',
  'La cita del mismo celular ese día se une sola y queda como "llegó"'
);
select is(
  (select cita_id from ordenes_trabajo where id = 'f0000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000001'::uuid,
  'La orden queda unida a su cita'
);
select is(
  (select count(*)::int from orden_estados_historial where orden_id = 'f0000000-0000-0000-0000-000000000001'),
  1,
  'El ingreso queda en el historial de estados'
);
select is(
  (select kilometraje_actual from vehiculos where id = 'd0000000-0000-0000-0000-000000000001'),
  45000,
  'El kilometraje del carro se actualiza con el ingreso'
);
reset role;

-- ---------------------------------------------------------------
-- 2. El técnico ve solo lo suyo y no ve clientes
-- ---------------------------------------------------------------
select pg_temp.como('10000000-0000-0000-0000-000000000003');
select results_eq(
  $$ select id from ordenes_trabajo $$,
  array['f0000000-0000-0000-0000-000000000001'::uuid],
  'El técnico solo ve las órdenes que tiene asignadas'
);
select is((select count(*)::int from clientes), 0, 'El técnico no ve clientes');
select results_eq($$ select placa from vehiculos $$, array['ABC123'], 'El técnico ve solo el carro de su orden');
select lives_ok(
  $$ select cambiar_estado_orden('f0000000-0000-0000-0000-000000000001', 'en_proceso', 'Bajé la caja') $$,
  'El técnico cambia el estado de su orden'
);
select is(
  (select nota from orden_estados_historial where orden_id = 'f0000000-0000-0000-0000-000000000001' and estado_nuevo = 'en_proceso'),
  'Bajé la caja',
  'La nota queda en el historial'
);
select throws_ok(
  $$ select cambiar_estado_orden('f0000000-0000-0000-0000-000000000001', 'entregado') $$,
  '42501', null,
  'El técnico no puede marcar la entrega al cliente'
);
select throws_ok(
  $$ select cambiar_estado_orden('f0000000-0000-0000-0000-000000000002', 'listo') $$,
  '42501', null,
  'El técnico no toca la orden de otro técnico'
);
select is(
  pg_temp.filas($q$ update ordenes_trabajo set observaciones_ingreso = 'x' $q$),
  0,
  'El técnico no edita la orden directamente'
);
select lives_ok(
  $$ insert into orden_avances (empresa_id, orden_id, texto) values
     ('a0000000-0000-0000-0000-0000000000aa', 'f0000000-0000-0000-0000-000000000001', 'Falta el kit de embrague') $$,
  'El técnico reporta un avance en su orden'
);
select throws_ok(
  $$ insert into orden_avances (empresa_id, orden_id, texto) values
     ('a0000000-0000-0000-0000-0000000000aa', 'f0000000-0000-0000-0000-000000000002', 'No es mía') $$,
  '42501', null,
  'El técnico no reporta avances en órdenes ajenas'
);
reset role;

-- ---------------------------------------------------------------
-- 3. Almacén, ventas por redes y confirmación
-- ---------------------------------------------------------------
select pg_temp.como('10000000-0000-0000-0000-000000000005');
select is((select count(*)::int from ordenes_trabajo), 3, 'Almacén ve las órdenes (para entregar repuestos)');
select is((select count(*)::int from clientes), 0, 'Almacén no ve clientes');
select throws_ok(
  $$ insert into ordenes_trabajo (empresa_id, vehiculo_id, cliente_id) values
     ('a0000000-0000-0000-0000-0000000000aa', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002') $$,
  '42501', null,
  'Almacén no registra ingresos'
);
reset role;

select pg_temp.como('10000000-0000-0000-0000-000000000006');
select is((select count(*)::int from citas), 2, 'Ventas por redes ve solo sus propias citas');
select results_eq(
  $$ select id from ordenes_trabajo $$,
  array['f0000000-0000-0000-0000-000000000001'::uuid],
  'Ventas por redes ve si su cliente llegó (la orden de su cita)'
);
select throws_ok(
  $$ insert into citas (empresa_id, nombre_cliente, celular, fecha_hora, servicio, red, vendedor_id) values
     ('a0000000-0000-0000-0000-0000000000aa', 'X Y', '+51933333390', now(), 'GNV', 'facebook', '10000000-0000-0000-0000-000000000008') $$,
  '42501', null,
  'Ventas por redes no agenda citas a nombre de otro vendedor'
);
reset role;

select pg_temp.como('10000000-0000-0000-0000-000000000007');
select lives_ok(
  $$ select confirmar_cita('e0000000-0000-0000-0000-000000000003') $$,
  'Confirmación marca una cita como confirmada'
);
select is(
  pg_temp.filas($q$ update citas set servicio = 'Otro' $q$),
  0,
  'Confirmación no cambia nada más de la cita'
);
select is(
  marcar_citas_no_llego('a0000000-0000-0000-0000-0000000000aa'),
  1,
  'La cita vencida sin ingreso queda como "no llegó"'
);
reset role;

-- ---------------------------------------------------------------
-- 4. Reingreso por garantía y otro taller
-- ---------------------------------------------------------------
select pg_temp.como('10000000-0000-0000-0000-000000000002');
insert into orden_servicios (empresa_id, orden_id, descripcion) values
  ('a0000000-0000-0000-0000-0000000000aa', 'f0000000-0000-0000-0000-000000000002', 'Cambio de pastillas de freno');
select cambiar_estado_orden('f0000000-0000-0000-0000-000000000002', 'entregado');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values
  ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000aa', 'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002');
insert into orden_servicios (empresa_id, orden_id, descripcion) values
  ('a0000000-0000-0000-0000-0000000000aa', 'f0000000-0000-0000-0000-000000000003', 'cambio de pastillas de freno');
select ok(
  (select es_reingreso_garantia from ordenes_trabajo where id = 'f0000000-0000-0000-0000-000000000003'),
  'El carro que vuelve por el mismo servicio dentro del plazo queda marcado como garantía'
);
reset role;

select pg_temp.como('10000000-0000-0000-0000-000000000001');
select set_config('prueba.b', 'b0000000-0000-0000-0000-0000000000bb', true);
select is(
  (select count(*)::int from ordenes_trabajo where empresa_id = current_setting('prueba.b')::uuid),
  0,
  'Las órdenes de un taller no aparecen en el otro'
);
reset role;

select * from finish();
rollback;
