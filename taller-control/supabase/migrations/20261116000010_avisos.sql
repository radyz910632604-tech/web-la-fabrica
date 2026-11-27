-- =====================================================================
-- 0010 · Avisos (5.9 y Fase 4)
--
-- * Canal por tipo de aviso (push del celular, WhatsApp, ambos o apagado),
--   para controlar el costo de WhatsApp.
-- * Registro de cada aviso: se arma en la base (o en la API) y lo envía la
--   app (push) o n8n (WhatsApp). Una clave única evita avisos repetidos.
-- * Al cliente solo se le escribe si aceptó recibir mensajes.
-- * Carro listo, recordatorios de mantenimiento (por fecha o kilometraje),
--   encuesta de satisfacción y cotización con aprobación por WhatsApp.
-- =====================================================================

create table public.config_avisos (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null check (tipo in ('resumen_mediodia', 'resumen_cierre', 'citas_del_dia', 'cita_no_llego', 'carro_listo', 'recordatorio_mantenimiento', 'encuesta', 'cotizacion')),
  canal text not null check (canal in ('push', 'whatsapp', 'ambos', 'apagado')),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  primary key (empresa_id, tipo)
);

-- Canal de un tipo de aviso (por defecto: push al personal, WhatsApp al cliente).
create function privado.canal_aviso(p_empresa uuid, p_tipo text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select canal from public.config_avisos where empresa_id = p_empresa and tipo = p_tipo),
    case when p_tipo in ('carro_listo', 'recordatorio_mantenimiento', 'encuesta', 'cotizacion') then 'whatsapp' else 'push' end
  );
$$;

create table public.avisos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  tipo text not null,
  destino text not null check (destino in ('personal', 'cliente')),
  perfil_id uuid references public.perfiles (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete cascade,
  celular text,
  canal text not null check (canal in ('push', 'whatsapp')),
  titulo text not null,
  texto text not null check (char_length(texto) <= 4000),
  enlace text,
  -- Plantilla aprobada por Meta y sus variables, para mensajes que inicia el negocio.
  plantilla text,
  variables jsonb not null default '[]'::jsonb,
  botones jsonb not null default '[]'::jsonb,
  ref_id uuid,
  clave_unica text not null unique,
  programado_para timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido', 'omitido')),
  intentos integer not null default 0,
  enviado_en timestamptz,
  error text,
  creado_en timestamptz not null default now()
);
create index avisos_pendientes on public.avisos (canal, programado_para) where estado = 'pendiente';
create index avisos_empresa on public.avisos (empresa_id, creado_en desc);

-- Encuesta de satisfacción (una por orden entregada).
create table public.encuestas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null unique references public.ordenes_trabajo (id) on delete cascade,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  puntaje smallint check (puntaje between 1 and 5),
  comentario text check (comentario is null or char_length(comentario) <= 1000),
  respondida_en timestamptz,
  creado_en timestamptz not null default now()
);

-- Recordatorios de mantenimiento: por fecha y, si se sabe, kilometraje.
alter table public.catalogo_servicios add column meses_recordatorio integer check (meses_recordatorio is null or meses_recordatorio between 1 and 36);
alter table public.catalogo_servicios add column km_recordatorio integer check (km_recordatorio is null or km_recordatorio between 500 and 100000);

create table public.recordatorios_mantenimiento (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  vehiculo_id uuid not null references public.vehiculos (id) on delete cascade,
  cliente_id uuid not null references public.clientes (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id) on delete cascade,
  servicio text not null,
  fecha_objetivo date not null,
  km_objetivo integer,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'cancelado')),
  creado_en timestamptz not null default now(),
  unique (orden_id, servicio)
);
create index recordatorios_fecha on public.recordatorios_mantenimiento (empresa_id, fecha_objetivo) where estado = 'pendiente';

-- Suscripciones a notificaciones push (cada celular o computadora de la persona).
create table public.suscripciones_push (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  agente text check (agente is null or char_length(agente) <= 300),
  creado_en timestamptz not null default now(),
  ultimo_envio timestamptz
);

