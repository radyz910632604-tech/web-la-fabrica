-- =====================================================================
-- Cotizaciones: recepción también las arma y se pueden editar
-- ---------------------------------------------------------------------
-- 1. Recepción (en el mostrador) crea, edita y responde cotizaciones.
-- 2. editar_cotizacion(): la cotización se corrige como versión nueva; la
--    anterior queda anulada (visible, con quién y por qué). Si estaba
--    aprobada, la nueva queda aprobada. No se edita si la orden ya tiene
--    recibo, boleta o factura: primero se anula ese documento.
-- =====================================================================
drop policy "cotizaciones: crear" on public.cotizaciones;
drop policy "cotizaciones: cambiar" on public.cotizaciones;
drop policy "líneas de cotización: crear" on public.cotizacion_items;
drop policy "líneas de cotización: quitar" on public.cotizacion_items;
create policy "cotizaciones: crear" on public.cotizaciones for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "cotizaciones: cambiar" on public.cotizaciones for update to authenticated using (privado.ve_caja(empresa_id)) with check (privado.ve_caja(empresa_id));
create policy "líneas de cotización: crear" on public.cotizacion_items for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "líneas de cotización: quitar" on public.cotizacion_items for delete to authenticated using (privado.ve_caja(empresa_id));

-- Qué versión reemplaza a cuál (al editar).
alter table public.cotizaciones add column reemplaza_id uuid references public.cotizaciones (id);

create function public.editar_cotizacion(p_cotizacion uuid, p_items jsonb, p_con_igv boolean default true)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vieja public.cotizaciones;
  v_nueva uuid;
  v_quien text;
begin
  select * into v_vieja from public.cotizaciones where id = p_cotizacion;
  if not found then
    raise exception 'No se encontró la cotización.' using errcode = 'no_data_found';
  end if;
  if v_vieja.estado in ('anulada', 'rechazada') then
    raise exception 'Esa versión ya no está vigente: edita la última.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.recibos where orden_id = v_vieja.orden_id and estado <> 'anulado')
     or exists (select 1 from public.comprobantes_venta where orden_id = v_vieja.orden_id and estado <> 'anulado') then
    raise exception 'La orden ya tiene recibo, boleta o factura. Anúlalo primero para cambiar los precios.' using errcode = 'check_violation';
  end if;
  select nombre into v_quien from public.perfiles where id = auth.uid();

  v_nueva := public.crear_cotizacion(v_vieja.orden_id, v_vieja.es_adicional, p_items, p_con_igv);
  update public.cotizaciones set reemplaza_id = p_cotizacion where id = v_nueva;
  if v_vieja.estado in ('enviada', 'aprobada') then
    update public.cotizaciones set
      estado = v_vieja.estado, enviada_en = v_vieja.enviada_en, respuesta_en = v_vieja.respuesta_en,
      aprobada_por_medio = v_vieja.aprobada_por_medio,
      respuesta_texto = left('Editada por ' || coalesce(v_quien, 'el taller') || ' (antes versión ' || v_vieja.version || ')', 500)
    where id = v_nueva;
  end if;
  update public.cotizaciones set estado = 'anulada',
    respuesta_texto = left('Reemplazada por la versión ' || (select version from public.cotizaciones where id = v_nueva) || ' · ' || coalesce(v_quien, 'el taller'), 500)
  where id = p_cotizacion;
  return v_nueva;
end;
$$;
revoke all on function public.editar_cotizacion(uuid, jsonb, boolean) from public, anon;
grant execute on function public.editar_cotizacion(uuid, jsonb, boolean) to authenticated;
