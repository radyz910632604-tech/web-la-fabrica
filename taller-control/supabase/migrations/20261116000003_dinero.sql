-- =====================================================================
-- 0003 · Dinero: compras, comprobantes de venta, cotizaciones, pagos,
--        costos del personal, reglas de comisión y cierres diarios.
--
-- Reglas (especificación 5.4 a 5.8):
--   * Montos siempre con y sin IGV; la tasa queda guardada en cada documento.
--   * Nada con dinero se borra: se anula con motivo (mínimo 5 letras).
--   * Lo leído por IA (Fase 2) queda "por_confirmar"; lo escrito a mano o
--     leído del XML de SUNAT queda "confirmado".
--   * Quién ve qué:
--       compras y proveedores: gerencia, administración, asesor, almacén
--       ventas, cotizaciones, pagos: gerencia, administración, asesor
--       costos del personal: gerencia (administración si gerencia lo permite)
--       reglas de comisión: gerencia
-- =====================================================================

create type public.estado_documento as enum ('por_confirmar', 'confirmado', 'anulado');

-- Puede ver sueldos: gerencia, o administración si gerencia lo permitió.
create function privado.ve_sueldos(p_empresa uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.tiene_rol(p_empresa, array['gerencia']::public.rol_t[])
    or (
      privado.tiene_rol(p_empresa, array['administrador']::public.rol_t[])
      and exists (select 1 from public.configuracion_empresa c where c.empresa_id = p_empresa and c.admin_ve_sueldos)
    );
$$;
revoke all on function privado.ve_sueldos(uuid) from public, anon;
grant execute on function privado.ve_sueldos(uuid) to authenticated, service_role;

-- Anular, no borrar: una vez anulado no cambia más, y anular pide motivo.
create function privado.proteger_dinero() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los registros con dinero no se borran: se anulan con motivo.' using errcode = 'insufficient_privilege';
  end if;
  if old.estado = 'anulado' then
    raise exception 'Este registro está anulado y ya no se puede cambiar.' using errcode = 'check_violation';
  end if;
  -- Un registro confirmado no se edita (salvo asignarlo a una orden): se anula y se registra de nuevo.
  if old.estado = 'confirmado' and new.estado = 'confirmado'
     and (to_jsonb(new) - array['actualizado_en', 'actualizado_por', 'orden_id'])
         is distinct from (to_jsonb(old) - array['actualizado_en', 'actualizado_por', 'orden_id']) then
    raise exception 'Un registro confirmado no se edita: anúlalo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  if new.estado = 'anulado' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 5 then
      raise exception 'Para anular escribe el motivo.' using errcode = 'check_violation';
    end if;
    new.anulado_en := now();
    new.anulado_por := auth.uid();
  end if;
  if new.estado = 'confirmado' and old.estado = 'por_confirmar' then
    new.confirmado_en := now();
    new.confirmado_por := auth.uid();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Proveedores y compras
-- ---------------------------------------------------------------------
create table public.proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  ruc text check (ruc is null or ruc ~ '^(10|15|17|20)[0-9]{9}$'),
  razon_social text not null check (char_length(btrim(razon_social)) between 2 and 160),
  celular text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create unique index proveedores_ruc on public.proveedores (empresa_id, ruc) where ruc is not null;

create table public.compras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  proveedor_id uuid not null references public.proveedores (id),
  tipo_comprobante text not null check (tipo_comprobante in ('factura', 'boleta', 'nota_venta', 'ticket', 'sin_comprobante')),
  serie text check (serie is null or serie ~ '^[A-Z0-9]{1,4}$'),
  numero text check (numero is null or numero ~ '^[0-9]{1,8}$'),
  fecha_emision date not null,
  moneda text not null default 'PEN' check (moneda in ('PEN', 'USD')),
  tipo_cambio numeric(8, 4) not null default 1 check (tipo_cambio > 0),
  tasa_igv numeric(5, 4) not null check (tasa_igv between 0 and 0.5),
  subtotal_sin_igv numeric(12, 2) not null check (subtotal_sin_igv >= 0),
  igv numeric(12, 2) not null check (igv >= 0),
  total numeric(12, 2) not null check (total >= 0),
  estado public.estado_documento not null default 'confirmado',
  origen_datos text not null default 'manual' check (origen_datos in ('manual', 'xml_sunat', 'ia')),
  confirmado_por uuid,
  confirmado_en timestamptz,
  anulado_por uuid,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  check (abs(subtotal_sin_igv + igv - total) <= 0.05)
);
create unique index compras_unicas on public.compras (empresa_id, proveedor_id, tipo_comprobante, serie, numero)
  where estado <> 'anulado' and serie is not null and numero is not null;
