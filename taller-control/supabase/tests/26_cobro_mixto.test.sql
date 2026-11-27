-- Cobro mixto: varios medios a la vez, todo o nada, sin duplicar y sin cobrar de más.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(14);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000f7', 'Taller Cobro');
insert into auth.users (id, email, raw_app_meta_data) values
  ('92000000-0000-0000-0000-000000000001', 'cr@prueba.invalid', '{"nombre":"Recepción C","celular":"+51955520101"}'),
  ('92000000-0000-0000-0000-000000000002', 'ct@prueba.invalid', '{"nombre":"Técnico C","celular":"+51955520102"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000f7', '92000000-0000-0000-0000-000000000001', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000f7', '92000000-0000-0000-0000-000000000002', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('c0f00000-0000-0000-0000-0000000000f7', 'a0000000-0000-0000-0000-0000000000f7', 'Cliente C', '+51966600721');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d0f00000-0000-0000-0000-0000000000f7', 'a0000000-0000-0000-0000-0000000000f7', 'COB123', 'c0f00000-0000-0000-0000-0000000000f7');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values
  ('f0f00000-0000-0000-0000-0000000000f7', 'a0000000-0000-0000-0000-0000000000f7', 'd0f00000-0000-0000-0000-0000000000f7', 'c0f00000-0000-0000-0000-0000000000f7'),
  ('f0f00000-0000-0000-0000-0000000000f8', 'a0000000-0000-0000-0000-0000000000f7', 'd0f00000-0000-0000-0000-0000000000f7', 'c0f00000-0000-0000-0000-0000000000f7');
-- Orden de S/ 500 (cotización aprobada).
insert into cotizaciones (empresa_id, orden_id, version, estado, tasa_igv, subtotal_sin_igv, igv, total)
values ('a0000000-0000-0000-0000-0000000000f7', 'f0f00000-0000-0000-0000-0000000000f7', 1, 'aprobada', 0.18, 423.73, 76.27, 500);

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select pg_temp.como('92000000-0000-0000-0000-000000000002');
select throws_ok($$ select registrar_cobro('f0f00000-0000-0000-0000-0000000000f7', gen_random_uuid(), '[{"monto":100,"medio":"efectivo"}]') $$, '42501', null, 'El técnico no cobra');
reset role;

select pg_temp.como('92000000-0000-0000-0000-000000000001');
select throws_ok($$ select registrar_cobro('f0f00000-0000-0000-0000-0000000000f7', gen_random_uuid(), '[{"monto":400,"medio":"yape"},{"monto":200,"medio":"efectivo"}]') $$, '23514', null, 'No cobra más de lo que falta');
select throws_ok($$ select registrar_cobro('f0f00000-0000-0000-0000-0000000000f7', gen_random_uuid(), '[{"monto":100,"medio":"yape"},{"monto":0,"medio":"efectivo"}]') $$, '22023', null, 'Un monto en cero frena todo el cobro');
select is((select count(*)::int from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000f7'), 0, 'Todo o nada: nada quedó a medias');

-- Pago parcial: S/ 200 en Yape → queda S/ 300.
select is((registrar_cobro('f0f00000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-000000000001', '[{"monto":200,"medio":"yape","operacion":"123456"}]') ->> 'saldo')::numeric, 300.00, 'Parcial: saldo de S/ 300');
-- El mismo cobro llega dos veces (doble clic): no se duplica.
select ok((registrar_cobro('f0f00000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-000000000001', '[{"monto":200,"medio":"yape"}]') ->> 'repetido')::boolean, 'El cobro repetido se reconoce');
select is((select count(*)::int from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000f7'), 1, 'Y no se registra dos veces');

-- Pago mixto que completa: S/ 200 efectivo + S/ 100 transferencia.
select is((registrar_cobro('f0f00000-0000-0000-0000-0000000000f7', 'a1000000-0000-0000-0000-000000000002', '[{"monto":200,"medio":"efectivo"},{"monto":100,"medio":"transferencia","operacion":"OP-77"}]') ->> 'saldo')::numeric, 0.00, 'Mixto: queda pagada');
reset role;
select is((select count(*)::int from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000f7' and estado = 'confirmado'), 3, 'Tres movimientos, uno por medio');
select ok((select bool_and(creado_por = '92000000-0000-0000-0000-000000000001') from pagos where orden_id = 'f0f00000-0000-0000-0000-0000000000f7'), 'Cada pago guarda quién lo cobró');
select is((select tipo from pagos where cobro_id = 'a1000000-0000-0000-0000-000000000002' limit 1), 'saldo', 'El que completa queda como saldo');

-- Orden sin precio todavía: lo que entre es adelanto.
select pg_temp.como('92000000-0000-0000-0000-000000000001');
select is(registrar_cobro('f0f00000-0000-0000-0000-0000000000f8', gen_random_uuid(), '[{"monto":50,"medio":"plin"}]') ->> 'tipo', 'adelanto', 'Sin precio aún: adelanto');
reset role;

-- Descuento: recepción no lo pone; gerencia sí.
insert into miembros (empresa_id, perfil_id, rol) values ('a0000000-0000-0000-0000-0000000000f7', '92000000-0000-0000-0000-000000000002', 'administrador');
select pg_temp.como('92000000-0000-0000-0000-000000000001');
select throws_ok($$ select guardar_cotizacion('a0000000-0000-0000-0000-0000000000f7', null, 'f0f00000-0000-0000-0000-0000000000f8', null,
  '[{"tipo":"servicio","descripcion":"Cambio de aceite","cantidad":1,"precio":120,"sin_igv":101.69,"igv":18.31,"total":120}]', true, '{"tipo":"monto","valor":20,"motivo":"Cliente frecuente"}') $$,
  '42501', null, 'Recepción no autoriza descuentos');
reset role;
select pg_temp.como('92000000-0000-0000-0000-000000000002');
select lives_ok($$ select guardar_cotizacion('a0000000-0000-0000-0000-0000000000f7', null, 'f0f00000-0000-0000-0000-0000000000f8', null,
  '[{"tipo":"servicio","descripcion":"Cambio de aceite","cantidad":1,"precio":120,"sin_igv":101.69,"igv":18.31,"total":120}]', true, '{"tipo":"monto","valor":20,"motivo":"Cliente frecuente"}') $$,
  'Administración sí');
reset role;
select * from finish();
rollback;
