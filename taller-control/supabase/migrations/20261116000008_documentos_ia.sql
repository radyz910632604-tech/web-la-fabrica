-- =====================================================================
-- 0008 · Archivo del comprobante (foto, PDF o XML) y lectura por IA
--
-- Cada compra y cada comprobante de venta puede guardar su archivo, para
-- que quien confirma lo leído por IA vea el original. Carpeta privada
-- "comprobantes", ruta {empresa}/{compras|ventas}/{archivo}.
-- Lo leído por IA ya entra "por_confirmar" (registrar_compra y la app);
-- aquí se asegura también en la base para los comprobantes de venta.
-- =====================================================================

alter table public.compras add column archivo_path text check (archivo_path is null or char_length(archivo_path) <= 300);
alter table public.comprobantes_venta add column archivo_path text check (archivo_path is null or char_length(archivo_path) <= 300);

-- Nada leído por IA entra como confirmado: la base lo fuerza al crearlo.
create function privado.ia_por_confirmar() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origen_datos = 'ia' and new.estado = 'confirmado' then
    new.estado := 'por_confirmar';
  end if;
  return new;
end;
$$;
create trigger compras_ia_por_confirmar before insert on public.compras for each row execute function privado.ia_por_confirmar();
create trigger comprobantes_ia_por_confirmar before insert on public.comprobantes_venta for each row execute function privado.ia_por_confirmar();

-- Pagos que llegan por WhatsApp: también por confirmar hasta que alguien los apruebe en la app.
create function privado.whatsapp_por_confirmar() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.origen = 'whatsapp' and new.estado = 'confirmado' then
    new.estado := 'por_confirmar';
  end if;
  return new;
end;
$$;
create trigger pagos_whatsapp_por_confirmar before insert on public.pagos for each row execute function privado.whatsapp_por_confirmar();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 6291456, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/xml', 'application/xml'])
on conflict (id) do nothing;

create function privado.puede_ver_archivo_comprobante(p_nombre text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (storage.foldername(p_nombre))[2]
    when 'compras' then privado.tiene_rol(((storage.foldername(p_nombre))[1])::uuid, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[])
    when 'ventas' then privado.ve_caja(((storage.foldername(p_nombre))[1])::uuid)
    else false
  end;
$$;

create function privado.puede_subir_archivo_comprobante(p_nombre text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case (storage.foldername(p_nombre))[2]
    when 'compras' then privado.tiene_rol(((storage.foldername(p_nombre))[1])::uuid, array['gerencia', 'administrador', 'almacen']::public.rol_t[])
    when 'ventas' then privado.ve_caja(((storage.foldername(p_nombre))[1])::uuid)
    else false
  end;
$$;
revoke all on function privado.puede_ver_archivo_comprobante(text), privado.puede_subir_archivo_comprobante(text) from public, anon;
grant execute on function privado.puede_ver_archivo_comprobante(text), privado.puede_subir_archivo_comprobante(text) to authenticated;

create policy "comprobantes: ver archivo" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and privado.puede_ver_archivo_comprobante(name));
create policy "comprobantes: subir archivo" on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and privado.puede_subir_archivo_comprobante(name));

-- registrar_compra guarda también el archivo del comprobante (si se subió).
create or replace function public.registrar_compra(p_empresa uuid, p_proveedor jsonb, p_compra jsonb, p_items jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prov uuid := nullif(p_proveedor ->> 'id', '')::uuid;
  v_compra uuid;
  v_item jsonb;
  v_origen text := coalesce(p_compra ->> 'origen', 'manual');
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La compra necesita al menos una línea.' using errcode = 'check_violation';
  end if;
  if v_prov is null and coalesce(p_proveedor ->> 'ruc', '') <> '' then
    select id into v_prov from public.proveedores where empresa_id = p_empresa and ruc = p_proveedor ->> 'ruc';
  end if;
  if v_prov is null then
    insert into public.proveedores (empresa_id, ruc, razon_social)
    values (p_empresa, nullif(p_proveedor ->> 'ruc', ''), btrim(p_proveedor ->> 'razon_social'))
    returning id into v_prov;
  end if;

  -- Lo leído por IA queda por confirmar hasta que una persona lo apruebe.
  insert into public.compras (empresa_id, proveedor_id, tipo_comprobante, serie, numero, fecha_emision, moneda, tipo_cambio,
                              tasa_igv, subtotal_sin_igv, igv, total, origen_datos, estado, archivo_path)
  values (p_empresa, v_prov, p_compra ->> 'tipo', nullif(p_compra ->> 'serie', ''), nullif(p_compra ->> 'numero', ''),
          (p_compra ->> 'fecha')::date, p_compra ->> 'moneda', (p_compra ->> 'tipo_cambio')::numeric,
          (p_compra ->> 'tasa_igv')::numeric, (p_compra ->> 'sin_igv')::numeric, (p_compra ->> 'igv')::numeric,
          (p_compra ->> 'total')::numeric, v_origen,
          case when v_origen = 'ia' then 'por_confirmar' else 'confirmado' end::public.estado_documento,
          nullif(p_compra ->> 'archivo', ''))
  returning id into v_compra;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.compra_items (empresa_id, compra_id, descripcion, cantidad, precio_unitario_sin_igv, subtotal_sin_igv, igv, total, destino, orden_id, repuesto_id)
    values (p_empresa, v_compra, btrim(v_item ->> 'descripcion'), (v_item ->> 'cantidad')::numeric, (v_item ->> 'precio_sin_igv')::numeric,
            (v_item ->> 'sin_igv')::numeric, (v_item ->> 'igv')::numeric, (v_item ->> 'total')::numeric,
            case when nullif(v_item ->> 'orden', '') is null then 'stock' else 'orden' end, nullif(v_item ->> 'orden', '')::uuid,
            case when nullif(v_item ->> 'orden', '') is null then nullif(v_item ->> 'repuesto', '')::uuid end);
  end loop;
  return v_compra;
end;
$$;
