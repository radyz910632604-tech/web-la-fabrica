-- Registro de compras y cotizaciones en un solo paso: respeta los permisos.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a4', 'Taller Registro');
insert into auth.users (id, email, raw_app_meta_data) values
  ('40000000-0000-0000-0000-000000000001', 'rg@prueba.invalid', '{"nombre":"Gerencia R","celular":"+51944400101"}'),
  ('40000000-0000-0000-0000-000000000004', 'ral@prueba.invalid', '{"nombre":"Almacen R","celular":"+51944400104"}'),
  ('40000000-0000-0000-0000-000000000003', 'ras@prueba.invalid', '{"nombre":"Asesor R","celular":"+51944400103"}'),
  ('40000000-0000-0000-0000-000000000005', 'rte@prueba.invalid', '{"nombre":"Tecnico R","celular":"+51944400105"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000004', 'almacen'),
  ('a0000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000003', 'asesor'),
  ('a0000000-0000-0000-0000-0000000000a4', '40000000-0000-0000-0000-000000000005', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('c4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a4', 'Cliente R', '+51955500001');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a4', 'REG123', 'c4000000-0000-0000-0000-000000000001');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values
  ('f4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a4', 'd4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Almacén registra compra con proveedor nuevo y dos líneas (una a la orden, otra a stock)
select pg_temp.como('40000000-0000-0000-0000-000000000004');
select lives_ok($$
  select registrar_compra('a0000000-0000-0000-0000-0000000000a4',
    '{"ruc":"20555555551","razon_social":"Frenos del Sur SAC"}',
    '{"tipo":"factura","serie":"F002","numero":"77","fecha":"2026-11-16","moneda":"PEN","tipo_cambio":1,"tasa_igv":0.18,"sin_igv":150,"igv":27,"total":177}',
    '[{"descripcion":"Pastillas de freno","cantidad":1,"precio_sin_igv":100,"sin_igv":100,"igv":18,"total":118,"orden":"f4000000-0000-0000-0000-000000000001"},
      {"descripcion":"Liquido de frenos","cantidad":2,"precio_sin_igv":25,"sin_igv":50,"igv":9,"total":59}]') $$,
  'Almacén registra una compra completa en un paso');
select is((select count(*)::int from compra_items where destino = 'orden'), 1, 'Una línea quedó asignada a la orden');
select is((select count(*)::int from compra_items where destino = 'stock'), 1, 'La otra quedó en stock');
select lives_ok($$
  select registrar_compra('a0000000-0000-0000-0000-0000000000a4',
    '{"ruc":"20555555551","razon_social":"otro nombre"}',
    '{"tipo":"factura","serie":"F002","numero":"78","fecha":"2026-11-16","moneda":"PEN","tipo_cambio":1,"tasa_igv":0.18,"sin_igv":10,"igv":1.8,"total":11.8}',
    '[{"descripcion":"Grasa","cantidad":1,"precio_sin_igv":10,"sin_igv":10,"igv":1.8,"total":11.8}]') $$,
  'Una segunda compra del mismo RUC');
select is((select count(*)::int from proveedores where ruc = '20555555551'), 1, 'Reutiliza el proveedor por su RUC');

-- El técnico no registra compras: no queda nada a medias
select pg_temp.como('40000000-0000-0000-0000-000000000005');
select throws_ok($$
  select registrar_compra('a0000000-0000-0000-0000-0000000000a4', '{"razon_social":"Proveedor X"}',
    '{"tipo":"boleta","fecha":"2026-11-16","moneda":"PEN","tipo_cambio":1,"tasa_igv":0.18,"sin_igv":10,"igv":1.8,"total":11.8}',
    '[{"descripcion":"Algo","cantidad":1,"precio_sin_igv":10,"sin_igv":10,"igv":1.8,"total":11.8}]') $$,
  '42501', null, 'El técnico no registra compras');

-- El asesor crea cotizaciones con versión automática
select pg_temp.como('40000000-0000-0000-0000-000000000003');
select lives_ok($$
  select crear_cotizacion('f4000000-0000-0000-0000-000000000001', false,
    '[{"tipo":"servicio","descripcion":"Cambio de pastillas","cantidad":1,"precio":118,"sin_igv":100,"igv":18,"total":118},
      {"tipo":"repuesto","descripcion":"Pastillas de freno","cantidad":1,"precio":177,"sin_igv":150,"igv":27,"total":177}]');
  select crear_cotizacion('f4000000-0000-0000-0000-000000000001', true,
    '[{"tipo":"servicio","descripcion":"Rectificado","cantidad":1,"precio":59,"sin_igv":50,"igv":9,"total":59}]') $$,
  'El asesor crea la cotización y un adicional');
select results_eq($$ select version, total from cotizaciones order by version $$,
  $$ values (1, 295.00::numeric), (2, 59.00::numeric) $$, 'Versiones 1 y 2 con sus totales');

-- El técnico no cotiza
select pg_temp.como('40000000-0000-0000-0000-000000000005');
select throws_ok($$
  select crear_cotizacion('f4000000-0000-0000-0000-000000000001', false,
    '[{"tipo":"servicio","descripcion":"Algo","cantidad":1,"precio":10,"sin_igv":8.47,"igv":1.53,"total":10}]') $$,
  null, null, 'El técnico no crea cotizaciones');

select * from finish();
rollback;
