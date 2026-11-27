-- WhatsApp: auditoría solo del servidor, borradores de cada persona, pagos a la caja al confirmar.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(10);

insert into empresas (id, nombre) values ('a0000000-0000-0000-0000-0000000000a9', 'Taller WhatsApp');
insert into auth.users (id, email, raw_app_meta_data) values
  ('80000000-0000-0000-0000-000000000001', 'wg@prueba.invalid', '{"nombre":"Gerencia W","celular":"+51955500401"}'),
  ('80000000-0000-0000-0000-000000000002', 'wt@prueba.invalid', '{"nombre":"Tecnico W","celular":"+51955500402"}'),
  ('80000000-0000-0000-0000-000000000003', 'wr@prueba.invalid', '{"nombre":"Recepcion W","celular":"+51955500403"}');
insert into miembros (empresa_id, perfil_id, rol) values
  ('a0000000-0000-0000-0000-0000000000a9', '80000000-0000-0000-0000-000000000001', 'gerencia'),
  ('a0000000-0000-0000-0000-0000000000a9', '80000000-0000-0000-0000-000000000002', 'tecnico'),
  ('a0000000-0000-0000-0000-0000000000a9', '80000000-0000-0000-0000-000000000003', 'recepcion');
insert into mensajes_whatsapp (empresa_id, wa_id, celular, tipo, texto, resultado) values ('a0000000-0000-0000-0000-0000000000a9', 'wamid.t1', '+51955500402', 'texto', 'ABC123 listo', 'borrador');
insert into clientes (id, empresa_id, nombre, celular) values ('c9000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a9', 'Cliente W', '+51966600041');
insert into vehiculos (id, empresa_id, placa, cliente_id) values ('d9000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a9', 'WSP123', 'c9000000-0000-0000-0000-000000000001');
insert into ordenes_trabajo (id, empresa_id, vehiculo_id, cliente_id) values ('f9000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a9', 'd9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000001');

create function pg_temp.como(p uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
$$;

select throws_ok($$ update mensajes_whatsapp set texto = 'otra cosa' where wa_id = 'wamid.t1' $$, '23514', null, 'Lo que llegó por WhatsApp no se edita');
select throws_ok($$ delete from mensajes_whatsapp $$, '42501', null, 'La auditoría de WhatsApp no se borra');

select pg_temp.como('80000000-0000-0000-0000-000000000002');
select is((select count(*)::int from mensajes_whatsapp), 0, 'El técnico no lee la auditoría');
select throws_ok($$ insert into mensajes_whatsapp (wa_id, celular, tipo) values ('wamid.x', '+51955500402', 'texto') $$, '42501', null, 'Nadie escribe la auditoría desde la app');
select lives_ok($$ insert into borradores_whatsapp (empresa_id, perfil_id, intencion, datos) values ('a0000000-0000-0000-0000-0000000000a9', '80000000-0000-0000-0000-000000000002', 'avance', '{}') $$, 'El técnico crea su borrador');
select throws_ok($$ insert into borradores_whatsapp (empresa_id, perfil_id, intencion) values ('a0000000-0000-0000-0000-0000000000a9', '80000000-0000-0000-0000-000000000001', 'pago') $$, '42501', null, 'Nadie crea borradores a nombre de otro');

select pg_temp.como('80000000-0000-0000-0000-000000000001');
select is((select count(*)::int from mensajes_whatsapp), 1, 'Gerencia lee la auditoría de su taller');

-- Pago por WhatsApp: por confirmar, sin caja; al confirmarlo entra a la caja abierta
select pg_temp.como('80000000-0000-0000-0000-000000000003');
insert into cajas (id, empresa_id, monto_inicial) values ('ca900000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a9', 50);
insert into pagos (id, empresa_id, orden_id, monto, tipo, medio, origen) values ('e9000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a9', 'f9000000-0000-0000-0000-000000000001', 40, 'abono', 'efectivo', 'whatsapp');
select is((select caja_id from pagos where id = 'e9000000-0000-0000-0000-000000000001'), null, 'Un pago por confirmar no entra a la caja');
update pagos set estado = 'confirmado' where id = 'e9000000-0000-0000-0000-000000000001';
select is((select caja_id from pagos where id = 'e9000000-0000-0000-0000-000000000001'), 'ca900000-0000-0000-0000-000000000001'::uuid, 'Al confirmarlo entra a la caja abierta');
select is((cerrar_caja('ca900000-0000-0000-0000-000000000001', 90) ->> 'diferencia')::numeric, 0::numeric, 'El arqueo lo cuenta: 50 + 40 = 90');

select * from finish();
rollback;
