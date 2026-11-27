-- Agregar servicio o producto con precio desde la orden: roles, un solo total, quién lo puso.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(12);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f9', 'Taller Precio');
insert into auth.users (id, email, raw_app_meta_data) values
  ('93000000-0000-0000-0000-000000000001', 'pr@prueba.invalid', '{"nombre":"Recepción P","celular":"+51955530101"}'),
  ('93000000-0000-0000-0000-000000000002', 'pt@prueba.invalid', '{"nombre":"Técnico P","celular":"+51955530102"}'),
  ('93000000-0000-0000-0000-000000000003', 'pa@prueba.invalid', '{"nombre":"Asesor P","celular":"+51955530103"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f9', '93000000-0000-0000-0000-000000000001', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000f9', '93000000-0000-0000-0000-000000000002', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000f9', '93000000-0000-0000-0000-000000000003', 'asesor');
insert into clientes (id, empresa_id, nombre, celular) values ('c0f00000-0000-0000-0000-0000000000f9', 'a0000000-0000-0000-0000-0000000000f9', 'Cliente P', '+51966600731');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d0f00000-0000-0000-0000-0000000000f9', 'a0000000-0000-0000-0000-0000000000f9', 'PRE123', 'c0f00000-0000-0000-0000-0000000000f9');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values
  ('f0f00000-0000-0000-0000-0000000000f9', 'a0000000-0000-0000-0000-0000000000f9', 'd0f00000-0000-0000-0000-0000000000f9', 'c0f00000-0000-0000-0000-0000000000f9');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('93000000-0000-0000-0000-000000000002');
select throws_ok($$ select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'servicio', 'Cambio de aceite', 1, 120) $$, '42501', null, 'El técnico no pone precios');
reset role;

select pg_temp.como('93000000-0000-0000-0000-000000000001');
select lives_ok($$ select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'servicio', 'Cambio de aceite', 1, 120) $$, 'Recepción agrega servicio con precio');
reset role;
select pg_temp.como('93000000-0000-0000-0000-000000000003');
select lives_ok($$ select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'repuesto', 'Filtro de aceite', 2, 35) $$, 'El asesor agrega un producto con precio');
select throws_ok($$ select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'servicio', 'Algo', 1, -5) $$, '22023', null, 'Precio negativo no');
reset role;

select is((select count(*)::int from cotizaciones where orden_id = 'f0f00000-0000-0000-0000-0000000000f9'), 1, 'Una sola cotización: no se duplica');
select is((select total from cotizaciones where orden_id = 'f0f00000-0000-0000-0000-0000000000f9'), 190.00::numeric, 'Total S/ 120 + 2 × S/ 35 = S/ 190');
select is((select count(*)::int from orden_servicios where orden_id = 'f0f00000-0000-0000-0000-0000000000f9'), 1, 'El servicio queda en la lista de trabajos (el producto no)');
select is((select i.creado_por from cotizacion_items i join cotizaciones c on c.id = i.cotizacion_id where c.orden_id = 'f0f00000-0000-0000-0000-0000000000f9' and i.descripcion = 'Filtro de aceite'), '93000000-0000-0000-0000-000000000003'::uuid, 'Cada precio guarda quién lo puso');

-- Aprobada la primera, lo nuevo va en una cotización adicional (no cambia lo aprobado).
update cotizaciones set estado = 'aprobada', aprobada_por_medio = 'presencial' where orden_id = 'f0f00000-0000-0000-0000-0000000000f9';
select pg_temp.como('93000000-0000-0000-0000-000000000001');
select lives_ok($$ select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'servicio', 'Lavado de motor', 1, 40) $$, 'Adicional después de aprobar');
reset role;
select ok((select es_adicional and estado = 'borrador' and total = 40 from cotizaciones where orden_id = 'f0f00000-0000-0000-0000-0000000000f9' and version = 2), 'Va en una cotización adicional por aprobar');

-- Poner precio a un servicio que ya estaba: no se repite en la lista de trabajos.
select pg_temp.como('93000000-0000-0000-0000-000000000001');
select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'servicio', 'Lavado de motor', 1, 10, false);
reset role;
select is((select count(*)::int from orden_servicios where orden_id = 'f0f00000-0000-0000-0000-0000000000f9' and descripcion = 'Lavado de motor'), 1, 'Solo precio: el trabajo no se duplica');

-- Con recibo emitido, ya no se cambian precios.
insert into recibos (empresa_id, orden_id, numero, tasa_igv, subtotal_sin_igv, igv, total)
values ('a0000000-0000-0000-0000-0000000000f9', 'f0f00000-0000-0000-0000-0000000000f9', 1, 0.18, 161.02, 28.98, 190);
select pg_temp.como('93000000-0000-0000-0000-000000000001');
select throws_ok($$ select agregar_a_orden('f0f00000-0000-0000-0000-0000000000f9', 'servicio', 'Otro', 1, 10) $$, '23514', null, 'Con recibo vigente no se cambian precios');
reset role;
select * from finish();
rollback;
