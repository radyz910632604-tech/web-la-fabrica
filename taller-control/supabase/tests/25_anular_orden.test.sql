-- Anular una orden: con motivo, solo gestores, y nunca con dinero vigente.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f5', 'Taller Anula');
insert into auth.users (id, email, raw_app_meta_data) values
  ('91000000-0000-0000-0000-000000000001', 'na@prueba.invalid', '{"nombre":"Dueña N","celular":"+51955510101"}'),
  ('91000000-0000-0000-0000-000000000002', 'nr@prueba.invalid', '{"nombre":"Recepción N","celular":"+51955510102"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f5', '91000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000f5', '91000000-0000-0000-0000-000000000002', 'recepcion');
insert into clientes (id, empresa_id, nombre, celular) values ('c0f00000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-0000000000f5', 'Cliente N', '+51966600711');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d0f00000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-0000000000f5', 'ANU123', 'c0f00000-0000-0000-0000-0000000000f5');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values
  ('f0f00000-0000-0000-0000-0000000000f5', 'a0000000-0000-0000-0000-0000000000f5', 'd0f00000-0000-0000-0000-0000000000f5', 'c0f00000-0000-0000-0000-0000000000f5'),
  ('f0f00000-0000-0000-0000-0000000000f6', 'a0000000-0000-0000-0000-0000000000f5', 'd0f00000-0000-0000-0000-0000000000f5', 'c0f00000-0000-0000-0000-0000000000f5');
insert into pagos (empresa_id, orden_id, monto, tipo, medio) values ('a0000000-0000-0000-0000-0000000000f5', 'f0f00000-0000-0000-0000-0000000000f6', 50, 'adelanto', 'efectivo');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('91000000-0000-0000-0000-000000000002');
select throws_ok($$ select anular_orden('f0f00000-0000-0000-0000-0000000000f5', 'Se registró por error') $$, '42501', null, 'Recepción no anula órdenes');
reset role;
select pg_temp.como('91000000-0000-0000-0000-000000000001');
select throws_ok($$ select anular_orden('f0f00000-0000-0000-0000-0000000000f5', 'no') $$, '23514', null, 'Pide el motivo');
select throws_ok($$ select anular_orden('f0f00000-0000-0000-0000-0000000000f6', 'Se registró por error') $$, '23514', null, 'Con un pago vigente no se anula');
select lives_ok($$ select anular_orden('f0f00000-0000-0000-0000-0000000000f5', 'Se registró por error') $$, 'La dueña la anula con motivo');
reset role;
select ok((select anulada and anulada_por = '91000000-0000-0000-0000-000000000001' from ordenes_trabajo where id = 'f0f00000-0000-0000-0000-0000000000f5'), 'Queda anulada y quién la anuló');
select is((select count(*)::int from ordenes_trabajo where id = 'f0f00000-0000-0000-0000-0000000000f5'), 1, 'No se borra: sigue en la base');
select * from finish();
rollback;
