-- =====================================================================
-- 0002 · Taller: servicios, clientes, vehículos, órdenes, fotos y citas
--
-- Quién ve qué (especificación, sección 4):
--   gerencia, administrador, asesor: todo lo del taller.
--   almacén: órdenes y carros (para entregar repuestos), no clientes.
--   técnico: solo las órdenes que tiene asignadas, sin datos del cliente.
--   ventas por redes: clientes, sus propias citas y las órdenes de sus citas.
--   confirmación: clientes y citas, y solo puede marcarlas confirmadas.
-- Aquí no hay montos: el dinero llega en la Fase 3.
-- =====================================================================

create type public.estado_orden as enum ('en_taller', 'en_proceso', 'esperando_repuesto', 'listo', 'entregado');
create type public.estado_cita as enum ('agendada', 'confirmada', 'llego', 'no_llego', 'reagendada', 'cancelada');

-- ---------------------------------------------------------------------
-- Catálogo de servicios del taller
-- ---------------------------------------------------------------------
create table public.catalogo_servicios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 120),
  categoria text not null default 'otro'
    check (categoria in ('transmision', 'gnv_glp', 'aire_acondicionado', 'frenos', 'aceite', 'otro')),
  precio_referencial numeric(12, 2) check (precio_referencial is null or precio_referencial >= 0),
  dias_garantia integer check (dias_garantia is null or dias_garantia between 0 and 1095),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, nombre)
);

-- ---------------------------------------------------------------------
-- Clientes (el celular es su identificador dentro de cada taller)
-- ---------------------------------------------------------------------
create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  nombre text not null check (char_length(btrim(nombre)) between 2 and 120),
  celular text not null check (celular ~ '^\+[1-9][0-9]{7,14}$'),
  tipo_documento text not null default 'ninguno' check (tipo_documento in ('dni', 'ruc', 'ce', 'ninguno')),
  numero_documento text,
  origen text not null default 'otro' check (origen in ('redes', 'referido', 'recurrente', 'otro')),
  acepta_mensajes boolean not null default false,
  acepta_mensajes_en timestamptz,
  notas text check (notas is null or char_length(notas) <= 1000),
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, celular),
  check (
    (tipo_documento = 'ninguno' and numero_documento is null)
    or (tipo_documento = 'dni' and numero_documento ~ '^[0-9]{8}$')
    or (tipo_documento = 'ruc' and numero_documento ~ '^(10|15|17|20)[0-9]{9}$')
    or (tipo_documento = 'ce' and numero_documento ~ '^[A-Z0-9]{6,12}$')
  )
);
create index clientes_nombre on public.clientes (empresa_id, lower(nombre));

-- ---------------------------------------------------------------------
-- Vehículos (placa única por taller; se guarda sin guion)
-- ---------------------------------------------------------------------
create table public.vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  placa text not null check (placa ~ '^[A-Z0-9]{4,8}$'),
  marca text check (marca is null or char_length(marca) <= 40),
  modelo text check (modelo is null or char_length(modelo) <= 60),
  anio integer check (anio is null or anio between 1950 and 2100),
  color text check (color is null or char_length(color) <= 30),
  combustible text check (combustible is null or combustible in ('gasolina', 'diesel', 'gnv', 'glp', 'dual', 'electrico', 'hibrido')),
  transmision text check (transmision is null or transmision in ('mecanica', 'automatica', 'cvt', 'otra')),
  kilometraje_actual integer check (kilometraje_actual is null or kilometraje_actual >= 0),
  cliente_id uuid references public.clientes (id) on delete set null,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, placa)
);
create index vehiculos_cliente on public.vehiculos (cliente_id);

