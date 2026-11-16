-- Lo leído por IA o llegado por WhatsApp queda por confirmar; archivos de comprobantes por rol.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a8', 'Taller IA');
insert into auth.users (id, email, raw_app_meta_data) values
  ('70000000-0000-0000-0000-000000000001', 'xg@prueba.invalid', '{"nombre":"Gerencia X","celular":"+51955500301"}'),
  ('70000000-0000-0000-0000-000000000002', 'xa@prueba.invalid', '{"nombre":"Almacen X","celular":"+51955500302"}'),
  ('70000000-0000-0000-0000-000000000003', 'xt@prueba.invalid', '{"nombre":"Tecnico X","celular":"+51955500303"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a8', '70000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000a8', '70000000-0000-0000-0000-000000000002', 'almacen'),
  ('a0000000-0000-0000-0000-0000000000a8', '70000000-0000-0000-0000-000000000003', 'tecnico');
insert into proveedores (id, empresa_id, razon_social) values ('b8000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a8', 'Proveedor X');
insert into clientes (id, empresa_id, nombre, celular) values ('c8000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a8', 'Cliente X', '+51966600031');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d8000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a8', 'IAX123', 'c8000000-0000-0000-0000-000000000001');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values ('f8000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a8', 'd8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('70000000-0000-0000-0000-000000000002');
insert into compras (empresa_id, proveedor_id, tipo_comprobante, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total, origen_datos, estado)
values ('a0000000-0000-0000-0000-0000000000a8', 'b8000000-0000-0000-0000-000000000001', 'factura', 'F001', '9', current_date, 0.18, 100, 18, 118, 'ia', 'confirmado');
select is((select estado::text from compras where numero = '9'), 'por_confirmar', 'Una compra leída por IA no entra confirmada aunque se pida');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('comprobantes', 'a0000000-0000-0000-0000-0000000000a8/compras/f001-9.jpg') $$, 'Almacén sube el archivo de una compra');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('comprobantes', 'a0000000-0000-0000-0000-0000000000a8/ventas/b001-1.jpg') $$, '42501', null, 'Almacén no sube archivos de ventas');
select is((select count(*)::int from storage.objects where bucket_id = 'comprobantes'), 1, 'Almacén ve el archivo de su compra');

select pg_temp.como('70000000-0000-0000-0000-000000000001');
insert into comprobantes_venta (empresa_id, orden_id, tipo, serie, numero, fecha_emision, tasa_igv, subtotal_sin_igv, igv, total, origen_datos)
values ('a0000000-0000-0000-0000-0000000000a8', 'f8000000-0000-0000-0000-000000000001', 'boleta', 'B001', '1', current_date, 0.18, 100, 18, 118, 'ia');
select is((select estado::text from comprobantes_venta where numero = '1'), 'por_confirmar', 'Una boleta leída por IA queda por confirmar');
insert into pagos (empresa_id, orden_id, monto, tipo, medio, origen) values ('a0000000-0000-0000-0000-0000000000a8', 'f8000000-0000-0000-0000-000000000001', 50, 'abono', 'yape', 'whatsapp');
select is((select estado::text from pagos where origen = 'whatsapp'), 'por_confirmar', 'Un pago que llega por WhatsApp queda por confirmar');
select lives_ok($$ update comprobantes_venta set estado = 'confirmado' where numero = '1' $$, 'Gerencia confirma la boleta revisada');
select isnt((select confirmado_por from comprobantes_venta where numero = '1'), null, 'Queda quién confirmó');

select pg_temp.como('70000000-0000-0000-0000-000000000003');
select is((select count(*)::int from storage.objects where bucket_id = 'comprobantes'), 0, 'El técnico no ve archivos de comprobantes');

select * from finish();
rollback;
