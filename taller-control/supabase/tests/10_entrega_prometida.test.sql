-- Hora de entrega prometida: quién la pone, nota en la orden, reprogramaciones y avisos.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000b1', 'Taller Entregas');
insert into auth.users (id, email, raw_app_meta_data) values
  ('81000000-0000-0000-0000-000000000001', 'ea@prueba.invalid', '{"nombre":"Asesor E","celular":"+51955500501"}'),
  ('81000000-0000-0000-0000-000000000002', 'et@prueba.invalid', '{"nombre":"Tecnico E","celular":"+51955500502"}'),
  ('81000000-0000-0000-0000-000000000003', 'er@prueba.invalid', '{"nombre":"Recepcion E","celular":"+51955500503"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-000000000001', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-000000000002', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-000000000003', 'recepcion');
insert into clientes (id, empresa_id, nombre, celular) values ('c1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'Cliente E', '+51966600051');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'ENT123', 'c1000000-0000-0000-0000-0000000000b1');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('81000000-0000-0000-0000-000000000001');
select lives_ok($$
  insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id, entrega_prometida, entrega_reprogramada)
  values ('f1000000-0000-0000-0000-0000000000b1', 'a0000000-0000-0000-0000-0000000000b1', 'd1000000-0000-0000-0000-0000000000b1',
          'c1000000-0000-0000-0000-0000000000b1', '81000000-0000-0000-0000-000000000002', '2026-11-20 23:00:00+00', 7)
$$, 'El asesor abre la orden con la hora prometida');
select is((select entrega_reprogramada from ordenes_trabajo where id = 'f1000000-0000-0000-0000-0000000000b1'), 0, 'Las reprogramaciones empiezan en cero aunque se mande otro número');
select is((select count(*)::int from orden_avances where orden_id = 'f1000000-0000-0000-0000-0000000000b1'), 0, 'Al abrir la orden no se agrega nota');

-- Desde ahora la reprograman recepción, gerencia o administración (no el asesor).
select throws_ok($$ update ordenes_trabajo set entrega_prometida = '2026-11-21 15:30:00+00' where id = 'f1000000-0000-0000-0000-0000000000b1' $$, '42501', null, 'El asesor ya no reprograma la hora');
select pg_temp.como('81000000-0000-0000-0000-000000000003');
select cambiar_hora_prometida('f1000000-0000-0000-0000-0000000000b1', '2026-11-21 15:30:00+00');
select pg_temp.como('81000000-0000-0000-0000-000000000001');
select is((select entrega_reprogramada from ordenes_trabajo where id = 'f1000000-0000-0000-0000-0000000000b1'), 1, 'Cambiar la hora cuenta una reprogramación');
select is(
  (select texto from orden_avances where orden_id = 'f1000000-0000-0000-0000-0000000000b1' order by creado_en desc limit 1),
  'Nueva hora de entrega prometida: 21/11 a las 10:30 a. m. (antes: 20/11 a las 6:00 p. m.).',
  'El cambio queda anotado en la orden, en hora de Lima'
);
select is(
  (select autor_id from orden_avances where orden_id = 'f1000000-0000-0000-0000-0000000000b1' limit 1),
  '81000000-0000-0000-0000-000000000003'::uuid,
  'La nota queda a nombre de quien la cambió'
);
update ordenes_trabajo set entrega_reprogramada = 0 where id = 'f1000000-0000-0000-0000-0000000000b1';
select is((select entrega_reprogramada from ordenes_trabajo where id = 'f1000000-0000-0000-0000-0000000000b1'), 1, 'La cuenta de reprogramaciones no se borra a mano');

-- El técnico ve la hora, pero no la cambia
select pg_temp.como('81000000-0000-0000-0000-000000000002');
select is((select entrega_prometida from ordenes_trabajo where id = 'f1000000-0000-0000-0000-0000000000b1'), '2026-11-21 15:30:00+00'::timestamptz, 'El técnico ve la hora prometida de su orden');
update ordenes_trabajo set entrega_prometida = '2026-12-30 15:30:00+00' where id = 'f1000000-0000-0000-0000-0000000000b1';
select pg_temp.como('81000000-0000-0000-0000-000000000001');
select is((select entrega_prometida from ordenes_trabajo where id = 'f1000000-0000-0000-0000-0000000000b1'), '2026-11-21 15:30:00+00'::timestamptz, 'El técnico no puede cambiar la hora prometida');

-- Avisos nuevos en la configuración
reset role;
select lives_ok($$ insert into config_avisos (empresa_id, tipo, canal) values ('a0000000-0000-0000-0000-0000000000b1', 'entrega_atrasada', 'ambos') $$, 'Se puede elegir el canal del aviso de entrega atrasada');
select is((select minutos_aviso_entrega from configuracion_empresa where empresa_id = 'a0000000-0000-0000-0000-0000000000b1'), 120, 'Por defecto se avisa 2 horas antes');

select * from finish();
rollback;
