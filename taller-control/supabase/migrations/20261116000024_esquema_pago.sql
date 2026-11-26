-- Alta completa del trabajador: datos, rol y esquema de pago en un solo paso.
-- - El DNI no se repite entre personas.
-- - El esquema de pago tiene versiones: cambiarlo crea una nueva desde hoy; lo pasado no se toca.
-- - Solo gerencia y administración ven y cambian sueldos. El mecánico no tiene comisión por orden.

create unique index perfiles_documento_unico on public.perfiles (upper(documento)) where documento is not null;

create table public.esquemas_pago (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id),
  tipo text not null check (tipo in ('fijo', 'destajo')),
  monto numeric(12, 2) not null check (monto >= 0),           -- fijo: por periodo · destajo: por trabajo
  frecuencia text not null check (frecuencia in ('semanal', 'quincenal', 'mensual')),
  comision_pct numeric(5, 2) check (comision_pct is null or comision_pct between 0 and 100),
  vigente_desde date not null,
  vigente_hasta date,
  motivo text check (motivo is null or char_length(motivo) <= 200),
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, perfil_id, vigente_desde),
  check (vigente_hasta is null or vigente_hasta >= vigente_desde)
);
create unique index esquemas_uno_vigente on public.esquemas_pago (empresa_id, perfil_id) where vigente_hasta is null;

create trigger esquemas_sellar before insert or update on public.esquemas_pago for each row execute function privado.sellar();
create trigger esquemas_auditar after insert or update or delete on public.esquemas_pago for each row execute function privado.auditar();

-- Una versión no se reescribe (solo se cierra al crear la siguiente) y no se borra.
create function privado.proteger_esquema() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un esquema de pago no se borra: se cambia desde una fecha.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - array['vigente_hasta', 'actualizado_en', 'actualizado_por'])
                          is distinct from (to_jsonb(old) - array['vigente_hasta', 'actualizado_en', 'actualizado_por']) then
    raise exception 'El esquema vigente no se edita: crea uno nuevo desde una fecha (lo pasado no cambia).' using errcode = 'check_violation';
  end if;
  -- Comisión por orden: solo para el asesor (el mecánico no comisiona por órdenes).
  if new.comision_pct is not null and new.comision_pct > 0 and not exists (
       select 1 from public.miembros m where m.empresa_id = new.empresa_id and m.perfil_id = new.perfil_id and m.rol = 'asesor') then
    raise exception 'La comisión por orden es solo para el asesor de servicio.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger esquemas_proteger before insert or update or delete on public.esquemas_pago
  for each row execute function privado.proteger_esquema();

alter table public.esquemas_pago enable row level security;
revoke all on public.esquemas_pago from anon, authenticated;
grant select on public.esquemas_pago to authenticated;
create policy "esquemas de pago: ver" on public.esquemas_pago for select to authenticated using (privado.es_gestor(empresa_id));

-- Alta en un solo paso: rol en el taller + datos + esquema de pago. Todo o nada.
create function public.alta_persona(
  p_empresa uuid, p_perfil uuid, p_rol public.rol_t,
  p_documento text, p_cargo text, p_fecha_ingreso date,
  p_tipo text, p_monto numeric, p_frecuencia text, p_comision numeric default null
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc text := nullif(upper(regexp_replace(coalesce(p_documento, ''), '\s', '', 'g')), '');
  v_otro text;
begin
  if not privado.es_gestor(p_empresa) then
    raise exception 'Solo gerencia o administración agregan personal.' using errcode = 'insufficient_privilege';
  end if;
  if p_rol = 'gerencia' and not privado.tiene_rol(p_empresa, array['gerencia']::public.rol_t[]) then
    raise exception 'Solo gerencia da el rol de gerencia.' using errcode = 'insufficient_privilege';
  end if;
  if v_doc is null or v_doc !~ '^[0-9A-Z]{6,15}$' then
    raise exception 'Escribe el DNI o carné (de 6 a 15 letras o números).' using errcode = 'check_violation';
  end if;
  select nombre into v_otro from public.perfiles where upper(documento) = v_doc and id <> p_perfil;
  if v_otro is not null then
    raise exception 'Ese DNI ya está registrado a nombre de %.', v_otro using errcode = 'unique_violation';
  end if;

  insert into public.miembros (empresa_id, perfil_id, rol) values (p_empresa, p_perfil, p_rol);
  update public.perfiles set
    documento = v_doc,
    cargo = coalesce(nullif(btrim(coalesce(p_cargo, '')), ''), cargo),
    fecha_ingreso = coalesce(fecha_ingreso, p_fecha_ingreso, (now() at time zone 'America/Lima')::date)
  where id = p_perfil;

  -- Si ya tenía esquema en este taller (otro rol), se deja: se cambia desde Modificar.
  if not exists (select 1 from public.esquemas_pago where empresa_id = p_empresa and perfil_id = p_perfil and vigente_hasta is null) then
    insert into public.esquemas_pago (empresa_id, perfil_id, tipo, monto, frecuencia, comision_pct, vigente_desde, motivo)
    values (p_empresa, p_perfil, p_tipo, round(coalesce(p_monto, 0), 2), p_frecuencia,
            case when p_rol = 'asesor' then nullif(p_comision, 0) end,
            coalesce(p_fecha_ingreso, (now() at time zone 'America/Lima')::date), 'Alta');
  end if;
end;
$$;
revoke all on function public.alta_persona(uuid, uuid, public.rol_t, text, text, date, text, numeric, text, numeric) from public, anon;
grant execute on function public.alta_persona(uuid, uuid, public.rol_t, text, text, date, text, numeric, text, numeric) to authenticated;

-- Cambiar el esquema de pago: vale desde hoy o una fecha futura; las versiones pasadas quedan igual.
create function public.cambiar_esquema_pago(
  p_empresa uuid, p_perfil uuid, p_tipo text, p_monto numeric, p_frecuencia text,
  p_comision numeric, p_desde date, p_motivo text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual public.esquemas_pago;
  v_id uuid;
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if not privado.es_gestor(p_empresa) then
    raise exception 'Solo gerencia o administración cambian el pago.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.miembros where empresa_id = p_empresa and perfil_id = p_perfil and es_dueno) then
    if not exists (select 1 from public.miembros where empresa_id = p_empresa and perfil_id = auth.uid() and es_dueno) then
      raise exception 'El pago del dueño solo lo cambia el dueño.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if p_desde is null or p_desde < v_hoy then
    raise exception 'El cambio vale desde hoy o una fecha futura: lo ya pagado no se toca.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Escribe el motivo del cambio.' using errcode = 'check_violation';
  end if;
  select * into v_actual from public.esquemas_pago where empresa_id = p_empresa and perfil_id = p_perfil and vigente_hasta is null for update;
  if found then
    if p_desde <= v_actual.vigente_desde then
      raise exception 'Debe empezar después del esquema vigente (desde %).', to_char(v_actual.vigente_desde, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
    update public.esquemas_pago set vigente_hasta = p_desde - 1 where id = v_actual.id;
  end if;
  insert into public.esquemas_pago (empresa_id, perfil_id, tipo, monto, frecuencia, comision_pct, vigente_desde, motivo)
  values (p_empresa, p_perfil, p_tipo, round(coalesce(p_monto, 0), 2), p_frecuencia, nullif(p_comision, 0), p_desde, btrim(p_motivo))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cambiar_esquema_pago(uuid, uuid, text, numeric, text, numeric, date, text) from public, anon;
grant execute on function public.cambiar_esquema_pago(uuid, uuid, text, numeric, text, numeric, date, text) to authenticated;
