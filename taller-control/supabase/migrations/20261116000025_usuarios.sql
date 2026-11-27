-- Usuario propio para entrar (separado del celular). Se puede correr más de una vez.
-- - perfiles.usuario: único, minúsculas, letras, números, punto y guion bajo (3 a 30).
-- - A quien no tenga usuario se le pone uno automático (nombre.apellido); su celular sigue sirviendo para entrar.
-- - El celular queda para WhatsApp y se puede cambiar (lo hace gerencia o administración).
-- - El correo interno de Supabase Auth no se toca: nadie pierde el acceso.

alter table public.perfiles add column if not exists usuario text;
alter table public.perfiles add column if not exists debe_cambiar_clave boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'perfiles_usuario_formato') then
    alter table public.perfiles add constraint perfiles_usuario_formato check (usuario is null or usuario ~ '^[a-z0-9._]{3,30}$');
  end if;
end $$;

-- «Cecilia Minope Ruiz» → «cecilia.ruiz»; sin tildes ni eñes; siempre de 3 a 30 caracteres.
create or replace function privado.base_usuario(p_nombre text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
  v_partes text[];
begin
  v := lower(translate(coalesce(p_nombre, ''), 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù', 'AEIOUUNaeiouunAEIOUaeiou'));
  v := regexp_replace(v, '[^a-z0-9 ]', ' ', 'g');
  v_partes := regexp_split_to_array(btrim(regexp_replace(v, '\s+', ' ', 'g')), ' ');
  if coalesce(array_length(v_partes, 1), 0) = 0 or v_partes[1] = '' then
    return 'usuario';
  end if;
  v := case when array_length(v_partes, 1) >= 2 then v_partes[1] || '.' || v_partes[2] else v_partes[1] end;
  v := left(v, 26);
  if char_length(v) < 3 then v := rpad(v, 3, '0'); end if;
  return v;
end;
$$;

-- El primer usuario libre a partir de una base: «cecilia.minope», «cecilia.minope2», …
create or replace function privado.usuario_libre(p_base text, p_excepto uuid default null) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text := p_base;
  n integer := 1;
begin
  while exists (select 1 from public.perfiles where usuario = v and (p_excepto is null or id <> p_excepto)) loop
    n := n + 1;
    v := left(p_base, 30 - char_length(n::text)) || n::text;
  end loop;
  return v;
end;
$$;

-- Personas que ya existen: usuario automático (en orden de antigüedad, sin repetir).
do $$
declare
  r record;
begin
  for r in select id, nombre from public.perfiles where usuario is null order by creado_en, id loop
    update public.perfiles set usuario = privado.usuario_libre(privado.base_usuario(r.nombre), r.id) where id = r.id;
  end loop;
end $$;

create unique index if not exists perfiles_usuario_unico on public.perfiles (usuario);

-- Quien se crea sin usuario recibe uno automático; si viene en los datos del alta, se usa ese.
create or replace function privado.usuario_por_defecto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.usuario is null then
    new.usuario := privado.usuario_libre(privado.base_usuario(new.nombre));
  end if;
  return new;
end;
$$;
drop trigger if exists perfiles_usuario_por_defecto on public.perfiles;
create trigger perfiles_usuario_por_defecto before insert on public.perfiles
  for each row execute function privado.usuario_por_defecto();

create or replace function privado.crear_perfil() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_app_meta_data ? 'celular' then
    insert into public.perfiles (id, nombre, celular, usuario)
    values (
      new.id,
      coalesce(nullif(btrim(new.raw_app_meta_data ->> 'nombre'), ''), 'Sin nombre'),
      new.raw_app_meta_data ->> 'celular',
      nullif(btrim(lower(new.raw_app_meta_data ->> 'usuario')), '')
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- El usuario lo cambia la persona misma o quien la gestiona (la política de perfiles ya lo exige).
grant update (usuario) on public.perfiles to authenticated;

-- Sugerir un usuario libre (para avisar «Ese usuario ya está en uso» con una alternativa).
create or replace function public.sugerir_usuario(p_texto text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select privado.usuario_libre(
    case when lower(coalesce(p_texto, '')) ~ '^[a-z0-9._]{3,30}$' then left(lower(p_texto), 26) else privado.base_usuario(p_texto) end
  );
$$;
revoke all on function public.sugerir_usuario(text) from public, anon;
grant execute on function public.sugerir_usuario(text) to authenticated;

-- Cambiar el celular (su WhatsApp) sin crear a la persona de nuevo. Gerencia o administración.
create or replace function public.cambiar_celular(p_perfil uuid, p_celular text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_otro text;
begin
  if not privado.puede_gestionar_perfil(p_perfil) then
    raise exception 'No puedes cambiar el celular de esta persona.' using errcode = 'insufficient_privilege';
  end if;
  if p_celular is null or p_celular !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Celular no válido.' using errcode = 'check_violation';
  end if;
  select nombre into v_otro from public.perfiles where celular = p_celular and id <> p_perfil;
  if v_otro is not null then
    raise exception 'Ese celular ya es de %.', v_otro using errcode = 'unique_violation';
  end if;
  update public.perfiles set celular = p_celular where id = p_perfil;
end;
$$;
revoke all on function public.cambiar_celular(uuid, text) from public, anon;
grant execute on function public.cambiar_celular(uuid, text) to authenticated;
