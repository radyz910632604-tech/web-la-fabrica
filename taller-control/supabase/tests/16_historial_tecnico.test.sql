-- Cambiar de técnico deja constancia en la orden.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(5);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000b8', 'Taller Tecnicos');
insert into auth.users (id, email, raw_app_meta_data) values
  ('87000000-0000-0000-0000-000000000001', 'tg@prueba.invalid', '{"nombre":"Gerencia T","celular":"+51955501101"}'),
  ('87000000-0000-0000-0000-000000000002', 'tl@prueba.invalid', '{"nombre":"Luis","celular":"+51955501102"}'),
  ('87000000-0000-0000-0000-000000000003', 'tm@prueba.invalid', '{"nombre":"Mario","celular":"+51955501103"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000b8', '87000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000b8', '87000000-0000-0000-0000-000000000002', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000b8', '87000000-0000-0000-0000-000000000003', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('c8000000-0000-0000-0000-0000000000b8', 'a0000000-0000-0000-0000-0000000000b8', 'Cliente T', '+51966600111');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d8000000-0000-0000-0000-0000000000b8', 'a0000000-0000-0000-0000-0000000000b8', 'TEC123', 'c8000000-0000-0000-0000-0000000000b8');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values ('f8000000-0000-0000-0000-0000000000b8', 'a0000000-0000-0000-0000-0000000000b8', 'd8000000-0000-0000-0000-0000000000b8', 'c8000000-0000-0000-0000-0000000000b8');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
select pg_temp.como('87000000-0000-0000-0000-000000000001');
update ordenes_trabajo set tecnico_id = '87000000-0000-0000-0000-000000000002' where id = 'f8000000-0000-0000-0000-0000000000b8';
update ordenes_trabajo set tecnico_id = '87000000-0000-0000-0000-000000000003' where id = 'f8000000-0000-0000-0000-0000000000b8';
update ordenes_trabajo set observaciones_ingreso = 'Sin cambio de técnico' where id = 'f8000000-0000-0000-0000-0000000000b8';
reset role;
select is((select count(*)::int from orden_avances where orden_id = 'f8000000-0000-0000-0000-0000000000b8'), 2, 'Dos cambios de técnico, dos registros (otros cambios no cuentan)');
select ok(exists (select 1 from orden_avances where orden_id = 'f8000000-0000-0000-0000-0000000000b8' and texto = 'Técnico asignado: Luis'), 'Queda «Técnico asignado: Luis»');
select ok(exists (select 1 from orden_avances where orden_id = 'f8000000-0000-0000-0000-0000000000b8' and texto = 'Técnico: Luis → Mario'), 'Queda «Técnico: Luis → Mario»');
select is((select autor_id from orden_avances where orden_id = 'f8000000-0000-0000-0000-0000000000b8' and texto = 'Técnico: Luis → Mario'), '87000000-0000-0000-0000-000000000001'::uuid, 'Con quién hizo el cambio');
select isnt((select tecnico_asignado_en from ordenes_trabajo where id = 'f8000000-0000-0000-0000-0000000000b8'), null, 'Queda desde cuándo lo tiene el técnico actual');
select * from finish();
