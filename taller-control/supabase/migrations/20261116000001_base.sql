-- =====================================================================
-- 0001 · Base: empresas, personas, roles, configuración y auditoría
--
-- Reglas que se aplican desde aquí en adelante:
--   * Toda tabla tiene RLS. Sin una regla que lo permita, nadie ve nada.
--   * Las funciones de apoyo viven en el esquema "privado", que la API
--     pública de Supabase no expone.
--   * Cada cambio queda en "auditoria" (quién, cuándo, antes y después).
-- =====================================================================

create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated, service_role;

create type public.rol_t as enum (
  'gerencia',
  'administrador',
  'asesor',
  'tecnico',
  'almacen',
  'vendedor_redes',
  'confirmador'
);

-- ---------------------------------------------------------------------
-- Sellos: quién creó y quién cambió cada registro, y cuándo.
-- ---------------------------------------------------------------------
create function privado.sellar() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.creado_en := now();
    new.creado_por := coalesce(new.creado_por, auth.uid());
  else
    new.creado_en := old.creado_en;
    new.creado_por := old.creado_por;
  end if;
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Auditoría: nadie la puede editar ni borrar, ni siquiera gerencia.
-- ---------------------------------------------------------------------
create table public.auditoria (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id uuid,
  empresa_id uuid,
  accion text not null check (accion in ('crear', 'editar', 'borrar')),
  antes jsonb,
  despues jsonb,
  perfil_id uuid,
  origen text not null default 'app',
  creado_en timestamptz not null default now()
);
create index auditoria_empresa_fecha on public.auditoria (empresa_id, creado_en desc);
create index auditoria_registro on public.auditoria (tabla, registro_id);

create function privado.auditar() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fila jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_empresa uuid;
begin
  if tg_table_name = 'empresas' then
    v_empresa := (v_fila ->> 'id')::uuid;
  else
    v_empresa := nullif(v_fila ->> 'empresa_id', '')::uuid;
  end if;

  insert into public.auditoria (tabla, registro_id, empresa_id, accion, antes, despues, perfil_id, origen)
  values (
    tg_table_name,
    coalesce(v_fila ->> 'id', v_fila ->> 'empresa_id')::uuid,
    v_empresa,
    case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'editar' else 'borrar' end,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    auth.uid(),
    coalesce(nullif(current_setting('app.origen', true), ''), 'app')
  );
  return null;
end;
$$;

create function privado.auditoria_inmutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'La auditoría no se puede editar ni borrar.'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger auditoria_inmutable
  before update or delete on public.auditoria
  for each row execute function privado.auditoria_inmutable();

-- ---------------------------------------------------------------------
-- Empresas (cada taller)
-- ---------------------------------------------------------------------
create table public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  razon_social text check (razon_social is null or char_length(razon_social) <= 160),
  ruc text check (ruc is null or ruc ~ '^(10|15|17|20)[0-9]{9}$'),
  direccion text check (direccion is null or char_length(direccion) <= 200),
  telefono text check (telefono is null or char_length(telefono) <= 30),
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

-- ---------------------------------------------------------------------
-- Perfiles: cada persona con acceso (app o WhatsApp).
-- El celular identifica a quien escribe por WhatsApp.
-- ---------------------------------------------------------------------
create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  celular text not null unique check (celular ~ '^\+[1-9][0-9]{7,14}$'),
  avatar_url text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

-- ---------------------------------------------------------------------
-- Miembros: qué rol tiene cada persona en cada taller.
-- Una fila por empresa + persona + rol.
-- ---------------------------------------------------------------------
create table public.miembros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  rol public.rol_t not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, perfil_id, rol)
);
create index miembros_perfil on public.miembros (perfil_id);

-- ---------------------------------------------------------------------
-- Configuración: una fila por taller, se crea sola con la empresa.
-- ---------------------------------------------------------------------
create table public.configuracion_empresa (
  empresa_id uuid primary key references public.empresas (id) on delete cascade,
  tasa_igv numeric(5, 4) not null default 0.18 check (tasa_igv between 0 and 0.5),
  dias_cliente_inactivo integer not null default 180 check (dias_cliente_inactivo between 30 and 1095),
  dias_garantia_defecto integer not null default 90 check (dias_garantia_defecto between 0 and 1095),
  tolerancia_cita_minutos integer not null default 30 check (tolerancia_cita_minutos between 0 and 240),
  horas_orden_sin_cambio integer not null default 48 check (horas_orden_sin_cambio between 1 and 720),
  margen_minimo_pct numeric(5, 2) not null default 20 check (margen_minimo_pct between 0 and 100),
  hora_resumen_mediodia time not null default '12:00',
  hora_cierre time not null default '19:00',
  regla_mano_obra text not null default 'prorrateo_mensual'
    check (regla_mano_obra in ('fijo_por_servicio', 'prorrateo_mensual')),
  admin_ve_utilidad boolean not null default false,
  admin_ve_sueldos boolean not null default false,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);

