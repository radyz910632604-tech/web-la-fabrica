-- Alta completa del trabajador y esquema de pago con versiones.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f2', 'Taller Alta');
insert into auth.users (id, email, raw_app_meta_data) values
  ('8e000000-0000-0000-0000-000000000001', 'ag@prueba.invalid', '{"nombre":"Dueño A","celular":"+51955507101"}'),
  ('8e000000-0000-0000-0000-000000000002', 'aa@prueba.invalid', '{"nombre":"Admin A","celular":"+51955507102"}'),
  ('8e000000-0000-0000-0000-000000000003', 'am@prueba.invalid', '{"nombre":"Mecánico A","celular":"+51955507103"}'),
  ('8e000000-0000-0000-0000-000000000004', 'as@prueba.invalid', '{"nombre":"Asesora A","celular":"+51955507104"}'),
  ('8e000000-0000-0000-0000-000000000005', 'ax@prueba.invalid', '{"nombre":"Otro A","celular":"+51955507105"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000002', 'administrador');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('8e000000-0000-0000-0000-000000000002');
select lives_ok($$ select alta_persona('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000003', 'tecnico', '90807060', 'Mecánico de motor', current_date, 'fijo', 900, 'quincenal', 5) $$, 'Administración da de alta al mecánico');
reset role;
select ok((select activo from miembros where perfil_id = '8e000000-0000-0000-0000-000000000003'), 'Queda activo con su rol');
select ok((select tipo = 'fijo' and monto = 900 and frecuencia = 'quincenal' and comision_pct is null from esquemas_pago where perfil_id = '8e000000-0000-0000-0000-000000000003'), 'Con su pago quincenal y sin comisión (es mecánico)');
select is((select documento from perfiles where id = '8e000000-0000-0000-0000-000000000003'), '90807060', 'Con su DNI');

select pg_temp.como('8e000000-0000-0000-0000-000000000002');
select throws_ok($$ select alta_persona('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000005', 'recepcion', '90807060', null, current_date, 'fijo', 800, 'mensual') $$, '23505', null, 'El DNI no se repite');
select throws_ok($$ select alta_persona('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000005', 'gerencia', '11112222', null, current_date, 'fijo', 800, 'mensual') $$, '42501', null, 'Administración no da el rol de gerencia');
select lives_ok($$ select alta_persona('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000004', 'asesor', '33334444', null, current_date, 'fijo', 1200, 'mensual', 3) $$, 'Alta de la asesora con 3 % de comisión');
reset role;
select is((select comision_pct from esquemas_pago where perfil_id = '8e000000-0000-0000-0000-000000000004'), 3.00::numeric, 'La asesora sí lleva comisión');

-- Cambio de sueldo: desde una fecha futura; lo anterior queda igual.
select pg_temp.como('8e000000-0000-0000-0000-000000000002');
select throws_ok($$ select cambiar_esquema_pago('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000003', 'fijo', 1000, 'quincenal', null, current_date - 10, 'Aumento') $$, '23514', null, 'No se cambia hacia atrás');
select lives_ok($$ select cambiar_esquema_pago('a0000000-0000-0000-0000-0000000000f2', '8e000000-0000-0000-0000-000000000003', 'fijo', 1000, 'quincenal', null, current_date + 15, 'Aumento') $$, 'Aumento desde dentro de 15 días');
select throws_ok($$ update esquemas_pago set monto = 1 where perfil_id = '8e000000-0000-0000-0000-000000000003' $$, '42501', null, 'Nadie edita un esquema a mano');
reset role;
select ok((select count(*) = 2 and bool_or(monto = 900 and vigente_hasta = current_date + 14) from esquemas_pago where perfil_id = '8e000000-0000-0000-0000-000000000003'), 'Quedan las dos versiones; la anterior cerrada');
select * from finish();
rollback;
