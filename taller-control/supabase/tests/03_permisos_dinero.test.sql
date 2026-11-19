-- Pruebas del dinero (Fases 3 y 4): quién ve compras, ventas, pagos y sueldos, y que nada se borre.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(20);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a3', 'Taller Dinero');
insert into auth.users (id, email, raw_app_meta_data) values
  ('30000000-0000-0000-0000-000000000001', 'dg@prueba.invalid', '{"nombre":"Gerencia D","celular":"+51933300001"}'),
  ('30000000-0000-0000-0000-000000000002', 'dad@prueba.invalid', '{"nombre":"Admin D","celular":"+51933300002"}'),
  ('30000000-0000-0000-0000-000000000003', 'das@prueba.invalid', '{"nombre":"Asesor D","celular":"+51933300003"}'),
  ('30000000-0000-0000-0000-000000000004', 'dal@prueba.invalid', '{"nombre":"Almacen D","celular":"+51933300004"}'),
  ('30000000-0000-0000-0000-000000000005', 'dte@prueba.invalid', '{"nombre":"Tecnico D","celular":"+51933300005"}'),
  ('30000000-0000-0000-0000-000000000006', 'dve@prueba.invalid', '{"nombre":"Vendedor D","celular":"+51933300006"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000002', 'administrador'),
  ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000003', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000004', 'almacen'),
  ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000005', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000006', 'vendedor_redes');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

insert into clientes (id, empresa_id, nombre, celular) values ('c3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a3', 'Cliente D', '+51944400001');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a3', 'DIN123', 'c3000000-0000-0000-0000-000000000001');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id) values
  ('f3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a3', 'd3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000005');
insert into proveedores (id, empresa_id, razon_social, ruc) values ('e3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a3', 'Repuestos Lima SAC', '20123456789');
insert into costos_personal (empresa_id, perfil_id, costo_mensual) values ('a0000000-0000-0000-0000-0000000000a3', '30000000-0000-0000-0000-000000000005', 2500);

-- Almacén registra una compra para la orden
select pg_temp.como('30000000-0000-0000-0000-000000000004');
select lives_ok($$
  insert into compras (id, empresa_id, proveedor_id, tipo_comprobante, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total)
  values ('a3000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a3', 'e3000000-0000-0000-0000-000000000001', 'factura', 'F001', '123', current_date, 0.18, 100, 18, 118) $$,
  'Almacén registra una compra');
select lives_ok($$
  insert into compra_items (empresa_id, compra_id, descripcion, cantidad, precio_unitario_sin_igv, subtotal_sin_igv, igv, total, destino, orden_id)
  values ('a0000000-0000-0000-0000-0000000000a3', 'a3000000-0000-0000-0000-0000000000c1', 'Kit de embrague', 1, 100, 100, 18, 118, 'orden', 'f3000000-0000-0000-0000-000000000001') $$,
  'Almacén asigna el repuesto al carro');
select throws_ok($$
  insert into compras (empresa_id, proveedor_id, tipo_comprobante, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total)
  values ('a0000000-0000-0000-0000-0000000000a3', 'e3000000-0000-0000-0000-000000000001', 'factura', 'F001', '123', current_date, 0.18, 100, 18, 118) $$,
  '23505', null, 'No se registra dos veces el mismo comprobante del proveedor');
select is((select count(*)::int from comprobantes_venta), 0, 'Almacén no ve ventas');
select is((select count(*)::int from pagos), 0, 'Almacén no ve pagos');
select is((select count(*)::int from costos_personal), 0, 'Almacén no ve sueldos');
reset role;

-- Asesor: comprobante y pagos
select pg_temp.como('30000000-0000-0000-0000-000000000003');
select lives_ok($$
  insert into comprobantes_venta (empresa_id, orden_id, tipo, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total)
  values ('a0000000-0000-0000-0000-0000000000a3', 'f3000000-0000-0000-0000-000000000001', 'boleta', 'B001', '45', current_date, 0.18, 254.24, 45.76, 300) $$,
  'El asesor registra la boleta');
select lives_ok($$
  insert into pagos (id, empresa_id, orden_id, monto, tipo, medio) values
  ('b3000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a3', 'f3000000-0000-0000-0000-000000000001', 100, 'adelanto', 'yape') $$,
  'El asesor registra un adelanto por Yape');
select throws_ok($$ insert into compras (empresa_id, proveedor_id, tipo_comprobante, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total)
  values ('a0000000-0000-0000-0000-0000000000a3', 'e3000000-0000-0000-0000-000000000001', 'sin_comprobante', current_date, 0.18, 10, 1.8, 11.8) $$,
  '42501', null, 'El asesor no registra compras');
select is((select count(*)::int from compras), 1, 'El asesor ve las compras (para cotizar)');
select is((select count(*)::int from costos_personal), 0, 'El asesor no ve sueldos');
select throws_ok($$ delete from pagos $$, '42501', null, 'Un pago no se borra');
select throws_ok($$ update pagos set monto = 150 where id = 'b3000000-0000-0000-0000-0000000000a1' $$, '23514', null, 'Un pago confirmado no se edita');
select throws_ok($$ update pagos set estado = 'anulado' where id = 'b3000000-0000-0000-0000-0000000000a1' $$, '23514', null, 'Anular pide motivo');
select lives_ok($$ update pagos set estado = 'anulado', motivo_anulacion = 'Se registró dos veces' where id = 'b3000000-0000-0000-0000-0000000000a1' $$, 'Se anula con motivo');
select throws_ok($$ update pagos set estado = 'confirmado' where id = 'b3000000-0000-0000-0000-0000000000a1' $$, '23514', null, 'Un pago anulado ya no cambia');
reset role;

-- Técnico y ventas por redes no ven dinero
select pg_temp.como('30000000-0000-0000-0000-000000000005');
select is((select count(*)::int from compras) + (select count(*)::int from comprobantes_venta) + (select count(*)::int from pagos), 0, 'El técnico no ve precios ni costos');
reset role;
select pg_temp.como('30000000-0000-0000-0000-000000000006');
select is((select count(*)::int from compras), 0, 'Ventas por redes no ve costos');
reset role;

-- Sueldos: administración solo si gerencia lo permite
select pg_temp.como('30000000-0000-0000-0000-000000000002');
select is((select count(*)::int from costos_personal), 0, 'Administración no ve sueldos por defecto');
reset role;
select pg_temp.como('30000000-0000-0000-0000-000000000001');
update configuracion_empresa set admin_ve_sueldos = true where empresa_id = 'a0000000-0000-0000-0000-0000000000a3';
reset role;
select pg_temp.como('30000000-0000-0000-0000-000000000002');
select is((select count(*)::int from costos_personal), 1, 'Administración ve sueldos cuando gerencia lo permite');
reset role;

select * from finish();
rollback;
