-- Recepción ve y edita la cotización: la versión vieja queda anulada y a la vista.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(9);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000b9', 'Taller Cotiza');
insert into auth.users (id, email, raw_app_meta_data) values
  ('89000000-0000-0000-0000-000000000001', 'cg@prueba.invalid', '{"nombre":"Gerencia C","celular":"+51955502101"}'),
  ('89000000-0000-0000-0000-000000000002', 'cr@prueba.invalid', '{"nombre":"Sandra","celular":"+51955502102"}'),
  ('89000000-0000-0000-0000-000000000003', 'ct@prueba.invalid', '{"nombre":"Luis","celular":"+51955502103"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000b9', '89000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000b9', '89000000-0000-0000-0000-000000000002', 'recepcion'),
  ('a0000000-0000-0000-0000-0000000000b9', '89000000-0000-0000-0000-000000000003', 'tecnico');
insert into clientes (id, empresa_id, nombre, celular) values ('c9000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'Cliente C', '+51966600211');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d9000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'COT123', 'c9000000-0000-0000-0000-0000000000b9');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values ('f9000000-0000-0000-0000-0000000000b9', 'a0000000-0000-0000-0000-0000000000b9', 'd9000000-0000-0000-0000-0000000000b9', 'c9000000-0000-0000-0000-0000000000b9');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;
create temp table t (clave text primary key, id uuid);
grant all on t to authenticated;

-- Recepción crea la cotización y el cliente la aprueba.
select pg_temp.como('89000000-0000-0000-0000-000000000002');
insert into t select 'v1', crear_cotizacion('f9000000-0000-0000-0000-0000000000b9', false,
  '[{"tipo":"servicio","descripcion":"Cambio de aceite","cantidad":1,"precio":118,"sin_igv":100,"igv":18,"total":118}]'::jsonb, true);
update cotizaciones set estado = 'aprobada', respuesta_en = now(), aprobada_por_medio = 'presencial' where id = (select id from t where clave = 'v1');
select ok((select estado = 'aprobada' from cotizaciones where id = (select id from t where clave = 'v1')), 'Recepción crea y marca aprobada');

-- Recepción la edita: sube el precio.
insert into t select 'v2', editar_cotizacion((select id from t where clave = 'v1'),
  '[{"tipo":"servicio","descripcion":"Cambio de aceite","cantidad":1,"precio":118,"sin_igv":100,"igv":18,"total":118},{"tipo":"repuesto","descripcion":"Filtro","cantidad":1,"precio":59,"sin_igv":50,"igv":9,"total":59}]'::jsonb, true);
reset role;
select is((select estado::text from cotizaciones where id = (select id from t where clave = 'v1')), 'anulada', 'La versión vieja queda anulada');
select ok((select respuesta_texto like 'Reemplazada por la versión 2%' from cotizaciones where id = (select id from t where clave = 'v1')), 'Y dice por cuál fue reemplazada');
select is((select estado::text from cotizaciones where id = (select id from t where clave = 'v2')), 'aprobada', 'La nueva sigue aprobada');
select is((select total from cotizaciones where id = (select id from t where clave = 'v2')), 177.00::numeric, 'Con el total nuevo');
select is((select reemplaza_id from cotizaciones where id = (select id from t where clave = 'v2')), (select id from t where clave = 'v1'), 'Sabe a cuál reemplaza');

-- El técnico no edita.
select pg_temp.como('89000000-0000-0000-0000-000000000003');
select throws_ok($$ select editar_cotizacion((select id from t where clave = 'v2'), '[{"tipo":"servicio","descripcion":"X","cantidad":1,"precio":1,"sin_igv":1,"igv":0,"total":1}]'::jsonb, false) $$, null, null, 'El técnico no edita cotizaciones');
reset role;

-- No se edita una versión anulada.
select pg_temp.como('89000000-0000-0000-0000-000000000002');
select throws_ok($$ select editar_cotizacion((select id from t where clave = 'v1'), '[{"tipo":"servicio","descripcion":"X","cantidad":1,"precio":1,"sin_igv":1,"igv":0,"total":1}]'::jsonb, false) $$, null, null, 'Una versión anulada no se edita');
reset role;

-- Con recibo emitido ya no se edita.
insert into recibos (empresa_id, orden_id, numero, tasa_igv, subtotal_sin_igv, igv, total)
values ('a0000000-0000-0000-0000-0000000000b9', 'f9000000-0000-0000-0000-0000000000b9', 1, 0.18, 150, 27, 177);
select pg_temp.como('89000000-0000-0000-0000-000000000002');
select throws_ok($$ select editar_cotizacion((select id from t where clave = 'v2'), '[{"tipo":"servicio","descripcion":"X","cantidad":1,"precio":1,"sin_igv":1,"igv":0,"total":1}]'::jsonb, false) $$, null, null, 'Con recibo ya no se edita');
reset role;
select * from finish();
rollback;
