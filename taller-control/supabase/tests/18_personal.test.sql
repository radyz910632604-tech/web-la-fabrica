-- Personal: dueño protegido, baja sin borrar historial, reactivar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000c1', 'Taller Personal');
insert into auth.users (id, email, raw_app_meta_data) values
  ('8a000000-0000-0000-0000-000000000001', 'pd@prueba.invalid', '{"nombre":"Dueña P","celular":"+51955503101"}'),
  ('8a000000-0000-0000-0000-000000000002', 'pa@prueba.invalid', '{"nombre":"Admin P","celular":"+51955503102"}'),
  ('8a000000-0000-0000-0000-000000000003', 'pt@prueba.invalid', '{"nombre":"Técnico P","celular":"+51955503103"}'),
  ('8a000000-0000-0000-0000-000000000004', 'pg@prueba.invalid', '{"nombre":"Gerente P","celular":"+51955503104"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000002', 'administrador'),
  ('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000003', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000004', 'gerencia');
insert into clientes (id, empresa_id, nombre, celular) values ('ca000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'Cliente P', '+51966600311');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('da000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'PER123', 'ca000000-0000-0000-0000-0000000000c1');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id) values ('fa000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'da000000-0000-0000-0000-0000000000c1', 'ca000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000003');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select ok((select es_dueno from miembros where perfil_id = '8a000000-0000-0000-0000-000000000001'), 'La primera gerencia queda de dueña');
select ok(not (select es_dueno from miembros where perfil_id = '8a000000-0000-0000-0000-000000000004'), 'La segunda gerencia no es dueña');

-- Administración da de baja al técnico.
select pg_temp.como('8a000000-0000-0000-0000-000000000002');
select is(dar_de_baja('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000003', 'Renunció'), 1, 'Administración da de baja al técnico');
reset role;
select ok(not (select activo from miembros where perfil_id = '8a000000-0000-0000-0000-000000000003'), 'Queda sin acceso en el taller');
select is((select baja_motivo from miembros where perfil_id = '8a000000-0000-0000-0000-000000000003'), 'Renunció', 'Con el motivo');
select is((select tecnico_id from ordenes_trabajo where id = 'fa000000-0000-0000-0000-0000000000c1'), '8a000000-0000-0000-0000-000000000003'::uuid, 'Sus órdenes siguen a su nombre');

-- El técnico dado de baja ya no ve nada.
select pg_temp.como('8a000000-0000-0000-0000-000000000003');
select is((select count(*)::int from ordenes_trabajo), 0, 'Dado de baja, no ve órdenes');
reset role;

-- Administración no da de baja a gerencia; nadie da de baja a la dueña.
select pg_temp.como('8a000000-0000-0000-0000-000000000002');
select throws_ok($$ select dar_de_baja('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000004', 'Prueba') $$, '42501', null, 'Administración no da de baja a gerencia');
reset role;
select pg_temp.como('8a000000-0000-0000-0000-000000000004');
select throws_ok($$ select dar_de_baja('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000001', 'Prueba') $$, '23514', null, 'Nadie da de baja a la dueña');
select throws_ok($$ update miembros set es_dueno = true where perfil_id = '8a000000-0000-0000-0000-000000000004' $$, '23514', null, 'Nadie se nombra dueño por su cuenta');
reset role;
select throws_ok($$ update perfiles set activo = false where id = '8a000000-0000-0000-0000-000000000001' $$, '23514', null, 'Ni se apaga el acceso global de la dueña');

-- Reactivar.
select pg_temp.como('8a000000-0000-0000-0000-000000000001');
select is(reactivar('a0000000-0000-0000-0000-0000000000c1', '8a000000-0000-0000-0000-000000000003'), 1, 'La dueña lo reactiva');
reset role;
select * from finish();
rollback;
