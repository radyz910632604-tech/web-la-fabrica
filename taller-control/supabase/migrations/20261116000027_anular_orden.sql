-- Anular una orden (nunca se borra): gerencia o administración, con motivo.
-- Si tiene dinero o repuestos de por medio, primero se anulan esos (para no descuadrar caja ni stock).
-- Se puede correr más de una vez.

alter table public.ordenes_trabajo
  add column if not exists anulada_por uuid references public.perfiles (id),
  add column if not exists anulada_en timestamptz;

create or replace function public.anular_orden(p_orden uuid, p_motivo text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.ordenes_trabajo;
  v_falta text[] := '{}';
begin
  select * into v from public.ordenes_trabajo where id = p_orden for update;
  if not found then
    raise exception 'No se encontró la orden.' using errcode = 'no_data_found';
  end if;
  if not privado.es_gestor(v.empresa_id) then
    raise exception 'Solo gerencia o administración anulan órdenes.' using errcode = 'insufficient_privilege';
  end if;
  if v.anulada then
    raise exception 'Esta orden ya está anulada.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe el motivo (mínimo 5 letras).' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos where orden_id = p_orden and estado <> 'anulado') then v_falta := array_append(v_falta, 'los pagos'); end if;
  if exists (select 1 from public.recibos where orden_id = p_orden and estado <> 'anulado') then v_falta := array_append(v_falta, 'el recibo'); end if;
  if exists (select 1 from public.comprobantes_venta where orden_id = p_orden and estado <> 'anulado') then v_falta := array_append(v_falta, 'la boleta o factura'); end if;
  if exists (select 1 from public.movimientos_inventario where orden_id = p_orden and tipo = 'salida' and estado = 'vigente') then v_falta := array_append(v_falta, 'los repuestos sacados del almacén'); end if;
  if array_length(v_falta, 1) > 0 then
    raise exception 'Primero anula %: así la caja y el stock quedan bien.', array_to_string(v_falta, ', ') using errcode = 'check_violation';
  end if;

  update public.ordenes_trabajo set anulada = true, motivo_anulacion = btrim(p_motivo), anulada_por = auth.uid(), anulada_en = now()
  where id = p_orden;
  -- Sus cotizaciones abiertas quedan anuladas (a la vista, con el motivo).
  update public.cotizaciones set estado = 'anulada', respuesta_texto = left('Orden anulada: ' || btrim(p_motivo), 500)
  where orden_id = p_orden and estado in ('borrador', 'enviada', 'aprobada');
  insert into public.orden_avances (empresa_id, orden_id, texto, autor_id)
  values (v.empresa_id, p_orden, left('Orden anulada: ' || btrim(p_motivo), 1000), auth.uid());
end;
$$;
revoke all on function public.anular_orden(uuid, text) from public, anon;
grant execute on function public.anular_orden(uuid, text) to authenticated;