-- ---------------------------------------------------------------------
-- Citas de redes
-- ---------------------------------------------------------------------
create table public.citas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete set null,
  nombre_cliente text not null check (char_length(btrim(nombre_cliente)) between 2 and 120),
  celular text not null check (celular ~ '^\+[1-9][0-9]{7,14}$'),
  fecha_hora timestamptz not null,
  servicio text not null check (char_length(btrim(servicio)) between 2 and 120),
  red text not null check (red in ('facebook', 'instagram', 'tiktok', 'whatsapp', 'google', 'referido', 'otro')),
  campana text check (campana is null or char_length(campana) <= 80),
  vendedor_id uuid references public.perfiles (id) on delete set null,
  estado public.estado_cita not null default 'agendada',
  confirmada_por uuid,
  confirmada_en timestamptz,
  orden_id uuid,
  reprogramada_desde_id uuid references public.citas (id) on delete set null,
  notas text check (notas is null or char_length(notas) <= 500),
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create index citas_dia on public.citas (empresa_id, fecha_hora);
create index citas_celular on public.citas (empresa_id, celular);

-- ---------------------------------------------------------------------
-- Órdenes de trabajo (una por visita). Sin montos.
-- ---------------------------------------------------------------------
create table public.ordenes_trabajo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  numero integer not null,
  vehiculo_id uuid not null references public.vehiculos (id),
  cliente_id uuid not null references public.clientes (id),
  cita_id uuid references public.citas (id) on delete set null,
  kilometraje_ingreso integer check (kilometraje_ingreso is null or kilometraje_ingreso >= 0),
  observaciones_ingreso text check (observaciones_ingreso is null or char_length(observaciones_ingreso) <= 2000),
  tecnico_id uuid references public.perfiles (id) on delete set null,
  estado public.estado_orden not null default 'en_taller',
  estado_cambiado_en timestamptz not null default now(),
  ingresado_en timestamptz not null default now(),
  listo_en timestamptz,
  entregado_en timestamptz,
  es_reingreso_garantia boolean not null default false,
  orden_garantia_origen_id uuid references public.ordenes_trabajo (id) on delete set null,
  origen text not null default 'app' check (origen in ('app', 'whatsapp', 'sistema')),
  anulada boolean not null default false,
  motivo_anulacion text,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, numero),
  check (not anulada or char_length(btrim(coalesce(motivo_anulacion, ''))) >= 5)
);
create index ordenes_estado on public.ordenes_trabajo (empresa_id, estado);
create index ordenes_vehiculo on public.ordenes_trabajo (vehiculo_id, ingresado_en desc);
create index ordenes_tecnico on public.ordenes_trabajo (tecnico_id) where estado <> 'entregado';

alter table public.citas
  add constraint citas_orden_fk foreign key (orden_id) references public.ordenes_trabajo (id) on delete set null;

create table public.orden_servicios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id) on delete cascade,
  servicio_id uuid references public.catalogo_servicios (id) on delete set null,
  descripcion text not null check (char_length(btrim(descripcion)) between 2 and 160),
  es_adicional boolean not null default false,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create index orden_servicios_orden on public.orden_servicios (orden_id);

create table public.orden_estados_historial (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id) on delete cascade,
  estado_anterior public.estado_orden,
  estado_nuevo public.estado_orden not null,
  nota text,
  cambiado_por uuid,
  cambiado_en timestamptz not null default now()
);
create index historial_orden on public.orden_estados_historial (orden_id, cambiado_en);

create table public.orden_avances (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid not null references public.ordenes_trabajo (id) on delete cascade,
  texto text not null check (char_length(btrim(texto)) between 2 and 2000),
  autor_id uuid default auth.uid(),
  origen text not null default 'app' check (origen in ('app', 'whatsapp')),
  creado_en timestamptz not null default now()
);
create index avances_orden on public.orden_avances (orden_id, creado_en);

