-- =====================================================================
-- Firmas del cliente, copias de seguridad y estado del sistema
-- ---------------------------------------------------------------------
-- 1. El cliente firma en la pantalla al dejar el carro y al recibirlo.
--    La firma sale en la orden de reparación y en el recibo.
-- 2. Registro de las copias de seguridad que la app hace cada día.
-- 3. Estado del sistema (último ciclo de avisos, último respaldo…) para
--    la pantalla «Estado del sistema» de gerencia.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Apoyo: ¿quien consulta es gerencia de algún taller?
-- ---------------------------------------------------------------------
create function privado.es_gerencia() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.miembros m
    join public.perfiles p on p.id = m.perfil_id
    where m.perfil_id = (select auth.uid()) and m.rol = 'gerencia' and m.activo and p.activo
  );
$$;
revoke all on function privado.es_gerencia() from public, anon;
grant execute on function privado.es_gerencia() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Firmas del cliente
-- ---------------------------------------------------------------------
alter table public.ordenes_trabajo
  add column firma_ingreso_ruta text,
  add column firma_ingreso_en timestamptz,
  add column firma_entrega_ruta text,
  add column firma_entrega_en timestamptz;

comment on column public.ordenes_trabajo.firma_ingreso_ruta is 'Imagen de la firma del cliente al dejar el carro (bucket ordenes). Solo la escribe registrar_firma().';
comment on column public.ordenes_trabajo.firma_entrega_ruta is 'Imagen de la firma del cliente al recibir el carro (bucket ordenes). Solo la escribe registrar_firma().';

-- Las firmas no se escriben a mano: solo con registrar_firma().
create function privado.proteger_firmas() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.firma_ingreso_ruta := null; new.firma_ingreso_en := null;
    new.firma_entrega_ruta := null; new.firma_entrega_en := null;
    return new;
  end if;
  if coalesce(current_setting('privado.firma', true), '') <> 'si'
     and (new.firma_ingreso_ruta, new.firma_ingreso_en, new.firma_entrega_ruta, new.firma_entrega_en)
         is distinct from (old.firma_ingreso_ruta, old.firma_ingreso_en, old.firma_entrega_ruta, old.firma_entrega_en) then
    raise exception 'La firma del cliente se registra desde la orden, con el botón de firmar.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger ordenes_proteger_firmas before insert or update on public.ordenes_trabajo
  for each row execute function privado.proteger_firmas();

-- Guarda la firma: al ingresar, quien abre órdenes; al entregar, quien atiende la caja.
create function public.registrar_firma(p_orden uuid, p_etapa text, p_ruta text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo;
begin
  select * into v_orden from public.ordenes_trabajo where id = p_orden;
  if not found or v_orden.anulada then
    raise exception 'La orden no existe o está anulada.' using errcode = 'no_data_found';
  end if;
  if p_etapa = 'ingreso' then
    if not privado.tiene_rol(v_orden.empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]) then
      raise exception 'La firma de ingreso la toma el asesor.' using errcode = 'insufficient_privilege';
    end if;
  elsif p_etapa = 'entrega' then
    if not privado.ve_caja(v_orden.empresa_id) then
      raise exception 'La firma de entrega la toma quien entrega el carro.' using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'Etapa no válida.' using errcode = 'check_violation';
  end if;
  -- La imagen debe ser de esta orden y estar ya subida.
  if p_ruta !~ ('^' || v_orden.empresa_id::text || '/' || p_orden::text || '/firma-' || p_etapa || '-[0-9a-f-]{36}\.png$')
     or not exists (select 1 from storage.objects where bucket_id = 'ordenes' and name = p_ruta) then
    raise exception 'No se encontró la imagen de la firma.' using errcode = 'check_violation';
  end if;
  perform set_config('privado.firma', 'si', true);
  if p_etapa = 'ingreso' then
    update public.ordenes_trabajo set firma_ingreso_ruta = p_ruta, firma_ingreso_en = now() where id = p_orden;
  else
    update public.ordenes_trabajo set firma_entrega_ruta = p_ruta, firma_entrega_en = now() where id = p_orden;
  end if;
  perform set_config('privado.firma', '', true);
end;
$$;
revoke all on function public.registrar_firma(uuid, text, text) from public, anon;
grant execute on function public.registrar_firma(uuid, text, text) to authenticated;

-- Recepción entrega carros: puede subir la firma de entrega (y solo eso) a la carpeta de la orden.
create policy "órdenes: subir firma de entrega" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ordenes'
    and (storage.filename(name)) like 'firma-entrega-%'
    and privado.ve_caja(((storage.foldername(name))[1])::uuid)
    and privado.puede_ver_orden(((storage.foldername(name))[2])::uuid)
  );

-- ---------------------------------------------------------------------
-- 2. Copias de seguridad
-- ---------------------------------------------------------------------
-- La app guarda una copia diaria en el bucket privado «respaldos». Esta tabla
-- lleva el registro. Solo el servidor escribe; solo gerencia la ve y descarga.
create table public.respaldos (
  id uuid primary key default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  origen text not null check (origen in ('automatico', 'manual')),
  modo text not null check (modo in ('completo', 'datos')),
  estado text not null default 'listo' check (estado in ('listo', 'fallido')),
  ruta text,
  tamano_bytes bigint,
  tablas integer,
  filas integer,
  error text check (error is null or char_length(error) <= 1000),
  descargado_en timestamptz,
  descargado_por uuid
);
create index respaldos_fecha on public.respaldos (creado_en desc);

alter table public.respaldos enable row level security;
revoke all on public.respaldos from anon;
revoke insert, update, delete on public.respaldos from authenticated;
create policy "respaldos: ver gerencia" on public.respaldos for select to authenticated using (privado.es_gerencia());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('respaldos', 'respaldos', false, 52428800, array['application/gzip'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 3. Estado del sistema
-- ---------------------------------------------------------------------
create table public.estado_sistema (
  clave text primary key check (clave ~ '^[a-z_]{2,40}$'),
  valor jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);
alter table public.estado_sistema enable row level security;
revoke all on public.estado_sistema from anon;
revoke insert, update, delete on public.estado_sistema from authenticated;
create policy "estado del sistema: ver gerencia" on public.estado_sistema for select to authenticated using (privado.es_gerencia());