-- Valores por defecto de los recordatorios según el servicio.
create function privado.recordatorio_por_defecto() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.meses_recordatorio is null and new.km_recordatorio is null then
    if new.nombre ilike '%aceite%' then new.meses_recordatorio := 3; new.km_recordatorio := 5000;
    elsif new.nombre ilike '%caja autom%' then new.meses_recordatorio := 12; new.km_recordatorio := 40000;
    elsif new.nombre ilike '%gnv%' or new.nombre ilike '%glp%' then new.meses_recordatorio := 12;
    elsif new.nombre ilike '%aire acondicionado%' then new.meses_recordatorio := 12;
    elsif new.nombre ilike '%pastillas%' then new.meses_recordatorio := 6; new.km_recordatorio := 15000;
    end if;
  end if;
  return new;
end;
$$;
create trigger catalogo_recordatorio before insert on public.catalogo_servicios for each row execute function privado.recordatorio_por_defecto();
update public.catalogo_servicios set meses_recordatorio = 3, km_recordatorio = 5000 where nombre ilike '%aceite%' and meses_recordatorio is null;
update public.catalogo_servicios set meses_recordatorio = 12, km_recordatorio = 40000 where nombre ilike '%caja autom%' and meses_recordatorio is null;
update public.catalogo_servicios set meses_recordatorio = 12 where (nombre ilike '%gnv%' or nombre ilike '%glp%' or nombre ilike '%aire acondicionado%') and meses_recordatorio is null;
update public.catalogo_servicios set meses_recordatorio = 6, km_recordatorio = 15000 where nombre ilike '%pastillas%' and meses_recordatorio is null;

-- ---------------------------------------------------------------------
-- Avisos que nacen solos del estado de la orden
-- ---------------------------------------------------------------------
create function privado.avisos_de_orden() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  v record;
  t record;
  s record;
  v_canal text;
