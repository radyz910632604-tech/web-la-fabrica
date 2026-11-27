-- Caja: editar líneas en el panel de cobro, IGV de la orden y devoluciones vinculadas.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(18);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000fa', 'Taller Caja');
insert into auth.users (id, email, raw_app_meta_data) values
  ('94000000-0000-0000-0000-000000000001', 'er@prueba.invalid', '{"nombre":"Recepción E","celular":"+51955540101"}'),
  ('94000000-0000-0000-0000-000000000002', 'eg@prueba.invalid', '{"nombre":"Gerencia E","celular":"+51955540102"}'),
  ('94000000-0000-0000-0000-000000000003', 'et@prueba.invalid', '{"nombre":"Técnico E","celular":"+51955540103"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000fa', '94000000-0000-0000-0000-000000000001', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000fa', '94000000-0000-0000-0000-000000000002', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000fa', '94000000-0000-0000-0000-000000000003', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('c0f00000-0000-0000-0000-0000000000fa', 'a0000000-0000-0000-0000-0000000000fa', 'Cliente E', '+51966600741');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d0f00000-0000-0000-0000-0000000000fa', 'a0000000-0000-0000-0000-0000000000fa', 'EDI123', 'c0f00000-0000-0000-0000-0000000000fa');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values
  ('f0f00000-0000-0000-0000-0000000000fa', 'a0000000-0000-0000-0000-0000000000fa', 'd0f00000-0000-0000-0000-0000000000fa', 'c0f00000-0000-0000-0000-0000000000fa');
create temp table t (clave text primary key, id uuid);
grant all on t to authenticated;

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.cot() returns uuid language sql as $$
  select id from cotizaciones where orden_id = 'f0f00000-0000-0000-0000-0000000000fa' and estado in ('borrador','enviada','aprobada') order by version desc limit 1
$$;

select pg_temp.como('94000000-0000-0000-0000-000000000003');
select throws_ok($$ select editar_lineas_orden('f0f00000-0000-0000-0000-0000000000fa', null, '[{"tipo":"servicio","descripcion":"Mantenimiento preventivo","cantidad":1,"base":380}]') $$, '42501', null, 'El técnico no cambia importes');
reset role;

-- Recepción arma la orden en caja: S/ 380 + S/ 50 sin IGV, con IGV 18 % → S/ 507.40, aprobada en persona.
select pg_temp.como('94000000-0000-0000-0000-000000000001');
select lives_ok($$ select editar_lineas_orden('f0f00000-0000-0000-0000-0000000000fa', null,
  '[{"tipo":"servicio","descripcion":"Mantenimiento preventivo","cantidad":1,"base":380},{"tipo":"servicio","descripcion":"Lavado de motor","cantidad":1,"base":50}]') $$, 'Recepción pone líneas en caja');
reset role;
select is((select subtotal_sin_igv || '|' || igv || '|' || total || '|' || estado from cotizaciones where id = pg_temp.cot()), '430.00|77.40|507.40|aprobada', 'Subtotal 430 + IGV 77.40 = 507.40, aprobada');

-- Edita el precio de una línea: versión nueva, la anterior queda guardada.
select pg_temp.como('94000000-0000-0000-0000-000000000001');
insert into t select 'v1', pg_temp.cot();
select lives_ok($$ select editar_lineas_orden('f0f00000-0000-0000-0000-0000000000fa', pg_temp.cot(),
  '[{"tipo":"servicio","descripcion":"Mantenimiento preventivo","cantidad":1,"base":380},{"tipo":"servicio","descripcion":"Lavado de motor","cantidad":1,"base":40}]') $$, 'Editar precio en línea');
reset role;
select is((select estado from cotizaciones where id = (select id from t where clave = 'v1')), 'anulada', 'La versión anterior queda en el historial');
select is((select total from cotizaciones where id = pg_temp.cot()), 495.60::numeric, 'Nuevo total 420 + 18 % = 495.60');
select is((select total from cotizacion_items where cotizacion_id = pg_temp.cot() and descripcion = 'Mantenimiento preventivo'), 448.40::numeric, 'La línea que no cambió conserva su monto');

-- Quitar el IGV: recepción no; gerencia sí.
select pg_temp.como('94000000-0000-0000-0000-000000000001');
select throws_ok($$ select cambiar_igv_orden('f0f00000-0000-0000-0000-0000000000fa', false) $$, '42501', null, 'Recepción no quita el IGV');
reset role;
select pg_temp.como('94000000-0000-0000-0000-000000000002');
select lives_ok($$ select cambiar_igv_orden('f0f00000-0000-0000-0000-0000000000fa', false) $$, 'Gerencia sí');
reset role;
select is((select total || '|' || tasa_igv from cotizaciones where id = pg_temp.cot()), '420.00|0.0000', 'Sin IGV: total = subtotal 420');
select pg_temp.como('94000000-0000-0000-0000-000000000002');
select cambiar_igv_orden('f0f00000-0000-0000-0000-0000000000fa', true);
reset role;
select is((select total from cotizaciones where id = pg_temp.cot()), 495.60::numeric, 'IGV de vuelta: 495.60');

-- Pagada: recepción ya no cambia importes.
select pg_temp.como('94000000-0000-0000-0000-000000000001');
select registrar_cobro('f0f00000-0000-0000-0000-0000000000fa', gen_random_uuid(), '[{"monto":495.60,"medio":"yape"}]');
select throws_ok($$ select editar_lineas_orden('f0f00000-0000-0000-0000-0000000000fa', pg_temp.cot(),
  '[{"tipo":"servicio","descripcion":"Mantenimiento preventivo","cantidad":1,"base":300}]') $$, '42501', null, 'Pagada: el ajuste es de gerencia');
reset role;

-- Gerencia baja el precio: el cliente queda con saldo a favor → devolución vinculada al pago.
select pg_temp.como('94000000-0000-0000-0000-000000000002');
select editar_lineas_orden('f0f00000-0000-0000-0000-0000000000fa', pg_temp.cot(),
  '[{"tipo":"servicio","descripcion":"Mantenimiento preventivo","cantidad":1,"base":380}]');
reset role;
select pg_temp.como('94000000-0000-0000-0000-000000000001');
select throws_ok($$ select registrar_devolucion((select id from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000fa' and tipo <> 'devolucion'), 100, 'Se cobró el lavado de más') $$,
  '23514', null, 'No devuelve más de lo que tiene a favor (S/ 47.20)');
select lives_ok($$ select registrar_devolucion((select id from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000fa' and tipo <> 'devolucion'), 47.20, 'Se cobró el lavado de más') $$, 'Devuelve lo que tiene a favor');
reset role;
select is((select medio || '|' || (devuelve_pago_id is not null) from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000fa' and tipo = 'devolucion'), 'yape|true', 'La devolución va por el mismo medio y apunta al pago original');
select is((select saldo from privado.cuenta_orden('f0f00000-0000-0000-0000-0000000000fa')), 0.00::numeric, 'Queda en cero');
select is((select string_agg(descripcion, ',' order by descripcion) from orden_servicios where orden_id = 'f0f00000-0000-0000-0000-0000000000fa'), 'Mantenimiento preventivo', 'La lista de trabajos sigue a los servicios con precio (el lavado quitado salió)');
select is(privado.lineas_desde_base(null, '[{"tipo":"servicio","descripcion":"Cambio de aceite","cantidad":1,"precio":120}]', 0.18) -> 0 ->> 'total', '120.00', 'Precio con IGV: se respeta exacto');
select * from finish();
rollback;