create table public.metas_ventas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  anio integer not null check (anio between 2024 and 2100),
  mes integer not null check (mes between 1 and 12),
  meta_sin_igv numeric(12, 2) not null check (meta_sin_igv >= 0),
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, anio, mes)
);

-- ---------------------------------------------------------------------
-- Funciones de apoyo para los permisos
-- ---------------------------------------------------------------------
create function privado.es_miembro(p_empresa uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.miembros m
    join public.perfiles p on p.id = m.perfil_id
    where m.empresa_id = p_empresa
      and m.perfil_id = (select auth.uid())
      and m.activo
      and p.activo
  );
$$;

create function privado.tiene_rol(p_empresa uuid, p_roles public.rol_t[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.miembros m
    join public.perfiles p on p.id = m.perfil_id
    where m.empresa_id = p_empresa
      and m.perfil_id = (select auth.uid())
      and m.activo
      and p.activo
      and m.rol = any (p_roles)
  );
$$;

-- Gerencia o administrador del taller.
create function privado.es_gestor(p_empresa uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.tiene_rol(p_empresa, array['gerencia', 'administrador']::public.rol_t[]);
$$;

-- ¿Puedo ver los datos de contacto de esta persona?
-- Sí: si soy yo, o si soy gerencia, administrador o asesor en un taller donde ella trabaja.
create function privado.puede_ver_perfil(p_perfil uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_perfil = (select auth.uid())
    or exists (
      select 1
      from public.miembros ella
      where ella.perfil_id = p_perfil
        and privado.tiene_rol(ella.empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[])
    );
$$;

-- ¿Puedo administrar a esta persona (editarla, desactivarla, cambiar su clave)?
-- Gerencia: a cualquiera de sus talleres. Administrador: a quien no sea gerencia.
create function privado.puede_gestionar_perfil(p_perfil uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.miembros ella
    where ella.perfil_id = p_perfil
      and (
        privado.tiene_rol(ella.empresa_id, array['gerencia']::public.rol_t[])
        or (
          privado.tiene_rol(ella.empresa_id, array['administrador']::public.rol_t[])
          and not exists (
            select 1 from public.miembros g
            where g.perfil_id = p_perfil and g.rol = 'gerencia' and g.activo
          )
        )
      )
  );
$$;

revoke all on all functions in schema privado from public, anon;
grant execute on all functions in schema privado to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------

-- Al crear un usuario de login, se crea su perfil con los datos que puso
-- el administrador (app_metadata solo lo puede escribir el servidor).
-- Supabase guarda app_metadata en un segundo paso, por eso también se
-- escucha la actualización; si el perfil ya existe, no se toca.
create function privado.crear_perfil() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_app_meta_data ? 'celular' then
    insert into public.perfiles (id, nombre, celular)
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_app_meta_data ->> 'nombre'), ''), 'Sin nombre'),
      new.raw_app_meta_data ->> 'celular'
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create trigger al_crear_usuario
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function privado.crear_perfil();

-- Cada taller nace con su configuración por defecto.
create function privado.crear_configuracion() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.configuracion_empresa (empresa_id) values (new.id);
  return new;
end;
$$;

-- Un taller nunca se queda sin gerencia (evita que alguien se encierre fuera).
create function privado.proteger_ultima_gerencia() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.rol = 'gerencia' and old.activo
     and (tg_op = 'DELETE' or not new.activo or new.rol <> 'gerencia') then
    if not exists (
      select 1 from public.miembros
      where empresa_id = old.empresa_id and rol = 'gerencia' and activo and id <> old.id
    ) then
      raise exception 'El taller debe tener al menos una persona con rol gerencia.'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

-- Solo gerencia decide qué ve el administrador.
create function privado.proteger_permisos_admin() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.admin_ve_utilidad is distinct from old.admin_ve_utilidad
      or new.admin_ve_sueldos is distinct from old.admin_ve_sueldos)
     and auth.uid() is not null
     and not privado.tiene_rol(new.empresa_id, array['gerencia']::public.rol_t[]) then
    raise exception 'Solo gerencia puede cambiar lo que ve el administrador.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- Una persona puede cambiar su nombre y foto, pero no activarse ni desactivarse sola.
