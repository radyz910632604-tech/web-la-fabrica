-- =====================================================================
-- 0009 · WhatsApp (Fase 2)
--
-- n8n recibe el mensaje de Meta y lo manda a la API interna de la app
-- (nunca escribe directo en la base). La app:
--   * guarda TODO mensaje que llega y su resultado (mensajes_whatsapp);
--   * identifica a la persona por su celular y aplica su rol;
--   * arma un borrador con lo que entendió y pide «Confirmar» o «Corregir»;
--   * solo al confirmar, escribe con la sesión de esa persona (RLS).
-- =====================================================================

-- Auditoría de mensajes: la escribe solo el servidor (llave de servicio).
create table public.mensajes_whatsapp (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references public.empresas (id) on delete cascade,
  wa_id text not null unique,
  celular text not null,
  perfil_id uuid references public.perfiles (id) on delete set null,
  cliente_id uuid references public.clientes (id) on delete set null,
  tipo text not null check (tipo in ('texto', 'audio', 'imagen', 'documento', 'video', 'boton', 'otro')),
  texto text check (texto is null or char_length(texto) <= 4000),
  transcripcion text check (transcripcion is null or char_length(transcripcion) <= 8000),
  media_mime text,
  archivo_path text,
  intencion text,
  datos jsonb,
  proveedor_ia text,
  resultado text not null default 'recibido'
    check (resultado in ('recibido', 'borrador', 'pide_dato', 'confirmado', 'corregido', 'respondido', 'sin_acceso', 'rechazado', 'error', 'encuesta', 'cotizacion')),
  respuesta text,
  borrador_id uuid,
  creado_en timestamptz not null default now(),
  procesado_en timestamptz
);
create index mensajes_whatsapp_empresa on public.mensajes_whatsapp (empresa_id, creado_en desc);
create index mensajes_whatsapp_celular on public.mensajes_whatsapp (celular, creado_en desc);

-- Borradores: lo que se entendió de un mensaje, esperando «Confirmar».
create table public.borradores_whatsapp (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  intencion text not null,
  datos jsonb not null default '{}'::jsonb,
  faltan text[] not null default '{}',
  resumen text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmado', 'corregido', 'vencido', 'fallido')),
  resultado jsonb,
  expira_en timestamptz not null default now() + interval '2 hours',
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create index borradores_pendientes on public.borradores_whatsapp (perfil_id, creado_en desc) where estado = 'pendiente';

-- En qué taller trabaja por WhatsApp quien pertenece a varios.
create table public.preferencias_whatsapp (
  perfil_id uuid primary key references public.perfiles (id) on delete cascade,
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  actualizado_en timestamptz not null default now()
);

create function privado.proteger_mensaje_whatsapp() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los mensajes de WhatsApp quedan como auditoría: no se borran.' using errcode = 'insufficient_privilege';
  end if;
  -- Solo se completa el resultado; lo que llegó no cambia.
  if (to_jsonb(new) - array['empresa_id', 'perfil_id', 'cliente_id', 'transcripcion', 'archivo_path', 'intencion', 'datos', 'proveedor_ia', 'resultado', 'respuesta', 'borrador_id', 'procesado_en'])
     is distinct from (to_jsonb(old) - array['empresa_id', 'perfil_id', 'cliente_id', 'transcripcion', 'archivo_path', 'intencion', 'datos', 'proveedor_ia', 'resultado', 'respuesta', 'borrador_id', 'procesado_en']) then
    raise exception 'Lo que llegó por WhatsApp no se edita.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger mensajes_whatsapp_proteger before update or delete on public.mensajes_whatsapp for each row execute function privado.proteger_mensaje_whatsapp();

create function privado.proteger_borrador() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los borradores no se borran: quedan como corregidos o vencidos.' using errcode = 'insufficient_privilege';
  end if;
  if old.estado <> 'pendiente' then
    raise exception 'Este borrador ya se cerró.' using errcode = 'check_violation';
  end if;
  if new.perfil_id <> old.perfil_id or new.empresa_id <> old.empresa_id then
    raise exception 'El borrador no cambia de dueño.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger borradores_sellar before insert or update on public.borradores_whatsapp for each row execute function privado.sellar();
create trigger borradores_proteger before update or delete on public.borradores_whatsapp for each row execute function privado.proteger_borrador();
create trigger borradores_auditar after insert or update on public.borradores_whatsapp for each row execute function privado.auditar();

alter table public.mensajes_whatsapp enable row level security;
alter table public.borradores_whatsapp enable row level security;
alter table public.preferencias_whatsapp enable row level security;
revoke all on public.mensajes_whatsapp, public.borradores_whatsapp, public.preferencias_whatsapp from anon;
revoke insert, update, delete on public.mensajes_whatsapp from authenticated;
revoke delete on public.borradores_whatsapp from authenticated;

-- Gerencia y administración leen la auditoría de su taller.
create policy "mensajes whatsapp: ver" on public.mensajes_whatsapp for select to authenticated
  using (empresa_id is not null and privado.es_gestor(empresa_id));

-- Cada persona ve, crea y cierra sus propios borradores; gestión los ve.
create policy "borradores: ver" on public.borradores_whatsapp for select to authenticated
  using (perfil_id = auth.uid() or privado.es_gestor(empresa_id));
create policy "borradores: crear" on public.borradores_whatsapp for insert to authenticated
  with check (perfil_id = auth.uid() and privado.es_miembro(empresa_id));
create policy "borradores: cerrar" on public.borradores_whatsapp for update to authenticated
  using (perfil_id = auth.uid())
  with check (perfil_id = auth.uid());

create policy "preferencias whatsapp: propias" on public.preferencias_whatsapp for all to authenticated
  using (perfil_id = auth.uid())
  with check (perfil_id = auth.uid() and privado.es_miembro(empresa_id));

-- Las fotos y videos que llegan por WhatsApp van a la orden (WhatsApp ya
-- comprime los videos; se aceptan hasta 16 MB).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/3gpp', 'video/quicktime'],
    file_size_limit = 16777216
where id = 'ordenes';

-- Un pago por confirmar (WhatsApp) entra a la caja recién al confirmarlo:
-- a la caja que esté abierta en ese momento, no a una que ya se cerró.
create or replace function privado.pago_a_caja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_estado text;
begin
  if tg_op = 'INSERT' then
    new.caja_id := case when new.estado = 'confirmado' and new.origen <> 'whatsapp'
                        then (select id from public.cajas where empresa_id = new.empresa_id and estado = 'abierta') end;
  elsif new.caja_id is distinct from old.caja_id then
    raise exception 'El pago no cambia de caja.' using errcode = 'check_violation';
  elsif old.estado = 'por_confirmar' and new.estado = 'confirmado' then
    new.caja_id := (select id from public.cajas where empresa_id = new.empresa_id and estado = 'abierta');
  elsif old.caja_id is not null and new.estado = 'anulado' and old.estado <> 'anulado' then
    select estado into v_estado from public.cajas where id = old.caja_id;
    if v_estado = 'cerrada' then
      raise exception 'Este pago es de una caja ya cerrada: registra una devolución en la caja de hoy.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