create index compras_fecha on public.compras (empresa_id, fecha_emision);

create table public.compra_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  compra_id uuid not null references public.compras (id) on delete cascade,
  descripcion text not null check (char_length(btrim(descripcion)) between 2 and 200),
  cantidad numeric(10, 2) not null check (cantidad > 0),
  precio_unitario_sin_igv numeric(12, 4) not null check (precio_unitario_sin_igv >= 0),
  subtotal_sin_igv numeric(12, 2) not null check (subtotal_sin_igv >= 0),
  igv numeric(12, 2) not null check (igv >= 0),
  total numeric(12, 2) not null check (total >= 0),
  destino text not null default 'stock' check (destino in ('orden', 'stock')),
  orden_id uuid references public.ordenes_trabajo (id),
  creado_en timestamptz not null default now(),
  check ((destino = 'orden') = (orden_id is not null))
);
create index compra_items_compra on public.compra_items (compra_id);
create index compra_items_orden on public.compra_items (orden_id) where orden_id is not null;

-- ---------------------------------------------------------------------
-- Comprobantes de venta (el sistema no emite: registra los que ya se emitieron)
-- ---------------------------------------------------------------------
create table public.comprobantes_venta (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid references public.ordenes_trabajo (id),
  tipo text not null check (tipo in ('boleta', 'factura')),
  serie text not null check (serie ~ '^[A-Z0-9]{1,4}$'),
  numero text not null check (numero ~ '^[0-9]{1,8}$'),
  fecha_emision date not null,
  documento_cliente text,
  tasa_igv numeric(5, 4) not null check (tasa_igv between 0 and 0.5),
  subtotal_sin_igv numeric(12, 2) not null check (subtotal_sin_igv >= 0),
  igv numeric(12, 2) not null check (igv >= 0),
  total numeric(12, 2) not null check (total >= 0),
  detalle text check (detalle is null or char_length(detalle) <= 2000),
  estado public.estado_documento not null default 'confirmado',
  origen_datos text not null default 'manual' check (origen_datos in ('manual', 'xml_sunat', 'ia')),
  confirmado_por uuid,
  confirmado_en timestamptz,
  anulado_por uuid,
  anulado_en timestamptz,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  check (abs(subtotal_sin_igv + igv - total) <= 0.05)
);
create unique index comprobantes_unicos on public.comprobantes_venta (empresa_id, tipo, serie, numero) where estado <> 'anulado';
create index comprobantes_orden on public.comprobantes_venta (orden_id);
create index comprobantes_fecha on public.comprobantes_venta (empresa_id, fecha_emision);

-- ---------------------------------------------------------------------
-- Cotizaciones (la aprobación por WhatsApp llega en la Fase 2; aquí se registra a mano)
-- ---------------------------------------------------------------------
create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id),
  version integer not null,
  es_adicional boolean not null default false,
  estado text not null default 'borrador' check (estado in ('borrador', 'enviada', 'aprobada', 'rechazada', 'anulada')),
  enviada_en timestamptz,
  respuesta_en timestamptz,
  aprobada_por_medio text check (aprobada_por_medio is null or aprobada_por_medio in ('whatsapp', 'presencial', 'llamada')),
  respuesta_texto text,
  tasa_igv numeric(5, 4) not null,
  subtotal_sin_igv numeric(12, 2) not null default 0,
  igv numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (orden_id, version)
);