create table public.archivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  orden_id uuid references public.ordenes_trabajo (id) on delete cascade,
  avance_id uuid references public.orden_avances (id) on delete set null,
  tipo text not null default 'foto' check (tipo in ('foto', 'video', 'pdf', 'xml', 'audio')),
  etapa text not null default 'ingreso' check (etapa in ('ingreso', 'proceso', 'entrega', 'comprobante', 'placa')),
  bucket text not null default 'ordenes',
  ruta text not null unique,
  mime text,
  tamano_bytes integer,
  ancho integer,
  alto integer,
  subido_por uuid default auth.uid(),
  creado_en timestamptz not null default now()
);
create index archivos_orden on public.archivos (orden_id, creado_en);

-- ---------------------------------------------------------------------
-- Permisos: funciones de apoyo
-- ---------------------------------------------------------------------
create function privado.puede_ver_orden(p_orden uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ordenes_trabajo o
    where o.id = p_orden
      and (
        privado.tiene_rol(o.empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[])
        or (o.tecnico_id = (select auth.uid()) and privado.tiene_rol(o.empresa_id, array['tecnico']::public.rol_t[]))
        or (
          privado.tiene_rol(o.empresa_id, array['vendedor_redes']::public.rol_t[])
          and exists (select 1 from public.citas c where c.orden_id = o.id and c.vendedor_id = (select auth.uid()))
        )
      )
  );
$$;

-- Puede agregar avances y fotos: quien atiende la orden (no almacén ni ventas).
create function privado.puede_trabajar_orden(p_orden uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ordenes_trabajo o
    where o.id = p_orden
      and (
        privado.tiene_rol(o.empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[])
        or (o.tecnico_id = (select auth.uid()) and privado.tiene_rol(o.empresa_id, array['tecnico']::public.rol_t[]))
      )
  );
$$;

