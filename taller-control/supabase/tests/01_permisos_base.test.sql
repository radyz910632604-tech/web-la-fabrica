-- Pruebas de permisos por rol (Fase 1A): empresas, personal, roles,
-- configuración, metas y auditoría.
-- Se corren con: npm run test:db
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

-- ---------------------------------------------------------------
-- Escenario: dos talleres y siete personas ficticias
-- ---------------------------------------------------------------
insert into empresas (id, nombre) values
  ('a0000000-0000-0000-0000-00000000000a', 'Taller Prueba A'),
  ('b0000000-0000-0000-0000-00000000000b', 'Taller Prueba B');

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'g@prueba.invalid',  '{"nombre":"Gerencia A","celular":"+51911111101"}'),
  ('00000000-0000-0000-0000-000000000002', 'ad@prueba.invalid', '{"nombre":"Admin A","celular":"+51911111102"}'),
  ('00000000-0000-0000-0000-000000000003', 'as@prueba.invalid', '{"nombre":"Asesor A","celular":"+51911111103"}'),
  ('00000000-0000-0000-0000-000000000004', 't@prueba.invalid',  '{"nombre":"Tecnico A","celular":"+51911111104"}'),
  ('00000000-0000-0000-0000-000000000005', 'gb@prueba.invalid', '{"nombre":"Gerencia B","celular":"+51911111105"}'),
  ('00000000-0000-0000-0000-000000000006', 'g2@prueba.invalid', '{"nombre":"Gerencia A dos","celular":"+51911111106"}'),
  ('00000000-0000-0000-0000-000000000007', 'v@prueba.invalid',  '{"nombre":"Vendedor A","celular":"+51911111107"}');

insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000002', 'administrador'),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'asesor'),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'tecnico'),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000005', 'gerencia'),
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000007', 'vendedor_redes');

insert into metas_ventas (empresa_id, anio, mes, meta_sin_igv) values
  ('a0000000-0000-0000-0000-00000000000a', 2026, 11, 120000),
  ('b0000000-0000-0000-0000-00000000000b', 2026, 11, 80000);

-- Cuántas filas cambió una sentencia (las reglas RLS cambian 0 en silencio)
create function pg_temp.filas(q text) returns int language plpgsql as $$
declare n int;
begin
  execute q;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Actuar como una persona (rol "authenticated" con su id en el token)
