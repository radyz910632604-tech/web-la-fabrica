-- =====================================================================
-- Gastos en un solo lugar
-- ---------------------------------------------------------------------
-- Cuando sale dinero de la caja y se elige una categoría (movilidad,
-- limpieza…), el gasto del taller se anota solo y cuenta en la utilidad.
-- Si se anula en la caja, se anula también el gasto. Un retiro de dinero
-- (sin categoría) no es gasto.
-- =====================================================================

alter table public.movimientos_caja
  add column categoria_gasto text check (categoria_gasto is null or categoria_gasto in (
    'alquiler', 'luz', 'agua', 'internet_telefono', 'sueldos', 'movilidad', 'publicidad',
    'herramientas', 'limpieza', 'impuestos', 'mantenimiento_local', 'contador', 'otros'
  )),
  add constraint movimientos_categoria_solo_egreso check (categoria_gasto is null or tipo = 'egreso');

alter table public.gastos add column movimiento_caja_id uuid references public.movimientos_caja (id);
create unique index gastos_por_movimiento on public.gastos (movimiento_caja_id) where movimiento_caja_id is not null;

create function privado.gasto_desde_caja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.tipo = 'egreso' and new.categoria_gasto is not null then
      insert into public.gastos (empresa_id, fecha, categoria, descripcion, monto, medio, movimiento_caja_id)
      values (new.empresa_id, (new.creado_en at time zone 'America/Lima')::date, new.categoria_gasto, left(new.concepto, 200), new.monto, new.medio, new.id);
    end if;
  elsif new.estado = 'anulado' and old.estado <> 'anulado' then
    update public.gastos
       set estado = 'anulado', motivo_anulacion = left('Anulado en la caja: ' || coalesce(new.motivo_anulacion, ''), 500)
     where movimiento_caja_id = new.id and estado <> 'anulado';
  end if;
  return null;
end;
$$;
create trigger movimientos_gasto after insert or update on public.movimientos_caja
  for each row execute function privado.gasto_desde_caja();
