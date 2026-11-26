-- Salidas de caja con categoría: el gasto del taller se anota solo y se anula con la caja.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(6);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a7', 'Taller Caja Gasto');
insert into auth.users (id, email, raw_app_meta_data) values
  ('86000000-0000-0000-0000-000000000002', 'cr@prueba.invalid', '{"nombre":"Recepcion C","celular":"+51955501002"}');
insert into miembros (empresa_id, perfil_id, rol) values ('a0000000-0000-0000-0000-0000000000a7', '86000000-0000-0000-0000-000000000002', 'recepcion');
insert into cajas (id, empresa_id, monto_inicial) values ('ca000000-0000-0000-0000-0000000000a7', 'a0000000-0000-0000-0000-0000000000a7', 100);

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('86000000-0000-0000-0000-000000000002');
select lives_ok($$ insert into movimientos_caja (id, empresa_id, caja_id, tipo, concepto, monto, categoria_gasto) values ('ab000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a7', 'ca000000-0000-0000-0000-0000000000a7', 'egreso', 'Movilidad para recoger repuesto', 15, 'movilidad') $$, 'Recepción saca plata de caja como gasto de movilidad');
select lives_ok($$ insert into movimientos_caja (empresa_id, caja_id, tipo, concepto, monto) values ('a0000000-0000-0000-0000-0000000000a7', 'ca000000-0000-0000-0000-0000000000a7', 'egreso', 'Retiro de gerencia', 50) $$, 'Un retiro sin categoría también se registra');
select throws_ok($$ insert into movimientos_caja (empresa_id, caja_id, tipo, concepto, monto, categoria_gasto) values ('a0000000-0000-0000-0000-0000000000a7', 'ca000000-0000-0000-0000-0000000000a7', 'ingreso', 'Sencillo', 20, 'otros') $$, '23514', null, 'Un ingreso no puede ser gasto');

reset role;
select is((select count(*)::int from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000a7' and categoria = 'movilidad' and monto = 15 and estado = 'confirmado'), 1, 'El gasto de movilidad se anotó solo (y el retiro no)');

select pg_temp.como('86000000-0000-0000-0000-000000000002');
update movimientos_caja set estado = 'anulado', motivo_anulacion = 'Lo anoté dos veces' where id = 'ab000000-0000-0000-0000-0000000000a1';
reset role;
select is((select estado::text from gastos where movimiento_caja_id = 'ab000000-0000-0000-0000-0000000000a1'), 'anulado', 'Al anularlo en la caja, el gasto queda anulado');
select is((select count(*)::int from gastos where empresa_id = 'a0000000-0000-0000-0000-0000000000a7'), 1, 'No hay gastos de más');

select * from finish();