begin
  if new.estado = old.estado then return null; end if;
  select id, nombre, celular, acepta_mensajes into c from public.clientes where id = new.cliente_id;
  select placa, marca, modelo, kilometraje_actual as kilometraje into v from public.vehiculos where id = new.vehiculo_id;
  select nombre, coalesce(nullif(telefono, ''), '') as telefono into t from public.empresas where id = new.empresa_id;

  -- Carro listo: aviso al cliente (solo si aceptó mensajes).
  if new.estado = 'listo' and c.acepta_mensajes then
    v_canal := privado.canal_aviso(new.empresa_id, 'carro_listo');
    if v_canal <> 'apagado' then
      insert into public.avisos (empresa_id, tipo, destino, cliente_id, celular, canal, titulo, texto, plantilla, variables, ref_id, clave_unica)
      values (new.empresa_id, 'carro_listo', 'cliente', c.id, c.celular, 'whatsapp', 'Carro listo',
              format('Hola %s, tu carro de placa %s ya está listo en %s. Te esperamos.', split_part(c.nombre, ' ', 1), v.placa, t.nombre),
              'carro_listo', jsonb_build_array(split_part(c.nombre, ' ', 1), v.placa, t.nombre), new.id, 'carro_listo:' || new.id)
      on conflict (clave_unica) do nothing;
    end if;
  end if;

  if new.estado = 'entregado' then
    -- Encuesta al cliente, unas horas después de la entrega.
    insert into public.encuestas (empresa_id, orden_id, cliente_id) values (new.empresa_id, new.id, c.id) on conflict (orden_id) do nothing;
    if c.acepta_mensajes and privado.canal_aviso(new.empresa_id, 'encuesta') <> 'apagado' then
      insert into public.avisos (empresa_id, tipo, destino, cliente_id, celular, canal, titulo, texto, plantilla, variables, botones, ref_id, clave_unica, programado_para)
      select new.empresa_id, 'encuesta', 'cliente', c.id, c.celular, 'whatsapp', 'Encuesta',
             format('Hola %s, gracias por confiar en %s. ¿Cómo calificas el servicio a tu carro %s?', split_part(c.nombre, ' ', 1), t.nombre, v.placa),
             'encuesta', jsonb_build_array(split_part(c.nombre, ' ', 1), t.nombre, v.placa),
             jsonb_build_array(jsonb_build_object('id', 'encuesta:' || e.id || ':5', 'titulo', 'Muy bien'),
                               jsonb_build_object('id', 'encuesta:' || e.id || ':3', 'titulo', 'Regular'),
                               jsonb_build_object('id', 'encuesta:' || e.id || ':1', 'titulo', 'Mal')),
             new.id, 'encuesta:' || new.id, now() + interval '3 hours'
      from public.encuestas e where e.orden_id = new.id
      on conflict (clave_unica) do nothing;
    end if;
    -- Recordatorios de mantenimiento según los servicios hechos.
    for s in
      select distinct on (cs.id) coalesce(cs.nombre, os.descripcion) as servicio, cs.meses_recordatorio, cs.km_recordatorio
      from public.orden_servicios os join public.catalogo_servicios cs on cs.id = os.servicio_id
      where os.orden_id = new.id and cs.meses_recordatorio is not null
    loop
      insert into public.recordatorios_mantenimiento (empresa_id, vehiculo_id, cliente_id, orden_id, servicio, fecha_objetivo, km_objetivo)
      values (new.empresa_id, new.vehiculo_id, c.id, new.id, s.servicio,
              ((coalesce(new.entregado_en, now()) at time zone 'America/Lima')::date + make_interval(months => s.meses_recordatorio))::date,
              case when s.km_recordatorio is not null and coalesce(new.kilometraje_ingreso, v.kilometraje) is not null
                   then coalesce(new.kilometraje_ingreso, v.kilometraje) + s.km_recordatorio end)
      on conflict (orden_id, servicio) do nothing;
      -- Un recordatorio anterior del mismo servicio para el mismo carro ya no hace falta.
      update public.recordatorios_mantenimiento set estado = 'cancelado'
      where vehiculo_id = new.vehiculo_id and servicio = s.servicio and orden_id <> new.id and estado = 'pendiente';
    end loop;
  end if;
  return null;
end;
$$;
create trigger ordenes_avisos after update of estado on public.ordenes_trabajo for each row execute function privado.avisos_de_orden();

