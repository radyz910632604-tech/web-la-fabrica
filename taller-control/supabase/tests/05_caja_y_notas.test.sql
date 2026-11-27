-- Caja de recepción, notas de crédito, abonos, devoluciones y rol recepción.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(24);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a5', 'Taller Caja');
insert into auth.users (id, email, raw_app_meta_data) values
  ('50000000-0000-0000-0000-000000000001', 'cg@prueba.invalid', '{"nombre":"Gerencia C","celular":"+51955500101"}'),
  ('50000000-0000-0000-0000-000000000002', 'cr@prueba.invalid', '{"nombre":"Recepcion C","celular":"+51955500102"}'),
  ('50000000-0000-0000-0000-000000000003', 'ct@prueba.invalid', '{"nombre":"Tecnico C","celular":"+51955500103"}'),
  ('50000000-0000-0000-0000-000000000004', 'ca@prueba.invalid', '{"nombre":"Almacen C","celular":"+51955500104"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-000000000002', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-000000000003', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000a5', '50000000-0000-0000-0000-000000000004', 'almacen');
insert into clientes (id, empresa_id, nombre, celular) values ('c5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a5', 'Cliente C', '+51966600001');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a5', 'CAJ123', 'c5000000-0000-0000-0000-000000000001');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id, estado) values
  ('f5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a5', 'd5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'listo');
insert into comprobantes_venta (id, empresa_id, orden_id, tipo, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total) values
  ('b5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a5', 'f5000000-0000-0000-0000-000000000001', 'boleta', 'B001', '50', current_date, 0.18, 254.24, 45.76, 300);

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Recepción ve la orden, su cliente y su carro
select pg_temp.como('50000000-0000-0000-0000-000000000002');
select is((select count(*)::int from ordenes_trabajo), 1, 'Recepción ve las órdenes');
select is((select count(*)::int from clientes), 1, 'Recepción ve a los clientes');
select is((select count(*)::int from vehiculos), 1, 'Recepción ve los carros');
select is((select count(*)::int from compras), 0, 'Recepción no ve compras');
select is((select count(*)::int from costos_personal), 0, 'Recepción no ve sueldos');

-- Abre la caja con S/ 100 de sencillo; no puede abrir dos
select lives_ok($$ insert into cajas (id, empresa_id, monto_inicial) values ('ca500000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a5', 100) $$, 'Recepción abre la caja');
select throws_ok($$ insert into cajas (empresa_id, monto_inicial) values ('a0000000-0000-0000-0000-0000000000a5', 50) $$, '23505', null, 'No hay dos cajas abiertas en el mismo taller');

-- Abonos: el cliente va pagando en partes; cada pago entra solo a la caja abierta
select lives_ok($$
  insert into pagos (empresa_id, orden_id, monto, tipo, medio) values
    ('a0000000-0000-0000-0000-0000000000a5', 'f5000000-0000-0000-0000-000000000001', 100, 'abono', 'efectivo'),
    ('a0000000-0000-0000-0000-0000000000a5', 'f5000000-0000-0000-0000-000000000001', 150, 'abono', 'yape') $$, 'Recepción registra dos abonos');
select is((select count(*)::int from pagos where caja_id = 'ca500000-0000-0000-0000-000000000001'), 2, 'Los abonos quedan en la caja abierta');

-- Gasto menor en efectivo
select lives_ok($$ insert into movimientos_caja (empresa_id, caja_id, tipo, concepto, monto) values ('a0000000-0000-0000-0000-0000000000a5', 'ca500000-0000-0000-0000-000000000001', 'egreso', 'Movilidad para recoger repuesto', 20) $$, 'Registra un gasto de caja');

-- Nota de crédito por descuento de S/ 50; no puede pasar el valor de la boleta
select lives_ok($$ insert into notas_credito (empresa_id, comprobante_id, serie, numero, fecha_emision, motivo_codigo, motivo, tasa_igv, subtotal_sin_igv, igv, total)
  values ('a0000000-0000-0000-0000-0000000000a5', 'b5000000-0000-0000-0000-000000000001', 'BC01', '7', current_date, '04', 'Descuento por demora', 0.18, 42.37, 7.63, 50) $$, 'Recepción registra una nota de crédito');
select is((select orden_id from notas_credito where numero = '7'), 'f5000000-0000-0000-0000-000000000001'::uuid, 'La nota toma la orden de su boleta');
select throws_ok($$ insert into notas_credito (empresa_id, comprobante_id, serie, numero, fecha_emision, motivo_codigo, tasa_igv, subtotal_sin_igv, igv, total)
  values ('a0000000-0000-0000-0000-0000000000a5', 'b5000000-0000-0000-0000-000000000001', 'BC01', '8', current_date, '06', 0.18, 254.24, 45.76, 300) $$,
  '23514', null, 'Las notas no rebajan más que la boleta');
select throws_ok($$ delete from notas_credito $$, '42501', null, 'Una nota de crédito no se borra');

-- Devolución en efectivo de lo pagado de más (pagó 250, ahora debe 250: no hay saldo a favor, se prueba igual)
select lives_ok($$ insert into pagos (empresa_id, orden_id, monto, tipo, medio) values ('a0000000-0000-0000-0000-0000000000a5', 'f5000000-0000-0000-0000-000000000001', 10, 'devolucion', 'efectivo') $$, 'Registra una devolución');

-- Recepción entrega el carro listo, pero no lo devuelve a «en proceso»
select lives_ok($$ select cambiar_estado_orden('f5000000-0000-0000-0000-000000000001', 'entregado') $$, 'Recepción entrega el carro listo');
select throws_ok($$ select cambiar_estado_orden('f5000000-0000-0000-0000-000000000001', 'en_proceso') $$, '42501', null, 'Recepción no reabre órdenes');

-- Cierre: esperado = 100 inicial + 100 efectivo − 20 gasto − 10 devolución = 170; contó 165 → faltan 5
select is((cerrar_caja('ca500000-0000-0000-0000-000000000001', 165, 'Faltó sencillo') ->> 'diferencia')::numeric, -5.00, 'Al cerrar calcula lo esperado y la diferencia');
select is((select (resumen -> 'yape' ->> 'cobros')::numeric from cajas where id = 'ca500000-0000-0000-0000-000000000001'), 150::numeric, 'El resumen separa lo cobrado por Yape');
select throws_ok($$ update cajas set observaciones = 'cambio' where id = 'ca500000-0000-0000-0000-000000000001' $$, '23514', null, 'Una caja cerrada ya no cambia');
select throws_ok($$ insert into movimientos_caja (empresa_id, caja_id, tipo, concepto, monto) values ('a0000000-0000-0000-0000-0000000000a5', 'ca500000-0000-0000-0000-000000000001', 'ingreso', 'Tarde', 5) $$, '23514', null, 'No entran movimientos a una caja cerrada');
select throws_ok($$ update pagos set estado = 'anulado', motivo_anulacion = 'Prueba tarde' where tipo = 'abono' and medio = 'efectivo' $$, '23514', null, 'Un pago de una caja cerrada no se anula');

-- El técnico y almacén no ven la caja ni las notas
select pg_temp.como('50000000-0000-0000-0000-000000000003');
select is((select count(*)::int from cajas) + (select count(*)::int from notas_credito) + (select count(*)::int from pagos), 0, 'El técnico no ve caja, notas ni pagos');
select pg_temp.como('50000000-0000-0000-0000-000000000004');
select is((select count(*)::int from cajas) + (select count(*)::int from notas_credito), 0, 'Almacén no ve la caja ni las notas');

select * from finish();
rollback;
