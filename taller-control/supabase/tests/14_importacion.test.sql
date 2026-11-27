-- Importar el historial del Excel: solo gestión, con su fecha, sin avisos y sin duplicar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f1', 'Taller Importa');
insert into auth.users (id, email, raw_app_meta_data) values
  ('85000000-0000-0000-0000-000000000001', 'ig@prueba.invalid', '{"nombre":"Gerencia I","celular":"+51955500901"}'),
  ('85000000-0000-0000-0000-000000000003', 'ia@prueba.invalid', '{"nombre":"Asesor I","celular":"+51955500903"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f1', '85000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000f1', '85000000-0000-0000-0000-000000000003', 'asesor');
insert into clientes (id, empresa_id, nombre, celular, acepta_mensajes) values ('c5000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'Cliente I', '+51966600091', true);
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d5000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'IMP123', 'c5000000-0000-0000-0000-0000000000f1');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('85000000-0000-0000-0000-000000000003');
select throws_ok($$ select importar_orden_historica('a0000000-0000-0000-0000-0000000000f1', 'd5000000-0000-0000-0000-0000000000f1', '2025-03-15', array['Frenos']) $$, '42501', null, 'El asesor no importa el historial');

select pg_temp.como('85000000-0000-0000-0000-000000000001');
select throws_ok($$ select importar_orden_historica('a0000000-0000-0000-0000-0000000000f1', 'd5000000-0000-0000-0000-0000000000f1', current_date + 5, array['Frenos']) $$, '23514', null, 'Una fecha futura no se acepta');
select isnt(importar_orden_historica('a0000000-0000-0000-0000-0000000000f1', 'd5000000-0000-0000-0000-0000000000f1', '2025-03-15', array['Cambio de aceite', 'Filtro de aire'], 62000, 'Cobrado S/ 180'), null, 'Gerencia importa una visita');
select is(importar_orden_historica('a0000000-0000-0000-0000-0000000000f1', 'd5000000-0000-0000-0000-0000000000f1', '2025-03-15', array['Cambio de aceite']), null, 'La misma visita importada otra vez no se duplica');

reset role;
select is((select count(*)::int from ordenes_trabajo where vehiculo_id = 'd5000000-0000-0000-0000-0000000000f1'), 1, 'Hay una sola orden');
select ok((select estado = 'entregado' and importada and (entregado_en at time zone 'America/Lima')::date = '2025-03-15' and (ingresado_en at time zone 'America/Lima')::date = '2025-03-15'
           from ordenes_trabajo where vehiculo_id = 'd5000000-0000-0000-0000-0000000000f1'), 'Entregada en su fecha antigua y marcada como importada');
select is((select count(*)::int from orden_servicios os join ordenes_trabajo o on o.id = os.orden_id where o.vehiculo_id = 'd5000000-0000-0000-0000-0000000000f1'), 2, 'Con sus dos servicios');
select is((select count(*)::int from avisos where empresa_id = 'a0000000-0000-0000-0000-0000000000f1') + (select count(*)::int from encuestas where empresa_id = 'a0000000-0000-0000-0000-0000000000f1'), 0, 'No se manda ningún mensaje ni encuesta al cliente');
select is((select kilometraje_actual from vehiculos where id = 'd5000000-0000-0000-0000-0000000000f1'), 62000, 'El kilometraje del carro se actualiza');

select * from finish();
