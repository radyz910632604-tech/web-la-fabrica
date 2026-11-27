-- Firmas del cliente, copias de seguridad y estado del sistema: quién puede qué.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(15);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000d1', 'Taller Firmas');
insert into auth.users (id, email, raw_app_meta_data) values
  ('83000000-0000-0000-0000-000000000001', 'fg@prueba.invalid', '{"nombre":"Gerencia F","celular":"+51955500701"}'),
  ('83000000-0000-0000-0000-000000000002', 'fr@prueba.invalid', '{"nombre":"Recepcion F","celular":"+51955500702"}'),
  ('83000000-0000-0000-0000-000000000003', 'ft@prueba.invalid', '{"nombre":"Tecnico F","celular":"+51955500703"}'),
  ('83000000-0000-0000-0000-000000000004', 'fa@prueba.invalid', '{"nombre":"Asesor F","celular":"+51955500704"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000d1', '83000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000d1', '83000000-0000-0000-0000-000000000002', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000d1', '83000000-0000-0000-0000-000000000003', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000d1', '83000000-0000-0000-0000-000000000004', 'asesor');
insert into clientes (id, empresa_id, nombre, celular) values ('c3000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'Cliente F', '+51966600071');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d3000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'FIR123', 'c3000000-0000-0000-0000-0000000000d1');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id, firma_ingreso_ruta) values
  ('f3000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d1', 'd3000000-0000-0000-0000-0000000000d1', 'c3000000-0000-0000-0000-0000000000d1', '83000000-0000-0000-0000-000000000003', 'algo/inventado.png');
-- Imágenes ya subidas (como lo hace la app antes de registrar la firma)
insert into storage.objects (bucket_id, name) values
  ('ordenes', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-ingreso-11111111-1111-1111-1111-111111111111.png'),
  ('ordenes', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-entrega-22222222-2222-2222-2222-222222222222.png');
insert into respaldos (origen, modo, ruta, tamano_bytes, tablas, filas) values ('automatico', 'completo', '2026-11-17/respaldo.json.gz', 1000, 40, 500);
insert into estado_sistema (clave, valor) values ('ciclo_interno', '{"ok":true}');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select is((select firma_ingreso_ruta from ordenes_trabajo where id = 'f3000000-0000-0000-0000-0000000000d1'), null, 'Al abrir la orden no se acepta una firma inventada');

-- El asesor toma la firma de ingreso
select pg_temp.como('83000000-0000-0000-0000-000000000004');
select throws_ok($$ update ordenes_trabajo set firma_ingreso_ruta = 'otra/cosa.png' where id = 'f3000000-0000-0000-0000-0000000000d1' $$, '23514', null, 'La firma no se escribe a mano en la orden');
select throws_ok($$ select registrar_firma('f3000000-0000-0000-0000-0000000000d1', 'ingreso', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-ingreso-99999999-9999-9999-9999-999999999999.png') $$, '23514', null, 'Sin la imagen subida no hay firma');
select throws_ok($$ select registrar_firma('f3000000-0000-0000-0000-0000000000d1', 'ingreso', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-entrega-22222222-2222-2222-2222-222222222222.png') $$, '23514', null, 'La imagen debe ser de esa etapa');
select lives_ok($$ select registrar_firma('f3000000-0000-0000-0000-0000000000d1', 'ingreso', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-ingreso-11111111-1111-1111-1111-111111111111.png') $$, 'El asesor registra la firma de ingreso');
select isnt((select firma_ingreso_en from ordenes_trabajo where id = 'f3000000-0000-0000-0000-0000000000d1'), null, 'Queda la fecha y hora de la firma');
select lives_ok($$ update ordenes_trabajo set observaciones_ingreso = 'Rayón en la puerta' where id = 'f3000000-0000-0000-0000-0000000000d1' $$, 'Los demás datos de la orden se siguen editando');

-- El técnico no toma firmas; recepción toma la de entrega, no la de ingreso
select pg_temp.como('83000000-0000-0000-0000-000000000003');
select throws_ok($$ select registrar_firma('f3000000-0000-0000-0000-0000000000d1', 'entrega', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-entrega-22222222-2222-2222-2222-222222222222.png') $$, '42501', null, 'El técnico no toma la firma de entrega');
select pg_temp.como('83000000-0000-0000-0000-000000000002');
select throws_ok($$ select registrar_firma('f3000000-0000-0000-0000-0000000000d1', 'ingreso', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-ingreso-11111111-1111-1111-1111-111111111111.png') $$, '42501', null, 'Recepción no toma la firma de ingreso');
select lives_ok($$ select registrar_firma('f3000000-0000-0000-0000-0000000000d1', 'entrega', 'a0000000-0000-0000-0000-0000000000d1/f3000000-0000-0000-0000-0000000000d1/firma-entrega-22222222-2222-2222-2222-222222222222.png') $$, 'Recepción registra la firma de entrega');

-- Respaldos y estado del sistema: solo gerencia los ve; nadie los escribe desde la app
select is((select count(*)::int from respaldos), 0, 'Recepción no ve las copias de seguridad');
select is((select count(*)::int from estado_sistema), 0, 'Recepción no ve el estado del sistema');
select pg_temp.como('83000000-0000-0000-0000-000000000001');
select is((select count(*)::int from respaldos), 1, 'Gerencia ve las copias de seguridad');
select throws_ok($$ insert into respaldos (origen, modo) values ('manual', 'datos') $$, '42501', null, 'Nadie registra respaldos a mano');
select throws_ok($$ delete from respaldos $$, '42501', null, 'Nadie borra el registro de respaldos');

select * from finish();
rollback;
