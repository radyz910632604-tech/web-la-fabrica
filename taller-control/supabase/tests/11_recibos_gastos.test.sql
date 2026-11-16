-- Recibos de venta numerados y gastos del taller: quién los hace, numeración y anulación.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000c1', 'Taller Recibos');
update configuracion_empresa set recibo_inicial = 10929, tasa_igv = 0 where empresa_id = 'a0000000-0000-0000-0000-0000000000c1';
insert into auth.users (id, email, raw_app_meta_data) values
  ('82000000-0000-0000-0000-000000000001', 'rg@prueba.invalid', '{"nombre":"Gerencia R","celular":"+51955500601"}'),
  ('82000000-0000-0000-0000-000000000002', 'rr@prueba.invalid', '{"nombre":"Recepcion R","celular":"+51955500602"}'),
  ('82000000-0000-0000-0000-000000000003', 'rt@prueba.invalid', '{"nombre":"Tecnico R","celular":"+51955500603"}'),
  ('82000000-0000-0000-0000-000000000004', 'ra@prueba.invalid', '{"nombre":"Asesor R","celular":"+51955500604"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000c1', '82000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000c1', '82000000-0000-0000-0000-000000000002', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000c1', '82000000-0000-0000-0000-000000000003', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000c1', '82000000-0000-0000-0000-000000000004', 'asesor');
insert into clientes (id, empresa_id, nombre, celular) values ('c2000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'Cliente R', '+51966600061');
insert into vehiculos (id, empresa_id, placa, cliente_id, carroceria) values ('d2000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'REC123', 'c2000000-0000-0000-0000-0000000000c1', 'suv');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, nivel_combustible) values
  ('f2000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000c1', 'd2000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-0000000000c1', 25),
  ('f2000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000c1', 'd2000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-0000000000c1', null);

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select throws_ok($$ update ordenes_trabajo set nivel_combustible = 30 where id = 'f2000000-0000-0000-0000-0000000000c1' $$, '23514', null, 'El combustible va por cuartos (0, 25, 50, 75, 100)');

-- Sin cotización aprobada no hay recibo
select pg_temp.como('82000000-0000-0000-0000-000000000002');
select throws_ok($$ select emitir_recibo('f2000000-0000-0000-0000-0000000000c1') $$, '23514', null, 'Sin cotización aprobada no se emite recibo');

-- Cotización aprobada (la arma el asesor)
select pg_temp.como('82000000-0000-0000-0000-000000000004');
select lives_ok($$ select crear_cotizacion('f2000000-0000-0000-0000-0000000000c1', false, '[{"tipo":"servicio","descripcion":"Mantenimiento de aire","cantidad":1,"precio":550,"sin_igv":550,"igv":0,"total":550}]'::jsonb, false) $$, 'El asesor arma la cotización');
reset role;
update cotizaciones set estado = 'aprobada', aprobada_por_medio = 'presencial', respuesta_en = now() where orden_id = 'f2000000-0000-0000-0000-0000000000c1';

-- Recepción emite el recibo: sigue la numeración del sistema anterior
select pg_temp.como('82000000-0000-0000-0000-000000000002');
select lives_ok($$ select emitir_recibo('f2000000-0000-0000-0000-0000000000c1', 'Asesor Anthony') $$, 'Recepción emite el recibo');
select is((select numero from recibos where orden_id = 'f2000000-0000-0000-0000-0000000000c1'), 10929, 'El primer recibo sigue la numeración del sistema anterior');
select is((select total from recibos where orden_id = 'f2000000-0000-0000-0000-0000000000c1'), 550.00::numeric, 'El recibo cobra lo de la cotización aprobada');
select throws_ok($$ select emitir_recibo('f2000000-0000-0000-0000-0000000000c1') $$, '23505', null, 'Una orden no tiene dos recibos vigentes');
select throws_ok($$ insert into recibos (empresa_id, orden_id, numero, tasa_igv, subtotal_sin_igv, igv, total) values ('a0000000-0000-0000-0000-0000000000c1', 'f2000000-0000-0000-0000-0000000000c1', 1, 0, 10, 0, 10) $$, '42501', null, 'Nadie inserta recibos a mano');
select is((select count(*)::int from recibos where empresa_id = 'a0000000-0000-0000-0000-0000000000c1' and estado = 'anulado'), 0, 'Recepción no puede anular');
update recibos set estado = 'anulado', motivo_anulacion = 'Prueba de recepción' where orden_id = 'f2000000-0000-0000-0000-0000000000c1';
select is((select estado::text from recibos where orden_id = 'f2000000-0000-0000-0000-0000000000c1'), 'confirmado', 'Recepción no anula recibos');

-- El técnico no ve recibos ni los emite
select pg_temp.como('82000000-0000-0000-0000-000000000003');
select is((select count(*)::int from recibos), 0, 'El técnico no ve recibos');
select throws_ok($$ select emitir_recibo('f2000000-0000-0000-0000-0000000000c2') $$, '42501', null, 'El técnico no emite recibos');

-- Gerencia anula con motivo; el siguiente recibo sigue el correlativo
select pg_temp.como('82000000-0000-0000-0000-000000000001');
update recibos set estado = 'anulado', motivo_anulacion = 'Se cobró otro monto' where orden_id = 'f2000000-0000-0000-0000-0000000000c1';
select lives_ok($$ select emitir_recibo('f2000000-0000-0000-0000-0000000000c1') $$, 'Anulado el anterior, se emite otro');
select is((select max(numero) from recibos where empresa_id = 'a0000000-0000-0000-0000-0000000000c1'), 10930, 'El nuevo recibo sigue el correlativo');

-- Gastos del taller: gerencia los registra; no se borran; el asesor no los ve
select lives_ok($$ insert into gastos (empresa_id, fecha, categoria, descripcion, monto, medio) values ('a0000000-0000-0000-0000-0000000000c1', '2026-11-01', 'alquiler', 'Alquiler de noviembre', 3500, 'transferencia') $$, 'Gerencia registra un gasto');
select pg_temp.como('82000000-0000-0000-0000-000000000004');
select is((select count(*)::int from gastos), 0, 'El asesor no ve los gastos del taller');

select * from finish();
rollback;
