-- Usuario propio: automático, único, con formato, y celular editable.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f3', 'Taller Usuarios');
insert into auth.users (id, email, raw_app_meta_data) values
  ('8f000000-0000-0000-0000-000000000001', 'ug@prueba.invalid', '{"nombre":"Dueña Usuaria","celular":"+51955508101"}'),
  ('8f000000-0000-0000-0000-000000000002', 'u1@prueba.invalid', '{"nombre":"José Ñahui Peña","celular":"+51955508102"}'),
  ('8f000000-0000-0000-0000-000000000003', 'u2@prueba.invalid', '{"nombre":"José Ñahui","celular":"+51955508103"}'),
  ('8f000000-0000-0000-0000-000000000004', 'u3@prueba.invalid', '{"nombre":"Elegido","celular":"+51955508104","usuario":"el.elegido"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f3', '8f000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000f3', '8f000000-0000-0000-0000-000000000002', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000f3', '8f000000-0000-0000-0000-000000000003', 'tecnico');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select is((select usuario from perfiles where id = '8f000000-0000-0000-0000-000000000002'), 'jose.nahui', 'Usuario automático sin tildes ni eñes');
select is((select usuario from perfiles where id = '8f000000-0000-0000-0000-000000000003'), 'jose.nahui2', 'Si se repite, lleva un número');
select is((select usuario from perfiles where id = '8f000000-0000-0000-0000-000000000004'), 'el.elegido', 'Si viene elegido en el alta, se usa ese');

select pg_temp.como('8f000000-0000-0000-0000-000000000001');
select throws_ok($$ update perfiles set usuario = 'jose.nahui' where id = '8f000000-0000-0000-0000-000000000003' $$, '23505', null, 'Un usuario repetido se rechaza');
select throws_ok($$ update perfiles set usuario = 'José Ñahui' where id = '8f000000-0000-0000-0000-000000000003' $$, '23514', null, 'Con espacios o tildes se rechaza');
select is(sugerir_usuario('jose.nahui'), 'jose.nahui3', 'Sugiere uno libre');
update perfiles set usuario = 'mecanico.jose' where id = '8f000000-0000-0000-0000-000000000003';
select is((select usuario from perfiles where id = '8f000000-0000-0000-0000-000000000003'), 'mecanico.jose', 'El dueño le cambia el usuario');
select lives_ok($$ select cambiar_celular('8f000000-0000-0000-0000-000000000003', '+51955508199') $$, 'El dueño cambia el celular sin crear a la persona de nuevo');
select throws_ok($$ select cambiar_celular('8f000000-0000-0000-0000-000000000003', '+51955508102') $$, '23505', null, 'Un celular de otra persona se rechaza');
reset role;

-- El técnico no cambia el celular de otro.
select pg_temp.como('8f000000-0000-0000-0000-000000000002');
select throws_ok($$ select cambiar_celular('8f000000-0000-0000-0000-000000000003', '+51955508188') $$, '42501', null, 'Un técnico no cambia el celular de otro');
reset role;
select * from finish();
rollback;
