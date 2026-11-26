-- Personal (parte 1): datos de la persona, dueño protegido y baja sin borrar nada.

-- 1. Datos de la persona.
alter table public.perfiles
  add column documento text check (documento is null or documento ~ '^[0-9A-Za-z]{6,15}$'),
  add column cargo text check (cargo is null or char_length(btrim(cargo)) between 2 and 60),
  add column fecha_ingreso date;
grant update (documento, cargo, fecha_ingreso) on public.perfiles to authenticated;

-- La baja es por taller (la persona puede seguir en otro taller).
alter table public.miembros
  add column es_dueno boolean not null default false,
  add column baja_en date,
  add column baja_motivo text check (baja_motivo is null or char_length(btrim(baja_motivo)) between 3 and 300);
create unique index miembros_un_dueno on public.miembros (empresa_id) where es_dueno;

-- 2. El dueño: la gerencia activa más antigua de cada taller.
update public.miembros m set es_dueno = true
where m.id in (
  select distinct on (empresa_id) id from public.miembros
  where rol = 'gerencia' and activo
  order by empresa_id, creado_en, id
);

-- Al crear un taller, quien entra primero como gerencia queda de dueño.
create function privado.marcar_dueno() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rol = 'gerencia' and new.activo
     and not exists (select 1 from public.miembros where empresa_id = new.empresa_id and es_dueno) then
    new.es_dueno := true;
  elsif new.es_dueno and coalesce(current_setting('taller.traspaso_dueno', true), '') <> 'si' then
    new.es_dueno := false;
  end if;
  return new;
end;
$$;
create trigger miembros_marcar_dueno before insert on public.miembros
  for each row execute function privado.marcar_dueno();

-- Nadie le quita el acceso ni el rol al dueño, ni se nombra dueño a otro por la puerta de atrás.
create function privado.proteger_dueno() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_traspaso boolean := coalesce(current_setting('taller.traspaso_dueno', true), '') = 'si';
begin
  if tg_op = 'DELETE' then
    if old.es_dueno then
      raise exception 'El dueño del taller no se puede quitar.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if old.es_dueno and not v_traspaso and (not new.activo or new.rol <> old.rol or not new.es_dueno) then
    raise exception 'El dueño del taller no se puede dar de baja ni cambiar de rol.' using errcode = 'check_violation';
  end if;
  if new.es_dueno and not old.es_dueno and not v_traspaso then
    raise exception 'El dueño solo se cambia con el traspaso.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger miembros_proteger_dueno before update or delete on public.miembros
  for each row execute function privado.proteger_dueno();

-- El acceso global (perfiles.activo) tampoco se le apaga al dueño.
create function privado.proteger_dueno_perfil() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.activo and not new.activo
     and exists (select 1 from public.miembros where perfil_id = new.id and es_dueno) then
    raise exception 'El dueño del taller no se puede desactivar.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger perfiles_proteger_dueno before update of activo on public.perfiles
  for each row execute function privado.proteger_dueno_perfil();

-- 3. Dar de baja y reactivar en el taller actual (el historial queda intacto).
create function public.dar_de_baja(p_empresa uuid, p_perfil uuid, p_motivo text, p_fecha date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if p_perfil = (select auth.uid()) then
    raise exception 'No puedes darte de baja a ti mismo.' using errcode = 'check_violation';
  end if;
  if not privado.es_gestor(p_empresa) then
    raise exception 'Solo gerencia o administración dan de baja.' using errcode = 'insufficient_privilege';
  end if;
  -- Administración no da de baja a gerencia.
  if not privado.tiene_rol(p_empresa, array['gerencia']::public.rol_t[])
     and exists (select 1 from public.miembros where empresa_id = p_empresa and perfil_id = p_perfil and rol = 'gerencia' and activo) then
    raise exception 'Solo gerencia da de baja a otra gerencia.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo de la baja.' using errcode = 'check_violation';
  end if;
  update public.miembros
     set activo = false, baja_en = coalesce(p_fecha, current_date), baja_motivo = btrim(p_motivo)
   where empresa_id = p_empresa and perfil_id = p_perfil and activo;
  get diagnostics v_filas = row_count;
  if v_filas = 0 then
    raise exception 'Esa persona no está activa en este taller.' using errcode = 'no_data_found';
  end if;
  return v_filas;
end;
$$;

create function public.reactivar(p_empresa uuid, p_perfil uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_filas integer;
begin
  if not privado.es_gestor(p_empresa) then
    raise exception 'Solo gerencia o administración reactivan.' using errcode = 'insufficient_privilege';
  end if;
  if not privado.tiene_rol(p_empresa, array['gerencia']::public.rol_t[])
     and exists (select 1 from public.miembros where empresa_id = p_empresa and perfil_id = p_perfil and rol = 'gerencia') then
    raise exception 'Solo gerencia reactiva a otra gerencia.' using errcode = 'insufficient_privilege';
  end if;
  update public.miembros set activo = true, baja_en = null, baja_motivo = null
   where empresa_id = p_empresa and perfil_id = p_perfil and not activo;
  get diagnostics v_filas = row_count;
  -- Quien se había desactivado con el sistema anterior (acceso global) también vuelve.
  update public.perfiles set activo = true where id = p_perfil and not activo;
  return v_filas;
end;
$$;

revoke all on function public.dar_de_baja(uuid, uuid, text, date) from public, anon;
revoke all on function public.reactivar(uuid, uuid) from public, anon;
grant execute on function public.dar_de_baja(uuid, uuid, text, date) to authenticated;
grant execute on function public.reactivar(uuid, uuid) to authenticated;