-- ---------------------------------------------------------------------
-- Cotización por WhatsApp: el cliente responde con un botón.
-- Solo la llama el servidor, que ya verificó que el celular es del cliente.
-- ---------------------------------------------------------------------
create function public.respuesta_cotizacion_cliente(p_cotizacion uuid, p_celular text, p_aprueba boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  select k.id, k.estado, k.version, cl.celular into r
  from public.cotizaciones k join public.ordenes_trabajo o on o.id = k.orden_id join public.clientes cl on cl.id = o.cliente_id
  where k.id = p_cotizacion;
  if r.id is null or r.celular <> p_celular then return 'no_es_suya'; end if;
  if r.estado not in ('borrador', 'enviada') then return 'ya_respondida'; end if;
  update public.cotizaciones set estado = case when p_aprueba then 'aprobada' else 'rechazada' end,
    respuesta_en = now(), aprobada_por_medio = 'whatsapp', respuesta_texto = case when p_aprueba then 'Aprobó por WhatsApp' else 'No aprobó por WhatsApp' end
  where id = p_cotizacion;
  return case when p_aprueba then 'aprobada' else 'rechazada' end;
end;
$$;
revoke all on function public.respuesta_cotizacion_cliente(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.respuesta_cotizacion_cliente(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.config_avisos enable row level security;
alter table public.avisos enable row level security;
alter table public.encuestas enable row level security;
alter table public.recordatorios_mantenimiento enable row level security;
alter table public.suscripciones_push enable row level security;
revoke all on public.config_avisos, public.avisos, public.encuestas, public.recordatorios_mantenimiento, public.suscripciones_push from anon;
revoke insert, update, delete on public.avisos, public.encuestas, public.recordatorios_mantenimiento from authenticated;

create policy "config avisos: ver" on public.config_avisos for select to authenticated using (privado.es_miembro(empresa_id));
create policy "config avisos: cambiar" on public.config_avisos for all to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));
create policy "avisos: ver" on public.avisos for select to authenticated using (privado.es_gestor(empresa_id) or perfil_id = auth.uid());
create policy "encuestas: ver" on public.encuestas for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "recordatorios: ver" on public.recordatorios_mantenimiento for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes']::public.rol_t[]));
create policy "suscripciones push: propias" on public.suscripciones_push for all to authenticated
  using (perfil_id = auth.uid()) with check (perfil_id = auth.uid());

create trigger config_avisos_auditar after insert or update or delete on public.config_avisos for each row execute function privado.auditar();

-- Enviar una cotización al cliente por WhatsApp (con botones para aprobarla).
create function public.enviar_cotizacion_whatsapp(p_cotizacion uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_detalle text;
begin
  select k.id, k.empresa_id, k.estado, k.total, o.id as orden_id, cl.id as cliente_id, cl.nombre, cl.celular, cl.acepta_mensajes, v.placa, e.nombre as taller
    into r
  from public.cotizaciones k
  join public.ordenes_trabajo o on o.id = k.orden_id
  join public.clientes cl on cl.id = o.cliente_id
  join public.vehiculos v on v.id = o.vehiculo_id
  join public.empresas e on e.id = k.empresa_id
  where k.id = p_cotizacion;
  if r.id is null or not privado.tiene_rol(r.empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]) then
    raise exception 'No tienes permiso para enviar esta cotización.' using errcode = 'insufficient_privilege';
  end if;
  if r.estado not in ('borrador', 'enviada') then
    raise exception 'Esta cotización ya fue respondida.' using errcode = 'check_violation';
  end if;
  if not r.acepta_mensajes then return 'sin_consentimiento'; end if;
  if privado.canal_aviso(r.empresa_id, 'cotizacion') = 'apagado' then return 'apagado'; end if;
  select string_agg(case when i.cantidad <> 1 then trim(to_char(i.cantidad, 'FM999990.##')) || ' × ' else '' end || i.descripcion, ', ' order by i.tipo desc, i.descripcion)
    into v_detalle from public.cotizacion_items i where i.cotizacion_id = p_cotizacion;
  insert into public.avisos (empresa_id, tipo, destino, cliente_id, celular, canal, titulo, texto, plantilla, variables, botones, ref_id, clave_unica)
  values (r.empresa_id, 'cotizacion', 'cliente', r.cliente_id, r.celular, 'whatsapp', 'Cotización',
          format('Hola %s, la cotización para tu carro %s es de S/ %s con IGV: %s. ¿La apruebas?', split_part(r.nombre, ' ', 1), r.placa, trim(to_char(r.total, '999999990.00')), left(coalesce(v_detalle, ''), 300)),
          'cotizacion', jsonb_build_array(split_part(r.nombre, ' ', 1), r.placa, 'S/ ' || trim(to_char(r.total, '999999990.00')), left(coalesce(v_detalle, '—'), 300)),
          jsonb_build_array(jsonb_build_object('id', 'cot:' || r.id || ':si', 'titulo', 'Apruebo'), jsonb_build_object('id', 'cot:' || r.id || ':no', 'titulo', 'No, gracias')),
          r.id, 'cotizacion:' || r.id || ':' || extract(epoch from now())::bigint);
  update public.cotizaciones set estado = 'enviada', enviada_en = now() where id = p_cotizacion;
  return 'enviada';
end;
$$;
revoke all on function public.enviar_cotizacion_whatsapp(uuid) from public, anon;
grant execute on function public.enviar_cotizacion_whatsapp(uuid) to authenticated;
