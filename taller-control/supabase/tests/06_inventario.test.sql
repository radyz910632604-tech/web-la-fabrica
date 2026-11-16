-- Inventario: stock que solo se mueve con kardex, costo promedio, compras y permisos.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(22);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a6', 'Taller Inventario'), ('a0000000-0000-0000-0000-0000000000a7', 'Otro Taller');
insert into auth.users (id, email, raw_app_meta_data) values
  ('60000000-0000-0000-0000-000000000001', 'ig@prueba.invalid', '{"nombre":"Gerencia I","celular":"+51955500201"}'),
  ('60000000-0000-0000-0000-000000000002', 'ia@prueba.invalid', '{"nombre":"Almacen I","celular":"+51955500202"}'),
  ('60000000-0000-0000-0000-000000000003', 'is@prueba.invalid', '{"nombre":"Asesor I","celular":"+51955500203"}'),
  ('60000000-0000-0000-0000-000000000004', 'it@prueba.invalid', '{"nombre":"Tecnico I","celular":"+51955500204"}'),
  ('60000000-0000-0000-0000-000000000005', 'io@prueba.invalid', '{"nombre":"Almacen Otro","celular":"+51955500205"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000002', 'almacen'),
  ('a0000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000003', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000a6', '60000000-0000-0000-0000-000000000004', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000a7', '60000000-0000-0000-0000-000000000005', 'almacen');
insert into clientes (id, empresa_id, nombre, celular) values ('c6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a6', 'Cliente I', '+51966600011');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a6', 'INV123', 'c6000000-0000-0000-0000-000000000001');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id, tecnico_id, estado) values
  ('f6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a6', 'd6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000004', 'en_proceso');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Almacén crea el repuesto: empieza en cero aunque intente poner stock
select pg_temp.como('60000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into repuestos (id, empresa_id, codigo, nombre, unidad, stock, stock_minimo, precio_venta_sin_igv)
  values ('e6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a6', 'FIL-ACE-01', 'Filtro de aceite', 'unidad', 99, 3, 25) $$, 'Almacén crea un repuesto');
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 0::numeric, 'Un repuesto nuevo empieza con stock cero');
select throws_ok($$ update repuestos set stock = 10 where codigo = 'FIL-ACE-01' $$, '23514', null, 'El stock no se cambia a mano');
select throws_ok($$ insert into repuestos (empresa_id, codigo, nombre) values ('a0000000-0000-0000-0000-0000000000a6', 'FIL-ACE-01', 'Repetido') $$, '23505', null, 'El código no se repite en el taller');

-- Compra confirmada con dos líneas al inventario: 10 a S/ 12 y 10 a S/ 18 → promedio 15
select lives_ok($$ select registrar_compra('a0000000-0000-0000-0000-0000000000a6',
  '{"ruc":"20000000011","razon_social":"Repuestos Demo SAC"}',
  '{"tipo":"factura","serie":"F001","numero":"10","fecha":"2026-11-10","moneda":"PEN","tipo_cambio":1,"tasa_igv":0.18,"sin_igv":300,"igv":54,"total":354}',
  '[{"descripcion":"Filtro de aceite","cantidad":10,"precio_sin_igv":12,"sin_igv":120,"igv":21.6,"total":141.6,"repuesto":"e6000000-0000-0000-0000-000000000001"},
    {"descripcion":"Filtro de aceite","cantidad":10,"precio_sin_igv":18,"sin_igv":180,"igv":32.4,"total":212.4,"repuesto":"e6000000-0000-0000-0000-000000000001"}]') $$, 'Registra una compra con líneas al inventario');
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 20::numeric, 'La compra confirmada suma 20 al stock');
select is((select costo_promedio_sin_igv from repuestos where codigo = 'FIL-ACE-01'), 15::numeric, 'Costo promedio ponderado sin IGV');

-- Salida a la orden: cuesta al promedio y no puede dejar stock negativo
select lives_ok($$ insert into movimientos_inventario (empresa_id, repuesto_id, tipo, cantidad, orden_id) values
  ('a0000000-0000-0000-0000-0000000000a6', 'e6000000-0000-0000-0000-000000000001', 'salida', -2, 'f6000000-0000-0000-0000-000000000001') $$, 'Entrega 2 filtros a la orden');
select is((select costo_unitario_sin_igv from movimientos_inventario where tipo = 'salida'), 15::numeric, 'La salida vale al costo promedio');
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 18::numeric, 'Quedan 18');
select throws_ok($$ insert into movimientos_inventario (empresa_id, repuesto_id, tipo, cantidad, orden_id) values
  ('a0000000-0000-0000-0000-0000000000a6', 'e6000000-0000-0000-0000-000000000001', 'salida', -50, 'f6000000-0000-0000-0000-000000000001') $$, '23514', null, 'No sale más de lo que hay');
select throws_ok($$ insert into movimientos_inventario (empresa_id, repuesto_id, tipo, cantidad) values
  ('a0000000-0000-0000-0000-0000000000a6', 'e6000000-0000-0000-0000-000000000001', 'ajuste', -1) $$, '23514', null, 'Un ajuste pide motivo');

-- Anular la salida devuelve el stock; no se borra
select lives_ok($$ update movimientos_inventario set estado = 'anulado', motivo_anulacion = 'Se devolvió sin usar' where tipo = 'salida' $$, 'Anula la salida con motivo');
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 20::numeric, 'Anular devuelve el stock');
select throws_ok($$ delete from movimientos_inventario $$, '42501', null, 'El kardex no se borra');

-- Compra leída por IA: no entra al stock hasta que alguien la confirma
select lives_ok($$ select registrar_compra('a0000000-0000-0000-0000-0000000000a6',
  '{"ruc":"20000000011","razon_social":"Repuestos Demo SAC"}',
  '{"tipo":"factura","serie":"F001","numero":"11","fecha":"2026-11-11","moneda":"PEN","tipo_cambio":1,"tasa_igv":0.18,"sin_igv":150,"igv":27,"total":177,"origen":"ia"}',
  '[{"descripcion":"Filtro de aceite","cantidad":10,"precio_sin_igv":15,"sin_igv":150,"igv":27,"total":177,"repuesto":"e6000000-0000-0000-0000-000000000001"}]') $$, 'Registra una compra leída por IA');
select is((select estado::text from compras where numero = '11'), 'por_confirmar', 'Lo leído por IA queda por confirmar');
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 20::numeric, 'Por confirmar no mueve el stock');
select pg_temp.como('60000000-0000-0000-0000-000000000001');
update compras set estado = 'confirmado' where numero = '11';
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 30::numeric, 'Al confirmarla entra al stock');

-- Anular la compra descarga el stock
update compras set estado = 'anulado', motivo_anulacion = 'Factura duplicada' where numero = '11';
select is((select stock from repuestos where codigo = 'FIL-ACE-01'), 20::numeric, 'Anular la compra saca lo que entró');

-- El técnico no ve el inventario; el otro taller tampoco
select pg_temp.como('60000000-0000-0000-0000-000000000004');
select is((select count(*)::int from repuestos) + (select count(*)::int from movimientos_inventario), 0, 'El técnico no ve el inventario');
select pg_temp.como('60000000-0000-0000-0000-000000000005');
select is((select count(*)::int from repuestos), 0, 'Otro taller no ve este inventario');

select * from finish();
rollback;
