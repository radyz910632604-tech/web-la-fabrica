-- Cajas de Recepción y Almacén, cierre automático de medianoche y Caja Maestra.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(18);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000e1', 'Taller Cajas');
insert into auth.users (id, email, raw_app_meta_data) values
  ('8c000000-0000-0000-0000-000000000001', 'xg@prueba.invalid', '{"nombre":"Dueño X","celular":"+51955505101"}'),
  ('8c000000-0000-0000-0000-000000000002', 'xr@prueba.invalid', '{"nombre":"Recepción X","celular":"+51955505102"}'),
  ('8c000000-0000-0000-0000-000000000003', 'xa@prueba.invalid', '{"nombre":"Almacén X","celular":"+51955505103"}'),
  ('8c000000-0000-0000-0000-000000000004', 'xs@prueba.invalid', '{"nombre":"Asesor X","celular":"+51955505104"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000e1', '8c000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000e1', '8c000000-0000-0000-0000-000000000002', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000e1', '8c000000-0000-0000-0000-000000000003', 'almacen'),
  ('a0000000-0000-0000-0000-0000000000e1', '8c000000-0000-0000-0000-000000000004', 'asesor');
insert into clientes (id, empresa_id, nombre, celular) values ('cc000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'Cliente X', '+51966600511');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('dc000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'CAJ123', 'cc000000-0000-0000-0000-0000000000e1');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values ('fc000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'dc000000-0000-0000-0000-0000000000e1', 'cc000000-0000-0000-0000-0000000000e1');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

-- Cada área abre su caja.
select pg_temp.como('8c000000-0000-0000-0000-000000000002');
insert into cajas (id, empresa_id, tipo_caja, monto_inicial) values ('ec000000-0000-0000-0000-0000000000e1', 'a0000000-0000-0000-0000-0000000000e1', 'recepcion', 100);
select throws_ok($$ insert into cajas (empresa_id, tipo_caja, monto_inicial) values ('a0000000-0000-0000-0000-0000000000e1', 'almacen', 50) $$, '42501', null, 'Recepción no abre la caja de Almacén');
insert into pagos (empresa_id, orden_id, monto, tipo, medio) values ('a0000000-0000-0000-0000-0000000000e1', 'fc000000-0000-0000-0000-0000000000e1', 80, 'adelanto', 'efectivo');
insert into pagos (empresa_id, orden_id, monto, tipo, medio) values ('a0000000-0000-0000-0000-0000000000e1', 'fc000000-0000-0000-0000-0000000000e1', 50, 'abono', 'yape');
reset role;
select pg_temp.como('8c000000-0000-0000-0000-000000000003');
insert into cajas (id, empresa_id, tipo_caja, monto_inicial) values ('ec000000-0000-0000-0000-0000000000e2', 'a0000000-0000-0000-0000-0000000000e1', 'almacen', 50);
select is((select count(*)::int from cajas where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 1, 'Almacén solo ve su caja');
insert into movimientos_caja (empresa_id, caja_id, tipo, concepto, monto, medio, categoria_gasto) values ('a0000000-0000-0000-0000-0000000000e1', 'ec000000-0000-0000-0000-0000000000e2', 'egreso', 'Trapos y grasa', 20, 'efectivo', 'limpieza');
reset role;
select is((select caja_id from pagos where monto = 80 and empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 'ec000000-0000-0000-0000-0000000000e1'::uuid, 'Los cobros entran a la caja de Recepción');
select is((select count(*)::int from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 1, 'El gasto de Almacén está una vez en Gastos');

-- Almacén cierra con su conteo: le faltan S/ 2.
select pg_temp.como('8c000000-0000-0000-0000-000000000003');
select is((cerrar_caja('ec000000-0000-0000-0000-0000000000e2', 28) ->> 'diferencia')::numeric, -2.00::numeric, 'Almacén cierra la suya: faltan S/ 2');
reset role;

-- Recepción se olvida de cerrar. A medianoche...
select pg_temp.como('8c000000-0000-0000-0000-000000000001');
select throws_ok($$ select corte_medianoche('a0000000-0000-0000-0000-0000000000e1', (now() at time zone 'America/Lima')::date + 1) $$, '42501', null, 'Ni el dueño lanza el corte de medianoche a mano');
reset role;
set local role service_role;
select is((corte_medianoche('a0000000-0000-0000-0000-0000000000e1', (now() at time zone 'America/Lima')::date + 1) ->> 'cerradas')::int, 1, 'El corte cierra la caja olvidada');
reset role;
select is((select tipo_cierre from cajas where id = 'ec000000-0000-0000-0000-0000000000e1'), 'automatico_00h', 'Queda como cierre automático');
select ok((select requiere_arqueo and efectivo_contado is null and efectivo_esperado = 180 from cajas where id = 'ec000000-0000-0000-0000-0000000000e1'), 'Con el saldo del sistema (S/ 180) y arqueo pendiente');

select is((select efectivo_neto from caja_maestra_diaria where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 208.00::numeric, 'Maestra: efectivo neto = 180 (sistema) + 28 (contado)');
select is((select yape_plin from caja_maestra_diaria where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 50.00::numeric, 'Maestra: Yape/Plin S/ 50');
select is((select egresos_gastos from caja_maestra_diaria where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 20.00::numeric, 'Maestra: egresos que están en Gastos');
select ok((select requiere_arqueo and cierres_automaticos = 1 from caja_maestra_diaria where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 'Maestra: avisa el cierre automático');

-- Solo el dueño y administración la ven.
select pg_temp.como('8c000000-0000-0000-0000-000000000004');
select is((select count(*)::int from caja_maestra_diaria), 0, 'El asesor no ve la Caja Maestra');
reset role;
select pg_temp.como('8c000000-0000-0000-0000-000000000002');
select throws_ok($$ select registrar_arqueo('ec000000-0000-0000-0000-0000000000e1', 175) $$, '42501', null, 'Recepción no registra el arqueo pendiente');
reset role;

-- El dueño cuenta: hay S/ 175 (faltan 5). La maestra se rehace.
select pg_temp.como('8c000000-0000-0000-0000-000000000001');
select is((registrar_arqueo('ec000000-0000-0000-0000-0000000000e1', 175) ->> 'diferencia')::numeric, -5.00::numeric, 'El dueño registra el arqueo');
select ok((select not requiere_arqueo and efectivo_neto = 203 and diferencia = -7 from caja_maestra_diaria where empresa_id = 'a0000000-0000-0000-0000-0000000000e1'), 'Maestra al día: S/ 203 y faltante total S/ 7');
reset role;

-- Al día siguiente se abre sin problema.
select pg_temp.como('8c000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into cajas (empresa_id, tipo_caja, monto_inicial) values ('a0000000-0000-0000-0000-0000000000e1', 'recepcion', 100) $$, 'La caja del día siguiente abre normal');
reset role;
select * from finish();
rollback;