create function privado.puede_ver_vehiculo(p_vehiculo uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vehiculos v
    where v.id = p_vehiculo
      and (
        privado.tiene_rol(v.empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen', 'vendedor_redes']::public.rol_t[])
        or exists (
          select 1 from public.ordenes_trabajo o
          where o.vehiculo_id = v.id and o.tecnico_id = (select auth.uid())
            and privado.tiene_rol(v.empresa_id, array['tecnico']::public.rol_t[])
        )
      )
  );
$$;

revoke all on function privado.puede_ver_orden(uuid) from public, anon;
revoke all on function privado.puede_trabajar_orden(uuid) from public, anon;
revoke all on function privado.puede_ver_vehiculo(uuid) from public, anon;
grant execute on function privado.puede_ver_orden(uuid) to authenticated, service_role;
grant execute on function privado.puede_trabajar_orden(uuid) to authenticated, service_role;
grant execute on function privado.puede_ver_vehiculo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Disparadores
-- ---------------------------------------------------------------------

-- Fecha del permiso para recibir mensajes.
create function privado.fecha_consentimiento() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.acepta_mensajes is distinct from old.acepta_mensajes then
    new.acepta_mensajes_en := now();
  end if;
  return new;
end;
$$;

-- Número correlativo de orden por taller (OT-000001, OT-000002…).
create function privado.numerar_orden() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('orden-' || new.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into new.numero
  from public.ordenes_trabajo where empresa_id = new.empresa_id;
  return new;
end;
$$;

-- Fechas de estado: cuándo cambió, cuándo quedó listo, cuándo se entregó.
create function privado.fechas_estado_orden() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    new.estado_cambiado_en := now();
    if new.estado = 'listo' and new.listo_en is null then new.listo_en := now(); end if;
    if new.estado = 'entregado' then
      new.entregado_en := now();
      if new.listo_en is null then new.listo_en := now(); end if;
    end if;
    if new.estado not in ('listo', 'entregado') then
      new.listo_en := null;
      new.entregado_en := null;
    end if;
  end if;
  return new;
end;
$$;

-- Cada cambio de estado queda en el historial (con la nota, si la hubo).
create function privado.historial_estado_orden() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.estado is distinct from old.estado then
    insert into public.orden_estados_historial (empresa_id, orden_id, estado_anterior, estado_nuevo, nota, cambiado_por)
    values (
      new.empresa_id, new.id,
      case when tg_op = 'UPDATE' then old.estado end,
      new.estado,
      nullif(current_setting('app.nota_estado', true), ''),
      auth.uid()
    );
  end if;
  return null;
end;
$$;

-- Al crear la orden: se une con la cita del mismo celular ese día (hora de Lima)
-- y se actualiza el kilometraje del carro.
create function privado.al_crear_orden() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_celular text;
  v_cita uuid;
begin
  select celular into v_celular from public.clientes where id = new.cliente_id;

  if new.cita_id is null then
    select c.id into v_cita
    from public.citas c
    where c.empresa_id = new.empresa_id
      and (c.celular = v_celular or c.cliente_id = new.cliente_id)
      and c.estado in ('agendada', 'confirmada', 'no_llego')
      and c.orden_id is null
      and (c.fecha_hora at time zone 'America/Lima')::date = (new.ingresado_en at time zone 'America/Lima')::date
    order by abs(extract(epoch from (c.fecha_hora - new.ingresado_en)))
    limit 1;
  else
    v_cita := new.cita_id;
  end if;

  if v_cita is not null then
    update public.citas
      set estado = 'llego', orden_id = new.id, cliente_id = coalesce(cliente_id, new.cliente_id)
      where id = v_cita;
    update public.ordenes_trabajo set cita_id = v_cita where id = new.id and cita_id is distinct from v_cita;
  end if;

  if new.kilometraje_ingreso is not null then
    update public.vehiculos
      set kilometraje_actual = new.kilometraje_ingreso
      where id = new.vehiculo_id and (kilometraje_actual is null or kilometraje_actual < new.kilometraje_ingreso);
  end if;
  return null;
end;
$$;

-- Reingreso por garantía: el carro vuelve por el mismo servicio dentro del plazo.
create function privado.marcar_garantia() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo;
  v_dias integer;
  v_origen uuid;
begin
  select * into v_orden from public.ordenes_trabajo where id = new.orden_id;
  if v_orden.es_reingreso_garantia then return null; end if;

  select coalesce(s.dias_garantia, c.dias_garantia_defecto) into v_dias
  from public.configuracion_empresa c
  left join public.catalogo_servicios s on s.id = new.servicio_id
  where c.empresa_id = v_orden.empresa_id;

  select o.id into v_origen
  from public.ordenes_trabajo o
  join public.orden_servicios os on os.orden_id = o.id
  where o.vehiculo_id = v_orden.vehiculo_id
    and o.id <> v_orden.id
    and o.estado = 'entregado'
    and not o.anulada
    and o.entregado_en >= v_orden.ingresado_en - make_interval(days => coalesce(v_dias, 0))
    and o.entregado_en <= v_orden.ingresado_en
    and (
      (new.servicio_id is not null and os.servicio_id = new.servicio_id)
      or lower(btrim(os.descripcion)) = lower(btrim(new.descripcion))
    )
  order by o.entregado_en desc
  limit 1;

  if v_origen is not null then
    update public.ordenes_trabajo
      set es_reingreso_garantia = true, orden_garantia_origen_id = v_origen
      where id = v_orden.id;
  end if;
  return null;
end;
$$;

-- Cada taller nuevo empieza con los servicios típicos (se pueden cambiar).
create function privado.catalogo_inicial(p_empresa uuid) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.catalogo_servicios (empresa_id, nombre, categoria) values
    (p_empresa, 'Cambio de aceite y filtro', 'aceite'),
    (p_empresa, 'Mantenimiento de caja automática', 'transmision'),
    (p_empresa, 'Diagnóstico de caja automática', 'transmision'),
    (p_empresa, 'Reparación de embrague', 'transmision'),
    (p_empresa, 'Conversión a GNV', 'gnv_glp'),
    (p_empresa, 'Revisión anual de GNV', 'gnv_glp'),
    (p_empresa, 'Revisión de GLP', 'gnv_glp'),
    (p_empresa, 'Carga de aire acondicionado', 'aire_acondicionado'),
    (p_empresa, 'Reparación de aire acondicionado', 'aire_acondicionado'),
    (p_empresa, 'Cambio de pastillas de freno', 'frenos'),
    (p_empresa, 'Rectificado de discos', 'frenos'),
    (p_empresa, 'Diagnóstico general', 'otro')
  on conflict (empresa_id, nombre) do nothing;
$$;

create function privado.catalogo_al_crear_empresa() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform privado.catalogo_inicial(new.id);
  return null;
end;
$$;

create trigger empresas_catalogo after insert on public.empresas
  for each row execute function privado.catalogo_al_crear_empresa();
select privado.catalogo_inicial(id) from public.empresas;

-- Sellos y auditoría
create trigger catalogo_sellar before insert or update on public.catalogo_servicios for each row execute function privado.sellar();
create trigger catalogo_auditar after insert or update or delete on public.catalogo_servicios for each row execute function privado.auditar();
create trigger clientes_sellar before insert or update on public.clientes for each row execute function privado.sellar();
create trigger clientes_consentimiento before insert or update on public.clientes for each row execute function privado.fecha_consentimiento();
create trigger clientes_auditar after insert or update or delete on public.clientes for each row execute function privado.auditar();
create trigger vehiculos_sellar before insert or update on public.vehiculos for each row execute function privado.sellar();
create trigger vehiculos_auditar after insert or update or delete on public.vehiculos for each row execute function privado.auditar();
create trigger citas_sellar before insert or update on public.citas for each row execute function privado.sellar();
create trigger citas_auditar after insert or update or delete on public.citas for each row execute function privado.auditar();
create trigger ordenes_numerar before insert on public.ordenes_trabajo for each row execute function privado.numerar_orden();
create trigger ordenes_sellar before insert or update on public.ordenes_trabajo for each row execute function privado.sellar();
create trigger ordenes_fechas before insert or update on public.ordenes_trabajo for each row execute function privado.fechas_estado_orden();
create trigger ordenes_historial after insert or update on public.ordenes_trabajo for each row execute function privado.historial_estado_orden();
create trigger ordenes_al_crear after insert on public.ordenes_trabajo for each row execute function privado.al_crear_orden();
create trigger ordenes_auditar after insert or update or delete on public.ordenes_trabajo for each row execute function privado.auditar();
create trigger orden_servicios_sellar before insert or update on public.orden_servicios for each row execute function privado.sellar();
create trigger orden_servicios_garantia after insert on public.orden_servicios for each row execute function privado.marcar_garantia();
create trigger orden_servicios_auditar after insert or update or delete on public.orden_servicios for each row execute function privado.auditar();
create trigger avances_auditar after insert or update or delete on public.orden_avances for each row execute function privado.auditar();
create trigger archivos_auditar after insert or update or delete on public.archivos for each row execute function privado.auditar();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.catalogo_servicios enable row level security;
alter table public.clientes enable row level security;
alter table public.vehiculos enable row level security;
alter table public.citas enable row level security;
alter table public.ordenes_trabajo enable row level security;
alter table public.orden_servicios enable row level security;
alter table public.orden_estados_historial enable row level security;
alter table public.orden_avances enable row level security;
alter table public.archivos enable row level security;

revoke all on public.catalogo_servicios, public.clientes, public.vehiculos, public.citas, public.ordenes_trabajo,
  public.orden_servicios, public.orden_estados_historial, public.orden_avances, public.archivos from anon;

-- Catálogo: lo ven quienes registran ingresos y citas; lo cambian gerencia y administración.
create policy "catálogo: ver" on public.catalogo_servicios for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes', 'confirmador']::public.rol_t[]));
create policy "catálogo: crear" on public.catalogo_servicios for insert to authenticated with check (privado.es_gestor(empresa_id));
create policy "catálogo: cambiar" on public.catalogo_servicios for update to authenticated
  using (privado.es_gestor(empresa_id)) with check (privado.es_gestor(empresa_id));

-- Clientes: no los ven el técnico ni almacén.
create policy "clientes: ver" on public.clientes for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes', 'confirmador']::public.rol_t[]));
create policy "clientes: crear" on public.clientes for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes']::public.rol_t[]));
create policy "clientes: cambiar" on public.clientes for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes']::public.rol_t[]));

-- Vehículos
-- Las reglas de lectura miran los datos de la propia fila (no la buscan por id):
-- así también sirven al devolver una fila recién creada (INSERT ... RETURNING).
create policy "vehículos: ver" on public.vehiculos for select to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen', 'vendedor_redes']::public.rol_t[])
    or (
      privado.tiene_rol(empresa_id, array['tecnico']::public.rol_t[])
      and exists (select 1 from public.ordenes_trabajo o where o.vehiculo_id = vehiculos.id and o.tecnico_id = (select auth.uid()))
    )
  );
create policy "vehículos: crear" on public.vehiculos for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "vehículos: cambiar" on public.vehiculos for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));