create function privado.proteger_perfil() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.activo is distinct from old.activo and new.id = auth.uid() then
    raise exception 'Nadie puede activarse ni desactivarse a sí mismo.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.activo is distinct from old.activo
     and auth.uid() is not null
     and not privado.puede_gestionar_perfil(new.id) then
    raise exception 'Solo gerencia o administración pueden activar o desactivar a una persona.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger empresas_sellar before insert or update on public.empresas
  for each row execute function privado.sellar();
create trigger empresas_auditar after insert or update or delete on public.empresas
  for each row execute function privado.auditar();
create trigger empresas_configuracion after insert on public.empresas
  for each row execute function privado.crear_configuracion();

create trigger perfiles_sellar before insert or update on public.perfiles
  for each row execute function privado.sellar();
create trigger perfiles_proteger before update on public.perfiles
  for each row execute function privado.proteger_perfil();
create trigger perfiles_auditar after insert or update or delete on public.perfiles
  for each row execute function privado.auditar();

create trigger miembros_sellar before insert or update on public.miembros
  for each row execute function privado.sellar();
create trigger miembros_ultima_gerencia before update or delete on public.miembros
  for each row execute function privado.proteger_ultima_gerencia();
create trigger miembros_auditar after insert or update or delete on public.miembros
  for each row execute function privado.auditar();

create trigger configuracion_sellar before insert or update on public.configuracion_empresa
  for each row execute function privado.sellar();
create trigger configuracion_permisos_admin before update on public.configuracion_empresa
  for each row execute function privado.proteger_permisos_admin();
create trigger configuracion_auditar after insert or update or delete on public.configuracion_empresa
  for each row execute function privado.auditar();

create trigger metas_sellar before insert or update on public.metas_ventas
  for each row execute function privado.sellar();
create trigger metas_auditar after insert or update or delete on public.metas_ventas
  for each row execute function privado.auditar();

-- ---------------------------------------------------------------------
-- RLS: reglas por tabla
-- ---------------------------------------------------------------------
alter table public.empresas enable row level security;
alter table public.perfiles enable row level security;
alter table public.miembros enable row level security;
alter table public.configuracion_empresa enable row level security;
alter table public.metas_ventas enable row level security;
alter table public.auditoria enable row level security;

-- La API anónima no toca ninguna tabla.
revoke all on all tables in schema public from anon;

-- Empresas: las ven sus miembros; las editan gerencia y administración.
-- Se crean con la función crear_empresa().
create policy "empresas: ver las mías" on public.empresas
  for select to authenticated using (privado.es_miembro(id));
create policy "empresas: editar si gestiono" on public.empresas
  for update to authenticated using (privado.es_gestor(id)) with check (privado.es_gestor(id));

-- Perfiles: cada uno ve el suyo; gerencia, administración y asesores ven al
-- personal de sus talleres. El resto ve solo nombres, con directorio().
create policy "perfiles: ver" on public.perfiles
  for select to authenticated using (privado.puede_ver_perfil(id));
create policy "perfiles: editar el mío o si gestiono" on public.perfiles
  for update to authenticated
  using (id = (select auth.uid()) or privado.puede_gestionar_perfil(id))
  with check (id = (select auth.uid()) or privado.puede_gestionar_perfil(id));
-- El celular es la identidad de login y de WhatsApp: solo lo cambia el servidor.
revoke insert, update, delete on public.perfiles from authenticated;
grant update (nombre, avatar_url, activo) on public.perfiles to authenticated;

-- Miembros: los ven los miembros del mismo taller. Gerencia asigna cualquier
-- rol; administración asigna todos menos gerencia.
create policy "miembros: ver los de mi taller" on public.miembros
  for select to authenticated using (privado.es_miembro(empresa_id));
create policy "miembros: crear" on public.miembros
  for insert to authenticated
  with check (
    privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[])
    or (privado.tiene_rol(empresa_id, array['administrador']::public.rol_t[]) and rol <> 'gerencia')
  );
create policy "miembros: cambiar" on public.miembros
  for update to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[])
    or (privado.tiene_rol(empresa_id, array['administrador']::public.rol_t[]) and rol <> 'gerencia')
  )
  with check (
    privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[])
    or (privado.tiene_rol(empresa_id, array['administrador']::public.rol_t[]) and rol <> 'gerencia')
  );
