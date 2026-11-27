-- Estados nuevos, diagnóstico y «facturado»: quién puede qué y que la base lo lleve sola.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000e1', 'Taller Estados');
insert into auth.users (id, email, raw_app_meta_data) values
  ('84000000-0000-0000-0000-000000000001', 'eg@prueba.invalid', '{"nombre":"Gerencia E","celular":"+51955500801"}'),
  ('84000000-0000-0000-0000-000000000003', 'et@prueba.invalid', '{"nombre":"Tecnico E","celular":"+51955500803"}'),
  ('84000000-0000-0000-0000-000000000004', 'ea@prueba.invalid', '{"nombre":"Asesor E","celular":"+51955500804"}'),
  ('84000000-0000-0000-0000-000000000005', 'eo@prueba.invalid', '{"nombre":"Otro tecnico","celular":"+51955500805"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000e1', '84000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000e1', '84000000-0000-0000-0000-000000000003', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000e1', '84000000-0000-0000-0000-000000000004', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000e1', '84000000-0000-0000-0000-000000000005', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('c4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'Cliente E', '+51966600081');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'EST123', 'c4000000-0000-0000-0000-0000000000e1');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id) values
  ('f4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'd4000000-0000-0000-0000-0000000000e1', 'c4000000-0000-0000-0000-0000000000e1', '84000000-0000-0000-0000-000000000003');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- El asesor pasa por los estados nuevos; cada paso queda en el historial
select pg_temp.como('84000000-0000-0000-0000-000000000004');
select lives_ok($$ select cambiar_estado_orden('f4000000-0000-0000-0000-0000000000e1', 'en_diagnostico') $$, 'Pasa a En diagnóstico');
select lives_ok($$ select cambiar_estado_orden('f4000000-0000-0000-0000-0000000000e1', 'espera_aprobacion', 'Presupuesto enviado') $$, 'Pasa a Espera aprobación');
select lives_ok($$ select cambiar_estado_orden('f4000000-0000-0000-0000-0000000000e1', 'aprobado') $$, 'El cliente aprobó');
select is((select count(*)::int from orden_estados_historial where orden_id = 'f4000000-0000-0000-0000-0000000000e1'), 4, 'Cada cambio queda en el historial (con el ingreso)');

-- Diagnóstico: el técnico asignado sí, otro técnico no
select pg_temp.como('84000000-0000-0000-0000-000000000005');
select throws_ok($$ select registrar_diagnostico('f4000000-0000-0000-0000-0000000000e1', 'Embrague gastado') $$, '42501', null, 'Un técnico de otra orden no escribe el diagnóstico');
select pg_temp.como('84000000-0000-0000-0000-000000000003');
select throws_ok($$ select registrar_diagnostico('f4000000-0000-0000-0000-0000000000e1', 'x') $$, '23514', null, 'Un diagnóstico vacío no se guarda');
select lives_ok($$ select registrar_diagnostico('f4000000-0000-0000-0000-0000000000e1', 'Sincronizador de tercera gastado') $$, 'El técnico asignado escribe el diagnóstico');
select is((select diagnostico from ordenes_trabajo where id = 'f4000000-0000-0000-0000-0000000000e1'), 'Sincronizador de tercera gastado', 'Queda en la orden');
select is((select count(*)::int from orden_avances where orden_id = 'f4000000-0000-0000-0000-0000000000e1' and texto like 'Diagnóstico:%'), 1, 'Y también como avance');

-- Facturado: lo marca la base al registrar el comprobante y lo quita al anularlo
reset role;
insert into comprobantes_venta (id, empresa_id, orden_id, tipo, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total)
values ('e4000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'f4000000-0000-0000-0000-0000000000e1', 'boleta', 'B001', '77', current_date, 0.18, 100, 18, 118);
select isnt((select facturado_en from ordenes_trabajo where id = 'f4000000-0000-0000-0000-0000000000e1'), null, 'Con boleta, la orden queda facturada');
update comprobantes_venta set estado = 'anulado', anulado_en = now(), motivo_anulacion = 'Prueba' where id = 'e4000000-0000-0000-0000-0000000000e1';
select is((select facturado_en from ordenes_trabajo where id = 'f4000000-0000-0000-0000-0000000000e1'), null, 'Al anular la boleta deja de estar facturada');

select * from finish();
