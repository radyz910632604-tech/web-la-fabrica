-- Fondo de Almacén (traspaso, no gasto) y comprobante pendiente.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(16);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f1', 'Taller Fondo');
insert into auth.users (id, email, raw_app_meta_data) values
  ('8d000000-0000-0000-0000-000000000001', 'fg@prueba.invalid', '{"nombre":"Dueño F","celular":"+51955506101"}'),
  ('8d000000-0000-0000-0000-000000000002', 'fr@prueba.invalid', '{"nombre":"Recepción F","celular":"+51955506102"}'),
  ('8d000000-0000-0000-0000-000000000003', 'fa@prueba.invalid', '{"nombre":"Almacén F","celular":"+51955506103"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f1', '8d000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000f1', '8d000000-0000-0000-0000-000000000002', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000f1', '8d000000-0000-0000-0000-000000000003', 'almacen');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('8d000000-0000-0000-0000-000000000002');
insert into cajas (id, empresa_id, tipo_caja, monto_inicial) values ('ed000000-0000-0000-0000-0000000000f1', 'a0000000-0000-0000-0000-0000000000f1', 'recepcion', 300);
select throws_ok($$ select mover_fondo_almacen('a0000000-0000-0000-0000-0000000000f1', 'asignacion', 100, 'recepcion', '8d000000-0000-0000-0000-000000000002', '8d000000-0000-0000-0000-000000000003') $$, '23514', null, 'Sin Caja de Almacén abierta no se entrega fondo');
reset role;
select pg_temp.como('8d000000-0000-0000-0000-000000000003');
insert into cajas (id, empresa_id, tipo_caja, monto_inicial) values ('ed000000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f1', 'almacen', 0);
reset role;

-- Recepción entrega S/ 100 a Almacén.
select pg_temp.como('8d000000-0000-0000-0000-000000000002');
select isnt(mover_fondo_almacen('a0000000-0000-0000-0000-0000000000f1', 'asignacion', 100, 'recepcion', '8d000000-0000-0000-0000-000000000002', '8d000000-0000-0000-0000-000000000003', 'Repuestos del día'), null, 'Recepción entrega S/ 100 a Almacén');
select throws_ok($$ select mover_fondo_almacen('a0000000-0000-0000-0000-0000000000f1', 'asignacion', 50, 'externo', '8d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000003') $$, '42501', null, 'Recepción no registra dinero de fuera de las cajas');
reset role;
select is((select count(*)::int from movimientos_caja where empresa_id = 'a0000000-0000-0000-0000-0000000000f1' and clase = 'asignacion_fondo'), 2, 'Queda el traspaso en las dos cajas');
select is((select count(*)::int from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000f1'), 0, 'Entregar dinero no es gasto');

-- Almacén compra insumos con comprobante pendiente y devuelve el vuelto.
select pg_temp.como('8d000000-0000-0000-0000-000000000003');
insert into movimientos_caja (empresa_id, caja_id, tipo, concepto, monto, medio, categoria_gasto, tipo_comprobante)
values ('a0000000-0000-0000-0000-0000000000f1', 'ed000000-0000-0000-0000-0000000000f2', 'egreso', 'Focos y trapos', 70, 'efectivo', 'limpieza', 'boleta');
select isnt(mover_fondo_almacen('a0000000-0000-0000-0000-0000000000f1', 'devolucion', 30, 'recepcion', '8d000000-0000-0000-0000-000000000003', '8d000000-0000-0000-0000-000000000002'), null, 'Almacén devuelve S/ 30 de vuelto');
reset role;
select is((select count(*)::int from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000f1'), 1, 'El único gasto es la compra (S/ 70)');
select ok((select comprobante_pendiente and tipo_comprobante = 'boleta' from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000f1'), 'Boleta sin número: comprobante pendiente');
select is((privado.calcular_caja('ed000000-0000-0000-0000-0000000000f2')).esperado, 0.00::numeric, 'Caja de Almacén: 100 − 70 − 30 = 0');
select is((privado.calcular_caja('ed000000-0000-0000-0000-0000000000f1')).esperado, 230.00::numeric, 'Caja de Recepción: 300 − 100 + 30 = 230');

-- Completar el número después; el monto sigue sin poder cambiarse.
select pg_temp.como('8d000000-0000-0000-0000-000000000001');
update gastos set comprobante = 'B001-4521' where empresa_id = 'a0000000-0000-0000-0000-0000000000f1';
select ok((select not comprobante_pendiente and comprobante = 'B001-4521' from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000f1'), 'Se completa el número y deja de estar pendiente');
select throws_ok($$ update gastos set comprobante = 'B001-9999' where empresa_id = 'a0000000-0000-0000-0000-0000000000f1' $$, '23514', null, 'Ya completo, el número no se cambia');
select throws_ok($$ update gastos set monto = 10 where empresa_id = 'a0000000-0000-0000-0000-0000000000f1' $$, '23514', null, 'El monto nunca se edita');

-- Anular un lado del traspaso anula el otro.
update movimientos_caja set estado = 'anulado', motivo_anulacion = 'Se registró dos veces'
 where empresa_id = 'a0000000-0000-0000-0000-0000000000f1' and clase = 'devolucion_fondo' and caja_id = 'ed000000-0000-0000-0000-0000000000f2';
reset role;
select is((select count(*)::int from movimientos_caja where empresa_id = 'a0000000-0000-0000-0000-0000000000f1' and clase = 'devolucion_fondo' and estado = 'anulado'), 2, 'Anular un lado anula los dos');

-- El dueño puede dar dinero de fuera de las cajas.
select pg_temp.como('8d000000-0000-0000-0000-000000000001');
select isnt(mover_fondo_almacen('a0000000-0000-0000-0000-0000000000f1', 'asignacion', 50, 'externo', '8d000000-0000-0000-0000-000000000001', '8d000000-0000-0000-0000-000000000003'), null, 'El dueño entrega S/ 50 de fuera de las cajas');
reset role;
select is((select count(*)::int from movimientos_caja where empresa_id = 'a0000000-0000-0000-0000-0000000000f1' and clase = 'asignacion_fondo' and monto = 50), 1, 'Solo entra en Almacén (no sale de ninguna caja)');
select * from finish();
rollback;