-- Citas: ventas por redes ve y cambia solo las suyas; confirmación solo confirma (con su función).
create policy "citas: ver" on public.citas for select to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'confirmador']::public.rol_t[])
    or (vendedor_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[]))
  );
create policy "citas: crear" on public.citas for insert to authenticated
  with check (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[])
    or (vendedor_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[]))
  );
create policy "citas: cambiar" on public.citas for update to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[])
    or (vendedor_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[]))
  )
  with check (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[])
    or (vendedor_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[]))
  );

-- Órdenes: el estado se cambia con cambiar_estado_orden() (deja la nota en el historial).
create policy "órdenes: ver" on public.ordenes_trabajo for select to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[])
    or (tecnico_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['tecnico']::public.rol_t[]))
    or (
      privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[])
      and exists (select 1 from public.citas c where c.orden_id = ordenes_trabajo.id and c.vendedor_id = (select auth.uid()))
    )
  );
create policy "órdenes: crear" on public.ordenes_trabajo for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));
create policy "órdenes: cambiar" on public.ordenes_trabajo for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));

create policy "servicios de orden: ver" on public.orden_servicios for select to authenticated using (privado.puede_ver_orden(orden_id));
create policy "servicios de orden: crear" on public.orden_servicios for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]) and privado.puede_ver_orden(orden_id));
create policy "servicios de orden: quitar" on public.orden_servicios for delete to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]));

