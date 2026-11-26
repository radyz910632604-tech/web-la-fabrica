-- =====================================================================
-- Quién trabaja cada carro: cada cambio de técnico queda en la orden
-- ---------------------------------------------------------------------
-- Si Luis tenía el carro y lo termina Mario, queda escrito: «Técnico:
-- Luis → Mario», con quién lo cambió y cuándo (en los avances de la orden).
-- La mano de obra se le cuenta a quien queda asignado al entregar.
-- =====================================================================
create function privado.historial_tecnico() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_antes text;
  v_ahora text;
begin
  if new.tecnico_id is not distinct from old.tecnico_id then return null; end if;
  select nombre into v_antes from public.perfiles where id = old.tecnico_id;
  select nombre into v_ahora from public.perfiles where id = new.tecnico_id;
  insert into public.orden_avances (empresa_id, orden_id, texto, autor_id)
  values (new.empresa_id, new.id,
          case when old.tecnico_id is null then 'Técnico asignado: ' || coalesce(v_ahora, '—')
               when new.tecnico_id is null then 'Se quitó al técnico ' || coalesce(v_antes, '—')
               else 'Técnico: ' || coalesce(v_antes, '—') || ' → ' || coalesce(v_ahora, '—') end,
          auth.uid());
  return null;
end;
$$;
create trigger ordenes_historial_tecnico after update of tecnico_id on public.ordenes_trabajo
  for each row execute function privado.historial_tecnico();
