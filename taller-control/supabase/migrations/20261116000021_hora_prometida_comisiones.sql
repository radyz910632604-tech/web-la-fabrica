-- 1) La hora prometida solo la cambian recepción, gerencia y administración.
-- 2) Comisiones del asesor: solo gerencia y administración las ven y gestionan;
--    al pagarse crean un único gasto (1 a 1) que solo se anula desde la comisión.

-- ---------------------------------------------------------------------
-- 1. Hora prometida
-- ---------------------------------------------------------------------
alter table public.ordenes_trabajo
  add column entrega_cambiada_por uuid references public.perfiles (id),
  add column entrega_cambiada_en timestamptz;

create function privado.proteger_hora_prometida() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entrega_prometida is distinct from old.entrega_prometida then
    -- Procesos sin sesión (respaldo, mantenimiento) no pasan por aquí con un usuario.
    if auth.uid() is not null
       and not privado.tiene_rol(new.empresa_id, array['gerencia', 'administrador', 'recepcion']::public.rol_t[]) then
      raise exception 'La hora prometida solo la cambian recepción, gerencia o administración.' using errcode = 'insufficient_privilege';
    end if;
    new.entrega_cambiada_por := auth.uid();
    new.entrega_cambiada_en := now();
  end if;
  return new;
end;
$$;
create trigger ordenes_proteger_hora_prometida before update of entrega_prometida on public.ordenes_trabajo
  for each row execute function privado.proteger_hora_prometida();

-- ---------------------------------------------------------------------
-- 2. Asesor de cada orden (a quién le corresponde la comisión)
-- ---------------------------------------------------------------------
alter table public.ordenes_trabajo add column asesor_id uuid references public.perfiles (id);
create index ordenes_asesor on public.ordenes_trabajo (empresa_id, asesor_id) where asesor_id is not null;

-- Lo que ya existe: el asesor es quien registró la orden, si tiene ese rol.
update public.ordenes_trabajo o set asesor_id = o.creado_por
where o.asesor_id is null and o.creado_por is not null
  and exists (select 1 from public.miembros m where m.empresa_id = o.empresa_id and m.perfil_id = o.creado_por and m.rol = 'asesor');

create function privado.asesor_por_defecto() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.asesor_id is null and auth.uid() is not null
     and exists (select 1 from public.miembros m where m.empresa_id = new.empresa_id and m.perfil_id = auth.uid() and m.rol = 'asesor' and m.activo) then
    new.asesor_id := auth.uid();
  end if;
  return new;
end;
$$;
create trigger ordenes_asesor_por_defecto before insert on public.ordenes_trabajo
  for each row execute function privado.asesor_por_defecto();

-- ---------------------------------------------------------------------
-- 3. Gastos: de dónde vienen (1 a 1 con su origen)
-- ---------------------------------------------------------------------
alter table public.gastos
  add column origen text not null default 'manual' check (origen in ('manual', 'comision')),
  add column origen_id uuid;
create unique index gastos_por_origen on public.gastos (origen, origen_id) where origen_id is not null;

-- Un gasto que viene de una comisión solo cambia desde la comisión.
create function privado.gasto_solo_desde_origen() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.origen <> 'manual' and coalesce(current_setting('taller.desde_comision', true), '') <> 'si' then
    raise exception 'Este gasto viene de una comisión: se anula desde Comisiones.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger gastos_solo_desde_origen before update on public.gastos
  for each row execute function privado.gasto_solo_desde_origen();

