-- Avisos: carro listo, encuesta y recordatorio solo con consentimiento; canal apagado; cotización por WhatsApp.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000b1', 'Taller Avisos');
insert into auth.users (id, email, raw_app_meta_data) values
  ('90000000-0000-0000-0000-000000000001', 'vg@prueba.invalid', '{"nombre":"Gerencia V","celular":"+51955500501"}'),
  ('90000000-0000-0000-0000-000000000002', 'vt@prueba.invalid', '{"nombre":"Tecnico V","celular":"+51955500502"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000b1', '90000000-0000-0000-0000-000000000002', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular, acepta_mensajes) values
  ('cb000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'Ana Acepta', '+51966600051', true),
  ('cb000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000b1', 'Beto Niega', '+51966600052', false);
insert into vehiculos (id, empresa_id, placa, cliente_id, kilometraje_actual) values
  ('db000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'AVI111', 'cb000000-0000-0000-0000-000000000001', 80000),
  ('db000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000b1', 'AVI222', 'cb000000-0000-0000-0000-000000000002', null);
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, estado, kilometraje_ingreso) values
  ('fb000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'db000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001', 'en_proceso', 80000),
  ('fb000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000b1', 'db000000-0000-0000-0000-000000000002', 'cb000000-0000-0000-0000-000000000002', 'en_proceso', null);
insert into orden_servicios (empresa_id, orden_id, servicio_id, descripcion)
select 'a0000000-0000-0000-0000-0000000000b1', 'fb000000-0000-0000-0000-000000000001', id, nombre from catalogo_servicios where empresa_id = 'a0000000-0000-0000-0000-0000000000b1' and nombre = 'Cambio de aceite y filtro';

select is((select meses_recordatorio from catalogo_servicios where empresa_id = 'a0000000-0000-0000-0000-0000000000b1' and nombre = 'Cambio de aceite y filtro'), 3, 'El cambio de aceite recuerda a los 3 meses');

update ordenes_trabajo set estado = 'listo' where id in ('fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000002');
select is((select count(*)::int from avisos where tipo = 'carro_listo'), 1, 'Carro listo: aviso solo al cliente que aceptó mensajes');
select is((select celular from avisos where tipo = 'carro_listo'), '+51966600051', 'El aviso va al celular del cliente');
update ordenes_trabajo set estado = 'en_proceso' where id = 'fb000000-0000-0000-0000-000000000001';
update ordenes_trabajo set estado = 'listo' where id = 'fb000000-0000-0000-0000-000000000001';
select is((select count(*)::int from avisos where tipo = 'carro_listo'), 1, 'No se repite el aviso de la misma orden');

update ordenes_trabajo set estado = 'entregado' where id in ('fb000000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000002');
select is((select count(*)::int from encuestas), 2, 'Cada orden entregada tiene su encuesta');
select is((select count(*)::int from avisos where tipo = 'encuesta'), 1, 'La encuesta se envía solo a quien aceptó mensajes');
select is((select km_objetivo from recordatorios_mantenimiento where orden_id = 'fb000000-0000-0000-0000-000000000001'), 85000, 'Recordatorio de aceite a los 5 000 km');

-- Canal apagado
insert into config_avisos (empresa_id, tipo, canal) values ('a0000000-0000-0000-0000-0000000000b1', 'carro_listo', 'apagado');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, estado) values ('fb000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000b1', 'db000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001', 'en_proceso');
update ordenes_trabajo set estado = 'listo' where id = 'fb000000-0000-0000-0000-000000000003';
select is((select count(*)::int from avisos where tipo = 'carro_listo'), 1, 'Con el canal apagado no se arma el aviso');

-- Cotización: solo el servidor registra la respuesta del cliente, y solo desde su celular
insert into cotizaciones (id, empresa_id, orden_id, version, tasa_igv, total, estado) values ('eb000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000b1', 'fb000000-0000-0000-0000-000000000003', 1, 0.18, 118, 'enviada');
select is(respuesta_cotizacion_cliente('eb000000-0000-0000-0000-000000000001', '+51999999999', true), 'no_es_suya', 'Otro celular no aprueba la cotización');
select is(respuesta_cotizacion_cliente('eb000000-0000-0000-0000-000000000001', '+51966600051', true), 'aprobada', 'El cliente aprueba desde su WhatsApp');

select set_config('role', 'authenticated', true), set_config('request.jwt.claims', json_build_object('sub', '90000000-0000-0000-0000-000000000002', 'role', 'authenticated')::text, true);
select throws_ok($$ select respuesta_cotizacion_cliente('eb000000-0000-0000-0000-000000000001', '+51966600051', false) $$, '42501', null, 'Desde la app nadie se hace pasar por el cliente');

select * from finish();
rollback;