create table public.cotizacion_items (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  cotizacion_id uuid not null references public.cotizaciones (id) on delete cascade,
  tipo text not null check (tipo in ('servicio', 'repuesto')),
  descripcion text not null check (char_length(btrim(descripcion)) between 2 and 200),
  cantidad numeric(10, 2) not null check (cantidad > 0),
  precio_unitario_total numeric(12, 2) not null check (precio_unitario_total >= 0),
  subtotal_sin_igv numeric(12, 2) not null,
  igv numeric(12, 2) not null,
  total numeric(12, 2) not null
);
create index cotizacion_items_cot on public.cotizacion_items (cotizacion_id);

-- ---------------------------------------------------------------------
-- Pagos del cliente
-- ---------------------------------------------------------------------
create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id),
  monto numeric(12, 2) not null check (monto > 0),
  tipo text not null check (tipo in ('adelanto', 'saldo')),
  medio text not null check (medio in ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia')),
  pagado_en timestamptz not null default now(),
  numero_operacion text check (numero_operacion is null or char_length(numero_operacion) <= 40),
  estado public.estado_documento not null default 'confirmado',
  origen text not null default 'app' check (origen in ('app', 'whatsapp')),
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
create index pagos_orden on public.pagos (orden_id);
create index pagos_fecha on public.pagos (empresa_id, pagado_en);

-- ---------------------------------------------------------------------
-- Personal: costo mensual, mano de obra fija por servicio, reglas de comisión
-- ---------------------------------------------------------------------
create table public.costos_personal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  perfil_id uuid not null references public.perfiles (id) on delete cascade,
  costo_mensual numeric(12, 2) not null check (costo_mensual >= 0),
  vigente_desde date not null default current_date,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, perfil_id, vigente_desde)
);

create table public.mano_obra_servicio (
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  servicio_id uuid not null references public.catalogo_servicios (id) on delete cascade,
  monto numeric(12, 2) not null check (monto >= 0),
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  primary key (empresa_id, servicio_id)
);

create table public.reglas_comision (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 80),
  evento text not null check (evento in ('cita_llego_y_pago', 'trabajo_entregado')),
  tipo_monto text not null check (tipo_monto in ('fijo', 'porcentaje')),
  valor numeric(10, 2) not null check (valor >= 0),
  activa boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  check (tipo_monto <> 'porcentaje' or valor <= 100)
);

-- ---------------------------------------------------------------------
-- Cierre diario: una foto del día cuando alguien lo cierra
-- ---------------------------------------------------------------------
create table public.cierres_diarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  fecha date not null,
  datos jsonb not null,
  observaciones text check (observaciones is null or char_length(observaciones) <= 1000),
  cerrado_por uuid default auth.uid(),
  cerrado_en timestamptz not null default now(),
  unique (empresa_id, fecha)
);

-- ---------------------------------------------------------------------
-- Disparadores: sellos, auditoría y protección del dinero
-- ---------------------------------------------------------------------
create trigger proveedores_sellar before insert or update on public.proveedores for each row execute function privado.sellar();
create trigger proveedores_auditar after insert or update or delete on public.proveedores for each row execute function privado.auditar();
create trigger compras_sellar before insert or update on public.compras for each row execute function privado.sellar();
create trigger compras_proteger before update or delete on public.compras for each row execute function privado.proteger_dinero();
create trigger compras_auditar after insert or update or delete on public.compras for each row execute function privado.auditar();
create trigger compra_items_auditar after insert or update or delete on public.compra_items for each row execute function privado.auditar();
create trigger comprobantes_sellar before insert or update on public.comprobantes_venta for each row execute function privado.sellar();
create trigger comprobantes_proteger before update or delete on public.comprobantes_venta for each row execute function privado.proteger_dinero();
create trigger comprobantes_auditar after insert or update or delete on public.comprobantes_venta for each row execute function privado.auditar();
create trigger cotizaciones_sellar before insert or update on public.cotizaciones for each row execute function privado.sellar();
create trigger cotizaciones_auditar after insert or update or delete on public.cotizaciones for each row execute function privado.auditar();
create trigger pagos_sellar before insert or update on public.pagos for each row execute function privado.sellar();
create trigger pagos_proteger before update or delete on public.pagos for each row execute function privado.proteger_dinero();
create trigger pagos_auditar after insert or update or delete on public.pagos for each row execute function privado.auditar();
create trigger costos_sellar before insert or update on public.costos_personal for each row execute function privado.sellar();
create trigger costos_auditar after insert or update or delete on public.costos_personal for each row execute function privado.auditar();
create trigger reglas_sellar before insert or update on public.reglas_comision for each row execute function privado.sellar();
create trigger reglas_auditar after insert or update or delete on public.reglas_comision for each row execute function privado.auditar();
create trigger cierres_auditar after insert or update or delete on public.cierres_diarios for each row execute function privado.auditar();