create policy "historial: ver" on public.orden_estados_historial for select to authenticated using (privado.puede_ver_orden(orden_id));

create policy "avances: ver" on public.orden_avances for select to authenticated using (privado.puede_ver_orden(orden_id));
create policy "avances: crear" on public.orden_avances for insert to authenticated
  with check (privado.puede_trabajar_orden(orden_id) and autor_id = (select auth.uid()));

create policy "archivos: ver" on public.archivos for select to authenticated using (privado.puede_ver_orden(orden_id));
create policy "archivos: crear" on public.archivos for insert to authenticated
  with check (privado.puede_trabajar_orden(orden_id) and subido_por = (select auth.uid()));

revoke insert, update, delete on public.orden_estados_historial from authenticated;
revoke update, delete on public.orden_avances, public.archivos from authenticated;

-- ---------------------------------------------------------------------
-- Funciones que la app llama
-- ---------------------------------------------------------------------

-- Cambiar el estado de una orden. El técnico solo las suyas y nunca a "entregado"
-- (la entrega al cliente la registra quien atiende al cliente).
create function public.cambiar_estado_orden(p_orden uuid, p_estado public.estado_orden, p_nota text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orden public.ordenes_trabajo;
  v_gestiona boolean;
begin
  select * into v_orden from public.ordenes_trabajo where id = p_orden;
  if not found or v_orden.anulada then
    raise exception 'La orden no existe o está anulada.' using errcode = 'no_data_found';
  end if;

  v_gestiona := privado.tiene_rol(v_orden.empresa_id, array['gerencia', 'administrador', 'asesor']::public.rol_t[]);
  if not v_gestiona then
    if not (v_orden.tecnico_id = auth.uid() and privado.tiene_rol(v_orden.empresa_id, array['tecnico']::public.rol_t[])) then
      raise exception 'No puedes cambiar el estado de esta orden.' using errcode = 'insufficient_privilege';
    end if;
    if p_estado = 'entregado' or v_orden.estado = 'entregado' then
      raise exception 'La entrega al cliente la registra el asesor.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  perform set_config('app.nota_estado', coalesce(btrim(p_nota), ''), true);
  update public.ordenes_trabajo set estado = p_estado where id = p_orden;
  perform set_config('app.nota_estado', '', true);
end;
$$;

-- Marcar una cita como confirmada (confirmación, gestión y asesores).
create function public.confirmar_cita(p_cita uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cita public.citas;
begin
  select * into v_cita from public.citas where id = p_cita;
  if not found then raise exception 'La cita no existe.' using errcode = 'no_data_found'; end if;
  if not privado.tiene_rol(v_cita.empresa_id, array['gerencia', 'administrador', 'asesor', 'confirmador']::public.rol_t[]) then
    raise exception 'No puedes confirmar citas.' using errcode = 'insufficient_privilege';
  end if;
  if v_cita.estado <> 'agendada' then
    raise exception 'Solo se confirma una cita agendada.' using errcode = 'check_violation';
  end if;
  update public.citas set estado = 'confirmada', confirmada_por = auth.uid(), confirmada_en = now() where id = p_cita;
end;
$$;

-- Marca "no llegó" las citas cuya hora + tolerancia ya pasó sin ingreso.
-- Devuelve cuántas marcó. (En la Fase 2, n8n la llamará cada 10 minutos y avisará al vendedor.)
create function public.marcar_citas_no_llego(p_empresa uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cuantas integer;
begin
  if not privado.es_miembro(p_empresa) then return 0; end if;
  update public.citas c
    set estado = 'no_llego'
    from public.configuracion_empresa cfg
    where cfg.empresa_id = c.empresa_id
      and c.empresa_id = p_empresa
      and c.estado in ('agendada', 'confirmada')
      and c.orden_id is null
      and c.fecha_hora + make_interval(mins => cfg.tolerancia_cita_minutos) < now();
  get diagnostics v_cuantas = row_count;
  return v_cuantas;
end;
$$;

-- Personal con un rol en el taller (para elegir técnico o vendedor).
create function public.personal_con_rol(p_empresa uuid, p_rol public.rol_t)
returns table (perfil_id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.nombre
  from public.miembros m join public.perfiles p on p.id = m.perfil_id
  where m.empresa_id = p_empresa and m.rol = p_rol and m.activo and p.activo
    and privado.es_miembro(p_empresa)
  order by p.nombre;
$$;

revoke all on function public.cambiar_estado_orden(uuid, public.estado_orden, text) from public, anon;
revoke all on function public.confirmar_cita(uuid) from public, anon;
revoke all on function public.marcar_citas_no_llego(uuid) from public, anon;
revoke all on function public.personal_con_rol(uuid, public.rol_t) from public, anon;
grant execute on function public.cambiar_estado_orden(uuid, public.estado_orden, text) to authenticated;
grant execute on function public.confirmar_cita(uuid) to authenticated;
grant execute on function public.marcar_citas_no_llego(uuid) to authenticated;
grant execute on function public.personal_con_rol(uuid, public.rol_t) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos (Supabase Storage): carpeta privada "ordenes", ruta {empresa}/{orden}/{archivo}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ordenes', 'ordenes', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "fotos de orden: ver" on storage.objects for select to authenticated
  using (bucket_id = 'ordenes' and privado.puede_ver_orden(((storage.foldername(name))[2])::uuid));
create policy "fotos de orden: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'ordenes' and privado.puede_trabajar_orden(((storage.foldername(name))[2])::uuid));