-- ---------------------------------------------------------------------
-- 4. Comisiones del asesor
-- ---------------------------------------------------------------------
create table public.comisiones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id),
  orden_id uuid references public.ordenes_trabajo (id),
  regla_id uuid references public.reglas_comision (id),
  periodo date not null check (extract(day from periodo) = 1),          -- mes al que corresponde
  concepto text not null check (char_length(btrim(concepto)) between 3 and 160),
  base numeric(12, 2) check (base is null or base >= 0),                 -- venta sin IGV sobre la que se calculó
  monto numeric(12, 2) not null check (monto > 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'pagada', 'anulada')),
  medio text check (medio is null or medio in ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia')),
  aprobada_por uuid, aprobada_en timestamptz,
  pagada_por uuid, pagada_en timestamptz,
  anulada_por uuid, anulada_en timestamptz,
  motivo_anulacion text,
  gasto_id uuid unique references public.gastos (id),
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create index comisiones_periodo on public.comisiones (empresa_id, periodo);
-- Una orden no comisiona dos veces por la misma regla a la misma persona.
create unique index comisiones_una_por_orden on public.comisiones (orden_id, perfil_id, coalesce(regla_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where orden_id is not null and estado <> 'anulada';

create trigger comisiones_sellar before insert or update on public.comisiones for each row execute function privado.sellar();
create trigger comisiones_auditar after insert or update or delete on public.comisiones for each row execute function privado.auditar();

-- Reglas de la comisión: solo asesores, estados en orden y el gasto al pagar.
create function privado.reglas_comision_asesor() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nombre text;
  v_orden text;
  v_gasto uuid;
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'pendiente' then
      raise exception 'Una comisión aprobada o pagada no se elimina: se anula con motivo.' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not exists (select 1 from public.miembros m where m.empresa_id = new.empresa_id and m.perfil_id = new.perfil_id and m.rol = 'asesor') then
      raise exception 'Las comisiones son para el asesor de servicio (el mecánico no comisiona por órdenes).' using errcode = 'check_violation';
    end if;
    if new.estado <> 'pendiente' then
      raise exception 'Una comisión nueva empieza pendiente.' using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.estado = 'anulada' then
    raise exception 'Esta comisión está anulada y ya no se puede cambiar.' using errcode = 'check_violation';
  end if;
  if new.perfil_id <> old.perfil_id or new.orden_id is distinct from old.orden_id or new.empresa_id <> old.empresa_id then
    raise exception 'No se cambia a quién ni de qué orden es: anúlala y crea otra.' using errcode = 'check_violation';
  end if;
  if old.estado <> 'pendiente' and (new.monto <> old.monto or new.concepto <> old.concepto or new.base is distinct from old.base) then
    raise exception 'Solo una comisión pendiente se modifica.' using errcode = 'check_violation';
  end if;
  if new.estado <> old.estado then
    if not ((old.estado = 'pendiente' and new.estado = 'aprobada')
         or (old.estado = 'aprobada' and new.estado in ('pagada', 'pendiente'))
         or new.estado = 'anulada') then
      raise exception 'Paso no permitido: pendiente → aprobada → pagada (o anular).' using errcode = 'check_violation';
    end if;
    if new.estado = 'aprobada' then
      new.aprobada_por := auth.uid(); new.aprobada_en := now();
    elsif new.estado = 'pendiente' then
      new.aprobada_por := null; new.aprobada_en := null;
    elsif new.estado = 'pagada' then
      if new.medio is null then
        raise exception 'Indica cómo se pagó.' using errcode = 'check_violation';
      end if;
      new.pagada_por := auth.uid(); new.pagada_en := now();
      select nombre into v_nombre from public.perfiles where id = new.perfil_id;
      select 'OT-' || lpad(numero::text, 6, '0') into v_orden from public.ordenes_trabajo where id = new.orden_id;
      -- El único gasto de esta comisión (el índice único impide un segundo).
      insert into public.gastos (empresa_id, fecha, categoria, descripcion, monto, medio, origen, origen_id)
      values (new.empresa_id, (now() at time zone 'America/Lima')::date, 'sueldos',
              left('Comisión de ' || v_nombre || coalesce(' · ' || v_orden, '') || ' · ' || new.concepto, 200),
              new.monto, new.medio, 'comision', new.id)
      returning id into v_gasto;
      new.gasto_id := v_gasto;
    elsif new.estado = 'anulada' then
      if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 5 then
        raise exception 'Para anular escribe el motivo.' using errcode = 'check_violation';
      end if;
      new.anulada_por := auth.uid(); new.anulada_en := now();
      if old.gasto_id is not null then
        perform set_config('taller.desde_comision', 'si', true);
        update public.gastos set estado = 'anulado', motivo_anulacion = 'Comisión anulada: ' || btrim(new.motivo_anulacion)
         where id = old.gasto_id and estado <> 'anulado';
        perform set_config('taller.desde_comision', '', true);
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger comisiones_reglas before insert or update or delete on public.comisiones
  for each row execute function privado.reglas_comision_asesor();

alter table public.comisiones enable row level security;
revoke all on public.comisiones from anon;
grant select, insert, update, delete on public.comisiones to authenticated;
-- Solo gerencia y administración: ni el asesor ve las suyas.
create policy "comisiones: ver" on public.comisiones for select to authenticated using (privado.es_gestor(empresa_id));
create policy "comisiones: crear" on public.comisiones for insert to authenticated with check (privado.es_gestor(empresa_id));
create policy "comisiones: cambiar" on public.comisiones for update to authenticated using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));
create policy "comisiones: eliminar pendiente" on public.comisiones for delete to authenticated using (privado.es_gestor(empresa_id) and estado = 'pendiente');

-- Las reglas de comisión: gerencia y administración (antes, solo gerencia).
drop policy "comisiones: ver" on public.reglas_comision;
drop policy "comisiones: escribir" on public.reglas_comision;
create policy "reglas de comisión: ver" on public.reglas_comision for select to authenticated using (privado.es_gestor(empresa_id));
create policy "reglas de comisión: escribir" on public.reglas_comision for all to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));

-- Recepción no edita órdenes en general: esta función le deja cambiar solo la hora prometida.
create function public.cambiar_hora_prometida(p_orden uuid, p_hora timestamptz) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empresa uuid;
begin
  select empresa_id into v_empresa from public.ordenes_trabajo where id = p_orden and not anulada;
  if v_empresa is null then
    raise exception 'No se encontró la orden.' using errcode = 'no_data_found';
  end if;
  if not privado.tiene_rol(v_empresa, array['gerencia', 'administrador', 'recepcion']::public.rol_t[]) then
    raise exception 'La hora prometida solo la cambian recepción, gerencia o administración.' using errcode = 'insufficient_privilege';
  end if;
  update public.ordenes_trabajo set entrega_prometida = p_hora where id = p_orden;
end;
$$;
revoke all on function public.cambiar_hora_prometida(uuid, timestamptz) from public, anon;
grant execute on function public.cambiar_hora_prometida(uuid, timestamptz) to authenticated;

-- Quién es el asesor de la orden define su comisión: solo lo cambian gerencia y administración.
create function privado.proteger_asesor() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asesor_id is distinct from old.asesor_id and auth.uid() is not null and not privado.es_gestor(new.empresa_id) then
    raise exception 'El asesor de la orden lo cambian gerencia o administración.' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger ordenes_proteger_asesor before update of asesor_id on public.ordenes_trabajo
  for each row execute function privado.proteger_asesor();