-- Las líneas de una compra solo cambian mientras la compra no esté anulada.
create function privado.proteger_items_compra() returns trigger
language plpgsql
set search_path = ''
as $$
declare v_estado public.estado_documento;
begin
  select estado into v_estado from public.compras where id = coalesce(new.compra_id, old.compra_id);
  if v_estado = 'anulado' then
    raise exception 'La compra está anulada.' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger compra_items_proteger before insert or update or delete on public.compra_items
  for each row execute function privado.proteger_items_compra();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.proveedores enable row level security;
alter table public.compras enable row level security;
alter table public.compra_items enable row level security;
alter table public.comprobantes_venta enable row level security;
alter table public.cotizaciones enable row level security;
alter table public.cotizacion_items enable row level security;
alter table public.pagos enable row level security;
alter table public.costos_personal enable row level security;
alter table public.mano_obra_servicio enable row level security;
alter table public.reglas_comision enable row level security;
alter table public.cierres_diarios enable row level security;

revoke all on public.proveedores, public.compras, public.compra_items, public.comprobantes_venta, public.cotizaciones,
  public.cotizacion_items, public.pagos, public.costos_personal, public.mano_obra_servicio, public.reglas_comision,
  public.cierres_diarios from anon;
revoke delete on public.compras, public.comprobantes_venta, public.pagos, public.cierres_diarios from authenticated;

-- Compras: las ven gerencia, administración, asesor y almacén; las registran gerencia, administración y almacén.
create policy "proveedores: ver" on public.proveedores for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[]));
create policy "proveedores: crear" on public.proveedores for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));
create policy "proveedores: cambiar" on public.proveedores for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));

create policy "compras: ver" on public.compras for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[]));
create policy "compras: crear" on public.compras for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));
create policy "compras: cambiar" on public.compras for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));

create policy "líneas de compra: ver" on public.compra_items for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[]));
create policy "líneas de compra: crear" on public.compra_items for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));
create policy "líneas de compra: cambiar" on public.compra_items for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));
create policy "líneas de compra: quitar" on public.compra_items for delete to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));

-- Ventas, cotizaciones y pagos: gerencia, administración y asesor (almacén no ve ventas).
create policy "comprobantes: ver" on public.comprobantes_venta for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "comprobantes: crear" on public.comprobantes_venta for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "comprobantes: cambiar" on public.comprobantes_venta for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));

create policy "cotizaciones: ver" on public.cotizaciones for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "cotizaciones: crear" on public.cotizaciones for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "cotizaciones: cambiar" on public.cotizaciones for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "líneas de cotización: ver" on public.cotizacion_items for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "líneas de cotización: crear" on public.cotizacion_items for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "líneas de cotización: quitar" on public.cotizacion_items for delete to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));

create policy "pagos: ver" on public.pagos for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "pagos: crear" on public.pagos for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "pagos: anular" on public.pagos for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));

-- Sueldos: solo gerencia (o administración con permiso).
create policy "costos del personal: ver" on public.costos_personal for select to authenticated using (privado.ve_sueldos(empresa_id));
create policy "costos del personal: crear" on public.costos_personal for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]));
create policy "costos del personal: cambiar" on public.costos_personal for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]));

create policy "mano de obra: ver" on public.mano_obra_servicio for select to authenticated using (privado.ve_sueldos(empresa_id));
create policy "mano de obra: escribir" on public.mano_obra_servicio for all to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]));

create policy "comisiones: ver" on public.reglas_comision for select to authenticated using (privado.ve_sueldos(empresa_id));
create policy "comisiones: escribir" on public.reglas_comision for all to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia']::public.rol_t[]));

-- Cierre diario: lo hacen gerencia, administración y asesor.
create policy "cierres: ver" on public.cierres_diarios for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "cierres: crear" on public.cierres_diarios for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
