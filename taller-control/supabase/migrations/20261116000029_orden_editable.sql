-- La orden se puede corregir mientras el carro está en el taller.
-- Cuando ya se entregó (pagó y salió) o se anuló, sus datos de ingreso y sus
-- servicios quedan fijos. Se puede correr dos veces.

create or replace function privado.proteger_ingreso_cerrado() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.estado = 'entregado' or old.anulada)
     and (new.vehiculo_id is distinct from old.vehiculo_id
       or new.cliente_id is distinct from old.cliente_id
       or new.kilometraje_ingreso is distinct from old.kilometraje_ingreso
       or new.observaciones_ingreso is distinct from old.observaciones_ingreso
       or new.nivel_combustible is distinct from old.nivel_combustible) then
    raise exception 'La orden ya se entregó o se anuló: sus datos de ingreso no se cambian.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists ordenes_ingreso_cerrado on public.ordenes_trabajo;
create trigger ordenes_ingreso_cerrado before update on public.ordenes_trabajo
  for each row execute function privado.proteger_ingreso_cerrado();

create or replace function privado.proteger_servicios_cerrados() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.ordenes_trabajo o where o.id = old.orden_id and (o.estado = 'entregado' or o.anulada)) then
    raise exception 'La orden ya se entregó o se anuló: sus servicios no se quitan.' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists orden_servicios_cerrados on public.orden_servicios;
create trigger orden_servicios_cerrados before delete on public.orden_servicios
  for each row execute function privado.proteger_servicios_cerrados();