create policy "miembros: quitar" on public.miembros
  for delete to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[])
    or (privado.tiene_rol(empresa_id, array['administrador']::public.rol_t[]) and rol <> 'gerencia')
  );

-- Configuración: la ven los miembros; la cambian gerencia y administración.
create policy "configuración: ver" on public.configuracion_empresa
  for select to authenticated using (privado.es_miembro(empresa_id));
create policy "configuración: editar" on public.configuracion_empresa
  for update to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));

-- Metas de ventas: las ven quienes ven ventas; las fijan gerencia y administración.
create policy "metas: ver" on public.metas_ventas
  for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "metas: crear" on public.metas_ventas
  for insert to authenticated with check (privado.es_gestor(empresa_id));
create policy "metas: cambiar" on public.metas_ventas
  for update to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));
create policy "metas: borrar" on public.metas_ventas
  for delete to authenticated using (privado.es_gestor(empresa_id));

-- Auditoría: solo gerencia y administración, y solo para leer.
create policy "auditoría: ver" on public.auditoria
  for select to authenticated
  using (privado.es_gestor(empresa_id));
revoke insert, update, delete on public.auditoria from authenticated;

-- ---------------------------------------------------------------------
-- Funciones que la app llama directamente
-- ---------------------------------------------------------------------

-- Nombres y roles del personal de un taller (para todos sus miembros).
create function public.directorio(p_empresa uuid)
returns table (perfil_id uuid, nombre text, roles public.rol_t[], activo boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nombre, array_agg(m.rol order by m.rol), bool_or(m.activo) and p.activo
  from public.miembros m
  join public.perfiles p on p.id = m.perfil_id
  where m.empresa_id = p_empresa
    and privado.es_miembro(p_empresa)
  group by p.id, p.nombre, p.activo
  order by p.nombre;
$$;

-- ¿El usuario actual puede administrar a esta persona? (lo usa el servidor
-- antes de cambiar celulares o contraseñas con la llave de servicio)
create function public.puedo_gestionar_perfil(p_perfil uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.puede_gestionar_perfil(p_perfil);
$$;

-- ¿El usuario actual gestiona este taller?
create function public.gestiono_empresa(p_empresa uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.es_gestor(p_empresa);
$$;

-- Crear un taller nuevo. Quien lo crea queda como gerencia (o administrador) de él.
create function public.crear_empresa(p_nombre text, p_ruc text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rol public.rol_t;
  v_id uuid;
begin
  -- Sin filas, bool_or() da NULL y v_rol queda vacío: no hay "por descarte".
  select case
           when bool_or(m.rol = 'gerencia') then 'gerencia'::public.rol_t
           when bool_or(m.rol = 'administrador') then 'administrador'::public.rol_t
         end
    into v_rol
  from public.miembros m
  join public.perfiles p on p.id = m.perfil_id and p.activo
  where m.perfil_id = auth.uid() and m.activo and m.rol in ('gerencia', 'administrador');

  if v_rol is null then
    raise exception 'Solo gerencia o administración pueden crear un taller.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.empresas (nombre, ruc) values (btrim(p_nombre), nullif(btrim(p_ruc), ''))
  returning id into v_id;

  insert into public.miembros (empresa_id, perfil_id, rol) values (v_id, auth.uid(), v_rol);
  if v_rol = 'administrador' then
    -- Las personas con rol gerencia del taller de origen también quedan como gerencia.
    insert into public.miembros (empresa_id, perfil_id, rol)
    select distinct v_id, g.perfil_id, 'gerencia'::public.rol_t
    from public.miembros g
    where g.rol = 'gerencia' and g.activo
      and g.empresa_id in (select empresa_id from public.miembros where perfil_id = auth.uid() and activo)
    on conflict do nothing;
  end if;

  return v_id;
end;
$$;

revoke all on function public.directorio(uuid) from public, anon;
revoke all on function public.puedo_gestionar_perfil(uuid) from public, anon;
revoke all on function public.gestiono_empresa(uuid) from public, anon;
revoke all on function public.crear_empresa(text, text) from public, anon;
grant execute on function public.directorio(uuid) to authenticated;
grant execute on function public.puedo_gestionar_perfil(uuid) to authenticated;
grant execute on function public.gestiono_empresa(uuid) to authenticated;
grant execute on function public.crear_empresa(text, text) to authenticated;
