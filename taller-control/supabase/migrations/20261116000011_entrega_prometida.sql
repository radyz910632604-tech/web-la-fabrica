-- =====================================================================
-- Hora de entrega prometida al cliente
-- ---------------------------------------------------------------------
-- Cada orden puede llevar el día y la hora en que se le prometió el carro
-- al cliente. El ciclo de avisos (cada 15 minutos) avisa al asesor antes
-- de que venza si el carro todavía no está listo, y otra vez si se pasó.
-- Cambiar la hora deja una nota en la orden y cuenta las reprogramaciones.
-- =====================================================================

alter table public.ordenes_trabajo
  add column entrega_prometida timestamptz,
  add column entrega_reprogramada integer not null default 0 check (entrega_reprogramada >= 0);

comment on column public.ordenes_trabajo.entrega_prometida is 'Día y hora en que se le prometió el carro al cliente (null: por definir).';
comment on column public.ordenes_trabajo.entrega_reprogramada is 'Cuántas veces se cambió la hora prometida (la lleva la base).';

-- Las órdenes abiertas con hora prometida: las revisa el ciclo de avisos.
create index ordenes_entrega_abiertas on public.ordenes_trabajo (empresa_id, entrega_prometida)
  where entrega_prometida is not null and not anulada and estado in ('en_taller', 'en_proceso', 'esperando_repuesto');

-- Cuánto antes de la hora prometida se avisa al asesor (por defecto, 2 horas).
alter table public.configuracion_empresa
  add column minutos_aviso_entrega integer not null default 120 check (minutos_aviso_entrega between 15 and 1440);

-- Dos tipos de aviso nuevos para el personal (por defecto, aviso en el celular).
alter table public.config_avisos drop constraint config_avisos_tipo_check;
alter table public.config_avisos add constraint config_avisos_tipo_check check (tipo in (
  'resumen_mediodia', 'resumen_cierre', 'citas_del_dia', 'cita_no_llego', 'carro_listo',
  'recordatorio_mantenimiento', 'encuesta', 'cotizacion', 'entrega_por_vencer', 'entrega_atrasada'
));

-- ---------------------------------------------------------------------
-- La base lleva la cuenta de reprogramaciones y deja la nota en la orden.
-- ---------------------------------------------------------------------
create function privado.hora_entrega(p timestamptz) returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p at time zone 'America/Lima', 'DD/MM') || ' a las ' ||
         ltrim(to_char(p at time zone 'America/Lima', 'HH12:MI'), '0') ||
         case when extract(hour from p at time zone 'America/Lima') < 12 then ' a. m.' else ' p. m.' end;
$$;

create function privado.contar_reprogramacion() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.entrega_reprogramada := 0;
    return new;
  end if;
  -- Nadie la escribe a mano: solo sube cuando cambia una hora que ya estaba puesta.
  new.entrega_reprogramada := old.entrega_reprogramada
    + case when old.entrega_prometida is not null and new.entrega_prometida is distinct from old.entrega_prometida then 1 else 0 end;
  return new;
end;
$$;

create function privado.nota_entrega_prometida() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_texto text;
begin
  if new.entrega_prometida is not distinct from old.entrega_prometida then
    return new;
  end if;
  v_texto := case
    when new.entrega_prometida is null then 'La hora de entrega quedó por definir (antes: ' || privado.hora_entrega(old.entrega_prometida) || ').'
    when old.entrega_prometida is null then 'Entrega prometida al cliente: ' || privado.hora_entrega(new.entrega_prometida) || '.'
    else 'Nueva hora de entrega prometida: ' || privado.hora_entrega(new.entrega_prometida) || ' (antes: ' || privado.hora_entrega(old.entrega_prometida) || ').'
  end;
  insert into public.orden_avances (empresa_id, orden_id, texto, autor_id)
  values (new.empresa_id, new.id, v_texto, auth.uid());
  return new;
end;
$$;

create trigger ordenes_reprogramacion before insert or update of entrega_prometida, entrega_reprogramada on public.ordenes_trabajo
  for each row execute function privado.contar_reprogramacion();
create trigger ordenes_nota_entrega after update of entrega_prometida on public.ordenes_trabajo
  for each row execute function privado.nota_entrega_prometida();
