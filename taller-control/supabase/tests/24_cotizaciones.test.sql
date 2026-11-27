-- Cotizaciones: sueltas, descuento, edición y paso a una orden.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f4', 'Taller Cotiza 2');
insert into auth.users (id, email, raw_app_meta_data) values
  ('90000000-0000-0000-0000-000000000001', 'cq@prueba.invalid', '{"nombre":"Recepción Q","celular":"+51955509101"}'),
  ('90000000-0000-0000-0000-000000000002', 'ct@prueba.invalid', '{"nombre":"Técnico Q","celular":"+51955509102"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f4', '90000000-0000-0000-0000-000000000001', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000f4', '90000000-0000-0000-0000-000000000002', 'tecnico'),
  -- Desde la migración 0030 los descuentos los autoriza gerencia o administración.
  ('a0000000-0000-0000-0000-0000000000f4', '90000000-0000-0000-0000-000000000001', 'administrador');
insert into clientes (id, empresa_id, nombre, celular) values ('cf000000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-0000000000f4', 'Cliente Q', '+51966600611');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('df000000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-0000000000f4', 'QTE123', 'cf000000-0000-0000-0000-0000000000f4');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values ('ff000000-0000-0000-0000-0000000000f4', 'a0000000-0000-0000-0000-0000000000f4', 'df000000-0000-0000-0000-0000000000f4', 'cf000000-0000-0000-0000-0000000000f4');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table t (clave text primary key, id uuid);
grant all on t to authenticated;

select pg_temp.como('90000000-0000-0000-0000-000000000001');
-- Suelta: S/ 380 de servicio, descuento S/ 80 → S/ 300.
insert into t select 's', guardar_cotizacion('a0000000-0000-0000-0000-0000000000f4', null, null,
  '{"nombre":"Juan por teléfono","celular":"+51987000111","placa":"abc123"}'::jsonb,
  '[{"tipo":"servicio","descripcion":"Mantenimiento","cantidad":1,"precio":380,"sin_igv":322.03,"igv":57.97,"total":380}]'::jsonb,
  true, '{"tipo":"monto","valor":80,"motivo":"Cliente frecuente"}'::jsonb);
reset role;
select ok((select orden_id is null and placa = 'ABC123' from cotizaciones where id = (select id from t where clave = 's')), 'Se cotiza sin orden (suelta)');
select is((select total from cotizaciones where id = (select id from t where clave = 's')), 300.00::numeric, 'S/ 380 − S/ 80 de descuento = S/ 300');
select is((select subtotal_sin_igv + igv from cotizaciones where id = (select id from t where clave = 's')), 300.00::numeric, 'El IGV sale del total con descuento');
select isnt((select numero from cotizaciones where id = (select id from t where clave = 's')), null, 'Tiene número correlativo');

select pg_temp.como('90000000-0000-0000-0000-000000000001');
select throws_ok($$ select guardar_cotizacion('a0000000-0000-0000-0000-0000000000f4', null, null, '{"nombre":"X Y"}'::jsonb,
  '[{"tipo":"servicio","descripcion":"Algo","cantidad":1,"precio":100,"sin_igv":100,"igv":0,"total":100}]'::jsonb, false, '{"tipo":"porcentaje","valor":10}'::jsonb) $$, '23514', null, 'El descuento pide motivo');
-- Editar la suelta: 10 % y sin IGV, en el mismo registro.
select is(guardar_cotizacion('a0000000-0000-0000-0000-0000000000f4', (select id from t where clave = 's'), null,
  '{"nombre":"Juan por teléfono","placa":"ABC123"}'::jsonb,
  '[{"tipo":"servicio","descripcion":"Mantenimiento","cantidad":1,"precio":400,"sin_igv":400,"igv":0,"total":400},{"tipo":"repuesto","descripcion":"Filtro","cantidad":2,"precio":50,"sin_igv":100,"igv":0,"total":100}]'::jsonb,
  false, '{"tipo":"porcentaje","valor":10,"motivo":"Promoción"}'::jsonb), (select id from t where clave = 's'), 'La suelta se edita en el mismo registro');
reset role;
select ok((select total = 450 and igv = 0 and descuento = 50 from cotizaciones where id = (select id from t where clave = 's')), 'Sin IGV: 500 − 10 % = 450');

-- De una orden: con descuento, y al editar queda versión nueva.
select pg_temp.como('90000000-0000-0000-0000-000000000001');
insert into t select 'o', guardar_cotizacion('a0000000-0000-0000-0000-0000000000f4', null, 'ff000000-0000-0000-0000-0000000000f4', '{}'::jsonb,
  '[{"tipo":"servicio","descripcion":"Frenos","cantidad":1,"precio":200,"sin_igv":169.49,"igv":30.51,"total":200}]'::jsonb, true, null);
insert into t select 'o2', guardar_cotizacion('a0000000-0000-0000-0000-0000000000f4', (select id from t where clave = 'o'), null, '{}'::jsonb,
  '[{"tipo":"servicio","descripcion":"Frenos","cantidad":1,"precio":200,"sin_igv":169.49,"igv":30.51,"total":200}]'::jsonb, true, '{"tipo":"monto","valor":20,"motivo":"Acuerdo"}'::jsonb);
reset role;
select ok((select estado = 'anulada' from cotizaciones where id = (select id from t where clave = 'o')), 'La de la orden edita como versión nueva (la vieja queda anulada)');
select is((select total from cotizaciones where id = (select id from t where clave = 'o2')), 180.00::numeric, 'Con su descuento: 200 − 20 = 180');

-- Pasar la suelta a la orden.
select pg_temp.como('90000000-0000-0000-0000-000000000001');
select lives_ok($$ select asignar_cotizacion_a_orden((select id from t where clave = 's'), 'ff000000-0000-0000-0000-0000000000f4') $$, 'La suelta pasa a la orden cuando llega el carro');
reset role;
select pg_temp.como('90000000-0000-0000-0000-000000000002');
select is((select count(*)::int from cotizaciones where empresa_id = 'a0000000-0000-0000-0000-0000000000f4'), 0, 'El técnico no ve cotizaciones');
reset role;
select * from finish();
rollback;
