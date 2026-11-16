-- =====================================================================
-- Recibos de venta, gastos del taller y datos para los documentos
-- ---------------------------------------------------------------------
-- 1. Datos del taller que salen en los PDF: correo, lema y logo.
-- 2. Carrocería del carro y nivel de combustible al recibirlo.
-- 3. Recibo de venta numerado (lo que se le entrega al cliente al cobrar):
--    cuenta como venta cuando la orden no tiene boleta ni factura.
-- 4. Gastos del taller (alquiler, luz, agua…) para la utilidad neta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Datos del taller para los documentos
-- ---------------------------------------------------------------------
alter table public.empresas
  add column correo text check (correo is null or (char_length(correo) <= 120 and correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  add column lema text check (lema is null or char_length(lema) <= 160),
  add column logo_ruta text check (logo_ruta is null or char_length(logo_ruta) <= 200);

-- Número desde el que siguen los recibos (para continuar la numeración del sistema anterior).
alter table public.configuracion_empresa
  add column recibo_inicial integer not null default 1 check (recibo_inicial between 1 and 99999999);

-- Logo del taller: carpeta {empresa}/ en el bucket «marca».
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', false, 1048576, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;

create policy "marca: ver" on storage.objects for select to authenticated
  using (bucket_id = 'marca' and privado.es_miembro(((storage.foldername(name))[1])::uuid));
create policy "marca: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and privado.es_gestor(((storage.foldername(name))[1])::uuid));
create policy "marca: cambiar" on storage.objects for update to authenticated
  using (bucket_id = 'marca' and privado.es_gestor(((storage.foldername(name))[1])::uuid));
create policy "marca: quitar" on storage.objects for delete to authenticated
  using (bucket_id = 'marca' and privado.es_gestor(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- 2. Carro: carrocería; orden: nivel de combustible al ingresar
-- ---------------------------------------------------------------------
alter table public.vehiculos
  add column carroceria text check (carroceria is null or carroceria in ('sedan', 'hatchback', 'suv', 'camioneta', 'pickup', 'van', 'coupe', 'station_wagon', 'otro'));
alter table public.ordenes_trabajo
  add column nivel_combustible smallint check (nivel_combustible is null or nivel_combustible in (0, 25, 50, 75, 100));

-- ---------------------------------------------------------------------
-- 3. Recibos de venta
-- ---------------------------------------------------------------------
create table public.recibos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id),
  numero integer not null,
  emitido_en timestamptz not null default now(),
  tasa_igv numeric(5, 4) not null check (tasa_igv between 0 and 0.5),
  subtotal_sin_igv numeric(12, 2) not null check (subtotal_sin_igv >= 0),
  igv numeric(12, 2) not null check (igv >= 0),
  total numeric(12, 2) not null check (total > 0),
  observaciones text check (observaciones is null or char_length(observaciones) <= 300),
  estado public.estado_documento not null default 'confirmado',
  confirmado_por uuid,
  confirmado_en timestamptz,
  anulado_por uuid,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, numero),
  check (abs(subtotal_sin_igv + igv - total) <= 0.05)
);
-- Un solo recibo vigente por orden.
create unique index recibos_uno_por_orden on public.recibos (orden_id) where estado <> 'anulado';
create index recibos_fecha on public.recibos (empresa_id, emitido_en);

create function privado.numerar_recibo() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('recibo-' || new.empresa_id::text));
  select greatest(coalesce(max(r.numero), 0) + 1, coalesce((select c.recibo_inicial from public.configuracion_empresa c where c.empresa_id = new.empresa_id), 1))
    into new.numero
  from public.recibos r where r.empresa_id = new.empresa_id;
  return new;
end;
$$;

create trigger recibos_numerar before insert on public.recibos for each row execute function privado.numerar_recibo();
create trigger recibos_sellar before insert or update on public.recibos for each row execute function privado.sellar();
create trigger recibos_proteger before update or delete on public.recibos for each row execute function privado.proteger_dinero();
create trigger recibos_auditar after insert or update or delete on public.recibos for each row execute function privado.auditar();

alter table public.recibos enable row level security;
revoke all on public.recibos from anon;
revoke insert, delete on public.recibos from authenticated;
create policy "recibos: ver" on public.recibos for select to authenticated using (privado.ve_caja(empresa_id));
create policy "recibos: anular" on public.recibos for update to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));