create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------
-- 1. Cada persona ve solo sus talleres
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select results_eq(
  $$ select nombre from empresas $$,
  array['Taller Prueba A'],
  'El técnico ve solo su taller'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000005');
select results_eq(
  $$ select nombre from empresas $$,
  array['Taller Prueba B'],
  'La gerencia del taller B no ve el taller A'
);
select is(
  (select count(*)::int from directorio('a0000000-0000-0000-0000-00000000000a')),
  0,
  'Nadie ve el personal de un taller ajeno'
);
reset role;

-- ---------------------------------------------------------------
-- 2. Datos de contacto del personal
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select results_eq(
  $$ select nombre from perfiles $$,
  array['Tecnico A'],
  'El técnico solo ve su propio perfil (con celular)'
);
select is(
  (select count(*)::int from directorio('a0000000-0000-0000-0000-00000000000a')),
  5,
  'El técnico ve los nombres del personal de su taller'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000003');
select is(
  (select count(*)::int from perfiles),
  5,
  'El asesor ve los datos de contacto del personal de su taller'
);
reset role;

-- ---------------------------------------------------------------
-- 3. Asignar roles
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000002');
select throws_ok(
  $$ insert into miembros (empresa_id, perfil_id, rol)
     values ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000003', 'gerencia') $$,
  '42501', null,
  'El administrador no puede dar el rol gerencia'
);
select lives_ok(
  $$ insert into miembros (empresa_id, perfil_id, rol)
     values ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'almacen') $$,
  'El administrador sí puede dar otros roles'
);
select throws_ok(
  $$ insert into miembros (empresa_id, perfil_id, rol)
     values ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000004', 'tecnico') $$,
  '42501', null,
  'El administrador no puede asignar roles en un taller ajeno'
);
select is(
  pg_temp.filas($q$ update miembros set activo = false
     where perfil_id = '00000000-0000-0000-0000-000000000001' $q$),
  0,
  'El administrador no puede desactivar a gerencia'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ insert into miembros (empresa_id, perfil_id, rol)
     values ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000004', 'gerencia') $$,
  '42501', null,
  'El técnico no puede darse roles'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update miembros set activo = false
     where perfil_id = '00000000-0000-0000-0000-000000000001' $$,
  '23514', null,
  'Un taller no puede quedarse sin gerencia'
);
select lives_ok(
  $$ insert into miembros (empresa_id, perfil_id, rol)
     values ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000006', 'gerencia') $$,
  'Gerencia sí puede dar el rol gerencia'
);
reset role;

-- ---------------------------------------------------------------
-- 4. Perfil propio
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select is(
  pg_temp.filas($q$ update perfiles set nombre = 'Técnico A'
     where id = '00000000-0000-0000-0000-000000000004' $q$),
  1,
  'Cada persona puede cambiar su nombre'
);
select throws_ok(
  $$ update perfiles set celular = '+51999999999'
     where id = '00000000-0000-0000-0000-000000000004' $$,
  '42501', null,
  'Nadie cambia su celular desde la app (lo hace el servidor)'
);
select throws_ok(
  $$ update perfiles set activo = false
     where id = '00000000-0000-0000-0000-000000000004' $$,
  '42501', null,
  'Nadie se activa o desactiva a sí mismo'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000001');
select throws_ok(
  $$ update perfiles set activo = false
     where id = '00000000-0000-0000-0000-000000000001' $$,
  '42501', null,
  'Ni gerencia puede desactivarse a sí misma'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000002');
select is(
  pg_temp.filas($q$ update perfiles set activo = false
     where id = '00000000-0000-0000-0000-000000000001' $q$),
  0,
  'El administrador no puede desactivar a gerencia'
);
reset role;

-- ---------------------------------------------------------------
-- 5. Configuración del taller
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000003');
select is(
  pg_temp.filas($q$ update configuracion_empresa set tolerancia_cita_minutos = 45
     where empresa_id = 'a0000000-0000-0000-0000-00000000000a' $q$),
  0,
  'El asesor no cambia la configuración'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000002');
select is(
  pg_temp.filas($q$ update configuracion_empresa set tolerancia_cita_minutos = 45
     where empresa_id = 'a0000000-0000-0000-0000-00000000000a' $q$),
  1,
  'El administrador cambia la configuración'
);
select throws_ok(
  $$ update configuracion_empresa set admin_ve_utilidad = true
     where empresa_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  '42501', null,
  'El administrador no puede darse permiso para ver la utilidad'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ update configuracion_empresa set admin_ve_utilidad = true
     where empresa_id = 'a0000000-0000-0000-0000-00000000000a' $$,
  'Gerencia decide qué ve el administrador'
);
reset role;

-- ---------------------------------------------------------------
-- 6. Metas de ventas
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select is((select count(*)::int from metas_ventas), 0, 'El técnico no ve la meta de ventas');
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000003');
select is((select count(*)::int from metas_ventas), 1, 'El asesor ve la meta de su taller y no la ajena');
reset role;

-- ---------------------------------------------------------------
-- 7. Auditoría
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select is((select count(*)::int from auditoria), 0, 'El técnico no ve la auditoría');
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000001');
select ok(
  (select count(*) from auditoria where tabla = 'configuracion_empresa' and accion = 'editar') >= 2,
  'Gerencia ve en la auditoría los cambios de configuración'
);
select throws_ok(
  $$ delete from auditoria $$,
  '42501', null,
  'Gerencia no puede borrar la auditoría'
);
reset role;

-- ---------------------------------------------------------------
-- 8. Crear talleres, acceso anónimo y personas desactivadas
-- ---------------------------------------------------------------
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select throws_ok(
  $$ select crear_empresa('Taller del técnico') $$,
  '42501', null,
  'El técnico no puede crear talleres'
);
reset role;

select pg_temp.como('00000000-0000-0000-0000-000000000005');
-- (en dos pasos: una función STABLE no ve lo que se creó en la misma sentencia)
select set_config('prueba.nueva', crear_empresa('Taller Prueba C')::text, true);
select ok(
  privado.tiene_rol(current_setting('prueba.nueva')::uuid, array['gerencia']::rol_t[]),
  'Gerencia crea un taller y queda como gerencia de él'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from empresas $$,
  '42501', null,
  'Sin iniciar sesión no se ve nada'
);
reset role;

-- Gerencia desactiva al técnico: pierde el acceso al instante.
select pg_temp.como('00000000-0000-0000-0000-000000000001');
update perfiles set activo = false where id = '00000000-0000-0000-0000-000000000004';
reset role;
select pg_temp.como('00000000-0000-0000-0000-000000000004');
select is((select count(*)::int from empresas), 0, 'Una persona desactivada ya no ve nada');
reset role;

select * from finish();
rollback;