-- Emite el recibo de una orden con el total de sus cotizaciones aprobadas.
-- Lo hacen quienes atienden al cliente (gerencia, administración, asesor y recepción).
create function public.emitir_recibo(p_orden uuid, p_observaciones text default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo;
  v_tasa numeric;
  v_sin numeric;
  v_igv numeric;
  v_total numeric;
  v_id uuid;
begin
  select * into v_orden from public.ordenes_trabajo where id = p_orden;
  if not found or v_orden.anulada then
    raise exception 'La orden no existe o está anulada.' using errcode = 'no_data_found';
  end if;
  if not privado.ve_caja(v_orden.empresa_id) then
    raise exception 'Tu rol no emite recibos.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.recibos where orden_id = p_orden and estado <> 'anulado') then
    raise exception 'Esta orden ya tiene un recibo. Para emitir otro, anula el anterior.' using errcode = 'unique_violation';
  end if;
  select coalesce(sum(subtotal_sin_igv), 0), coalesce(sum(igv), 0), coalesce(sum(total), 0), coalesce(max(tasa_igv), 0)
    into v_sin, v_igv, v_total, v_tasa
  from public.cotizaciones where orden_id = p_orden and estado = 'aprobada';
  if v_total <= 0 then
    raise exception 'La orden no tiene una cotización aprobada: apruébala primero para saber qué se cobra.' using errcode = 'check_violation';
  end if;
  insert into public.recibos (empresa_id, orden_id, tasa_igv, subtotal_sin_igv, igv, total, observaciones)
  values (v_orden.empresa_id, p_orden, v_tasa, v_sin, v_igv, v_total, nullif(btrim(coalesce(p_observaciones, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.emitir_recibo(uuid, text) from public, anon;
grant execute on function public.emitir_recibo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Gastos del taller
-- ---------------------------------------------------------------------
create table public.gastos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  fecha date not null,
  categoria text not null check (categoria in (
    'alquiler', 'luz', 'agua', 'internet_telefono', 'sueldos', 'movilidad', 'publicidad',
    'herramientas', 'limpieza', 'impuestos', 'mantenimiento_local', 'contador', 'otros'
  )),
  descripcion text not null check (char_length(btrim(descripcion)) between 2 and 200),
  monto numeric(12, 2) not null check (monto > 0),
  medio text check (medio is null or medio in ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia')),
  comprobante text check (comprobante is null or char_length(comprobante) <= 40),
  estado public.estado_documento not null default 'confirmado',
  confirmado_por uuid,
  confirmado_en timestamptz,
  anulado_por uuid,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create index gastos_fecha on public.gastos (empresa_id, fecha);

create trigger gastos_sellar before insert or update on public.gastos for each row execute function privado.sellar();
create trigger gastos_proteger before update or delete on public.gastos for each row execute function privado.proteger_dinero();
create trigger gastos_auditar after insert or update or delete on public.gastos for each row execute function privado.auditar();

alter table public.gastos enable row level security;
revoke all on public.gastos from anon;
revoke delete on public.gastos from authenticated;
create policy "gastos: ver" on public.gastos for select to authenticated using (privado.es_gestor(empresa_id));
create policy "gastos: registrar" on public.gastos for insert to authenticated
  with check (privado.es_gestor(empresa_id) and estado = 'confirmado');
create policy "gastos: anular" on public.gastos for update to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));

-- ---------------------------------------------------------------------
-- 5. PDF que se mandan por WhatsApp
-- ---------------------------------------------------------------------
-- La app arma el PDF con la sesión de quien lo pide (sus permisos) y lo deja
-- aquí un momento para que WhatsApp lo descargue con un enlace que vence.
-- Solo el servidor escribe y lee este bucket (sin políticas para usuarios).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- La auditoría de WhatsApp registra también los documentos enviados.
alter table public.mensajes_whatsapp drop constraint mensajes_whatsapp_resultado_check;
alter table public.mensajes_whatsapp add constraint mensajes_whatsapp_resultado_check check (resultado in (
  'recibido', 'borrador', 'pide_dato', 'confirmado', 'corregido', 'respondido', 'sin_acceso', 'rechazado', 'error', 'encuesta', 'cotizacion', 'documento'
));
