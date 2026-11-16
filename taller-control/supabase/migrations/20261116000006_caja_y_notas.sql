-- Caja de recepción (apertura, movimientos y cierre con arqueo), notas de
-- crédito, abonos y devoluciones, y permisos del rol recepción.

-- ---------------------------------------------------------------------
-- Quién maneja la caja
-- ---------------------------------------------------------------------
create function privado.ve_caja(p_empresa uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.tiene_rol(p_empresa, array['gerencia', 'administrador', 'asesor', 'recepcion']::public.rol_t[]);
$$;
revoke all on function privado.ve_caja(uuid) from public, anon;
grant execute on function privado.ve_caja(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Recepción ve órdenes, carros, clientes y citas (no compras ni sueldos)
-- ---------------------------------------------------------------------
create or replace function privado.puede_ver_orden(p_orden uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ordenes_trabajo o
    where o.id = p_orden
      and (
        privado.tiene_rol(o.empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen', 'recepcion']::public.rol_t[])
        or (o.tecnico_id = (select auth.uid()) and privado.tiene_rol(o.empresa_id, array['tecnico']::public.rol_t[]))
        or (
          privado.tiene_rol(o.empresa_id, array['vendedor_redes']::public.rol_t[])
          and exists (select 1 from public.citas c where c.orden_id = o.id and c.vendedor_id = (select auth.uid()))
        )
      )
  );
$$;

create or replace function privado.puede_ver_vehiculo(p_vehiculo uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vehiculos v
    where v.id = p_vehiculo
      and (
        privado.tiene_rol(v.empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen', 'vendedor_redes', 'recepcion']::public.rol_t[])
        or exists (
          select 1 from public.ordenes_trabajo o
          where o.vehiculo_id = v.id and o.tecnico_id = (select auth.uid())
            and privado.tiene_rol(v.empresa_id, array['tecnico']::public.rol_t[])
        )
      )
  );
$$;

drop policy "órdenes: ver" on public.ordenes_trabajo;
create policy "órdenes: ver" on public.ordenes_trabajo for select to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen', 'recepcion']::public.rol_t[])
    or (tecnico_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['tecnico']::public.rol_t[]))
    or (
      privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[])
      and exists (select 1 from public.citas c where c.orden_id = ordenes_trabajo.id and c.vendedor_id = (select auth.uid()))
    )
  );

drop policy "vehículos: ver" on public.vehiculos;
create policy "vehículos: ver" on public.vehiculos for select to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen', 'vendedor_redes', 'recepcion']::public.rol_t[])
    or (
      privado.tiene_rol(empresa_id, array['tecnico']::public.rol_t[])
      and exists (select 1 from public.ordenes_trabajo o where o.vehiculo_id = vehiculos.id and o.tecnico_id = (select auth.uid()))
    )
  );

drop policy "clientes: ver" on public.clientes;
create policy "clientes: ver" on public.clientes for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes', 'confirmador', 'recepcion']::public.rol_t[]));

drop policy "citas: ver" on public.citas;
create policy "citas: ver" on public.citas for select to authenticated
  using (
    privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'confirmador', 'recepcion']::public.rol_t[])
    or (vendedor_id = (select auth.uid()) and privado.tiene_rol(empresa_id, array['vendedor_redes']::public.rol_t[]))
  );

drop policy "catálogo: ver" on public.catalogo_servicios;
create policy "catálogo: ver" on public.catalogo_servicios for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'vendedor_redes', 'confirmador', 'recepcion']::public.rol_t[]));

-- Recepción entrega el carro (de «listo» a «entregado») y puede reabrirlo; nada más.
create or replace function public.cambiar_estado_orden(p_orden uuid, p_estado public.estado_orden, p_nota text default null)
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
    if privado.tiene_rol(v_orden.empresa_id, array['recepcion']::public.rol_t[]) then
      if not (v_orden.estado = 'listo' and p_estado = 'entregado') then
        raise exception 'Recepción solo registra la entrega de un carro listo.' using errcode = 'insufficient_privilege';
      end if;
    elsif not (v_orden.tecnico_id = auth.uid() and privado.tiene_rol(v_orden.empresa_id, array['tecnico']::public.rol_t[])) then
      raise exception 'No puedes cambiar el estado de esta orden.' using errcode = 'insufficient_privilege';
    elsif p_estado = 'entregado' or v_orden.estado = 'entregado' then
      raise exception 'La entrega al cliente la registra el asesor o recepción.' using errcode = 'insufficient_privilege';
    end if;
  end if;

  perform set_config('app.nota_estado', coalesce(btrim(p_nota), ''), true);
  update public.ordenes_trabajo set estado = p_estado where id = p_orden;
  perform set_config('app.nota_estado', '', true);
end;
$$;

-- Ventas, cotizaciones, pagos y cierres: también recepción (cotizaciones solo las ve).
drop policy "comprobantes: ver" on public.comprobantes_venta;
drop policy "comprobantes: crear" on public.comprobantes_venta;
drop policy "comprobantes: cambiar" on public.comprobantes_venta;
create policy "comprobantes: ver" on public.comprobantes_venta for select to authenticated using (privado.ve_caja(empresa_id));
create policy "comprobantes: crear" on public.comprobantes_venta for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "comprobantes: cambiar" on public.comprobantes_venta for update to authenticated
  using (privado.ve_caja(empresa_id)) with check (privado.ve_caja(empresa_id));

drop policy "cotizaciones: ver" on public.cotizaciones;
create policy "cotizaciones: ver" on public.cotizaciones for select to authenticated using (privado.ve_caja(empresa_id));
drop policy "líneas de cotización: ver" on public.cotizacion_items;
create policy "líneas de cotización: ver" on public.cotizacion_items for select to authenticated using (privado.ve_caja(empresa_id));

drop policy "pagos: ver" on public.pagos;
drop policy "pagos: crear" on public.pagos;
drop policy "pagos: anular" on public.pagos;
create policy "pagos: ver" on public.pagos for select to authenticated using (privado.ve_caja(empresa_id));
create policy "pagos: crear" on public.pagos for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "pagos: anular" on public.pagos for update to authenticated
  using (privado.ve_caja(empresa_id)) with check (privado.ve_caja(empresa_id));

drop policy "cierres: ver" on public.cierres_diarios;
drop policy "cierres: crear" on public.cierres_diarios;
create policy "cierres: ver" on public.cierres_diarios for select to authenticated using (privado.ve_caja(empresa_id));
create policy "cierres: crear" on public.cierres_diarios for insert to authenticated with check (privado.ve_caja(empresa_id));

-- ---------------------------------------------------------------------
-- Caja: una abierta por taller; se cierra contando el efectivo
-- ---------------------------------------------------------------------
create table public.cajas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  monto_inicial numeric(12, 2) not null check (monto_inicial >= 0),
  abierta_por uuid default auth.uid(),
  abierta_en timestamptz not null default now(),
  efectivo_esperado numeric(12, 2),
  efectivo_contado numeric(12, 2) check (efectivo_contado is null or efectivo_contado >= 0),
  diferencia numeric(12, 2),
  resumen jsonb,
  observaciones text check (observaciones is null or char_length(observaciones) <= 1000),
  cerrada_por uuid,
  cerrada_en timestamptz,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid
);
create unique index cajas_una_abierta on public.cajas (empresa_id) where estado = 'abierta';
create index cajas_empresa_fecha on public.cajas (empresa_id, abierta_en desc);

-- Ingresos y egresos de efectivo que no son pagos de una orden
-- (sencillo extra, gastos menores, movilidad, retiro para gerencia).
create table public.movimientos_caja (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  caja_id uuid not null references public.cajas (id),
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  concepto text not null check (char_length(btrim(concepto)) between 2 and 200),
  monto numeric(12, 2) not null check (monto > 0),
  medio text not null default 'efectivo' check (medio in ('efectivo', 'yape', 'plin', 'tarjeta', 'transferencia')),
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
create index movimientos_caja_caja on public.movimientos_caja (caja_id);

-- Pagos: abono (pago a cuenta, en partes) y devolución (se le devuelve al cliente).
alter table public.pagos drop constraint pagos_tipo_check;
alter table public.pagos add constraint pagos_tipo_check check (tipo in ('adelanto', 'abono', 'saldo', 'devolucion'));
alter table public.pagos add column caja_id uuid references public.cajas (id);
create index pagos_caja on public.pagos (caja_id);

-- ---------------------------------------------------------------------
-- Notas de crédito: rebajan una boleta o factura ya registrada
-- (anulación, descuento, devolución, corrección). Catálogo 09 de SUNAT.
-- ---------------------------------------------------------------------
create table public.notas_credito (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  comprobante_id uuid not null references public.comprobantes_venta (id),
  orden_id uuid references public.ordenes_trabajo (id),
  serie text not null check (serie ~ '^[A-Z0-9]{1,4}$'),
  numero text not null check (numero ~ '^[0-9]{1,8}$'),
  fecha_emision date not null,
  motivo_codigo text not null check (motivo_codigo in ('01', '02', '03', '04', '05', '06', '07', '09', '10', '13')),
  motivo text check (motivo is null or char_length(motivo) <= 300),
  tasa_igv numeric(5, 4) not null check (tasa_igv between 0 and 0.5),
  subtotal_sin_igv numeric(12, 2) not null check (subtotal_sin_igv >= 0),
  igv numeric(12, 2) not null check (igv >= 0),
  total numeric(12, 2) not null check (total > 0),
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
create unique index notas_credito_numero on public.notas_credito (empresa_id, serie, numero) where estado <> 'anulado';
create index notas_credito_comprobante on public.notas_credito (comprobante_id);
create index notas_credito_orden on public.notas_credito (orden_id);

-- La nota toma la orden de su comprobante y no puede rebajar más de lo que vale.
create function privado.validar_nota_credito() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp public.comprobantes_venta;
  v_otras numeric;
begin
  select * into v_comp from public.comprobantes_venta where id = new.comprobante_id;
  if not found or v_comp.empresa_id <> new.empresa_id then
    raise exception 'El comprobante no es de este taller.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    if v_comp.estado = 'anulado' then
      raise exception 'Ese comprobante está anulado.' using errcode = 'check_violation';
    end if;
    new.orden_id := v_comp.orden_id;
  end if;
  if new.estado <> 'anulado' then
    select coalesce(sum(total), 0) into v_otras from public.notas_credito
    where comprobante_id = new.comprobante_id and estado <> 'anulado' and id <> new.id;
    if v_otras + new.total > v_comp.total + 0.01 then
      raise exception 'La nota de crédito no puede ser mayor que lo que queda del comprobante (S/ %).', (v_comp.total - v_otras)
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Si al comprobante se le asigna la orden después, sus notas la siguen.
create function privado.seguir_orden_comprobante() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.orden_id is distinct from old.orden_id then
    update public.notas_credito set orden_id = new.orden_id where comprobante_id = new.id;
  end if;
  return new;
end;
$$;

-- Caja: abrir con monto inicial, cerrar una sola vez; cerrada ya no cambia.
create function privado.proteger_caja() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una caja no se borra.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    if new.estado <> 'abierta' then
      raise exception 'Una caja se abre y después se cierra.' using errcode = 'check_violation';
    end if;
    new.abierta_por := coalesce(auth.uid(), new.abierta_por);
    new.abierta_en := now();
    return new;
  end if;
  if old.estado = 'cerrada' then
    raise exception 'Esta caja ya está cerrada.' using errcode = 'check_violation';
  end if;
  if new.monto_inicial <> old.monto_inicial or new.abierta_en <> old.abierta_en or new.abierta_por is distinct from old.abierta_por then
    raise exception 'La apertura de la caja no se cambia.' using errcode = 'check_violation';
  end if;
  if new.estado = 'cerrada' then
    if new.efectivo_contado is null then
      raise exception 'Para cerrar la caja cuenta el efectivo.' using errcode = 'check_violation';
    end if;
    new.cerrada_por := auth.uid();
    new.cerrada_en := now();
  end if;
  return new;
end;
$$;

-- Movimientos y pagos solo entran o se anulan en una caja abierta.
create function privado.proteger_movimiento_caja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_estado text;
begin
  select estado into v_estado from public.cajas where id = new.caja_id and empresa_id = new.empresa_id;
  if v_estado is null then
    raise exception 'La caja no es de este taller.' using errcode = 'check_violation';
  end if;
  if v_estado <> 'abierta' then
    raise exception 'La caja ya está cerrada: registra el movimiento en la caja de hoy.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- Cada pago entra a la caja abierta de su taller (si hay una).
create function privado.pago_a_caja() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_estado text;
begin
  if tg_op = 'INSERT' then
    new.caja_id := (select id from public.cajas where empresa_id = new.empresa_id and estado = 'abierta');
  elsif new.caja_id is distinct from old.caja_id then
    raise exception 'El pago no cambia de caja.' using errcode = 'check_violation';
  elsif old.caja_id is not null and new.estado = 'anulado' and old.estado <> 'anulado' then
    select estado into v_estado from public.cajas where id = old.caja_id;
    if v_estado = 'cerrada' then
      raise exception 'Este pago es de una caja ya cerrada: registra una devolución en la caja de hoy.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger cajas_sellar before insert or update on public.cajas for each row execute function privado.sellar();
create trigger cajas_proteger before insert or update or delete on public.cajas for each row execute function privado.proteger_caja();
create trigger cajas_auditar after insert or update or delete on public.cajas for each row execute function privado.auditar();
create trigger movimientos_sellar before insert or update on public.movimientos_caja for each row execute function privado.sellar();
create trigger movimientos_en_caja before insert or update on public.movimientos_caja for each row execute function privado.proteger_movimiento_caja();
create trigger movimientos_proteger before update or delete on public.movimientos_caja for each row execute function privado.proteger_dinero();
create trigger movimientos_auditar after insert or update or delete on public.movimientos_caja for each row execute function privado.auditar();
create trigger pagos_a_caja before insert or update on public.pagos for each row execute function privado.pago_a_caja();
create trigger notas_sellar before insert or update on public.notas_credito for each row execute function privado.sellar();
create trigger notas_validar before insert or update on public.notas_credito for each row execute function privado.validar_nota_credito();
create trigger notas_proteger before update or delete on public.notas_credito for each row execute function privado.proteger_dinero();
create trigger notas_auditar after insert or update or delete on public.notas_credito for each row execute function privado.auditar();
create trigger comprobantes_seguir_orden after update of orden_id on public.comprobantes_venta for each row execute function privado.seguir_orden_comprobante();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.cajas enable row level security;
alter table public.movimientos_caja enable row level security;
alter table public.notas_credito enable row level security;
revoke all on public.cajas, public.movimientos_caja, public.notas_credito from anon;
revoke delete on public.cajas, public.movimientos_caja, public.notas_credito from authenticated;

create policy "cajas: ver" on public.cajas for select to authenticated using (privado.ve_caja(empresa_id));
create policy "cajas: abrir" on public.cajas for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "cajas: cerrar" on public.cajas for update to authenticated using (privado.ve_caja(empresa_id)) with check (privado.ve_caja(empresa_id));
create policy "movimientos: ver" on public.movimientos_caja for select to authenticated using (privado.ve_caja(empresa_id));
create policy "movimientos: crear" on public.movimientos_caja for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "movimientos: anular" on public.movimientos_caja for update to authenticated using (privado.ve_caja(empresa_id)) with check (privado.ve_caja(empresa_id));
create policy "notas de crédito: ver" on public.notas_credito for select to authenticated using (privado.ve_caja(empresa_id));
create policy "notas de crédito: crear" on public.notas_credito for insert to authenticated with check (privado.ve_caja(empresa_id));
create policy "notas de crédito: anular" on public.notas_credito for update to authenticated using (privado.ve_caja(empresa_id)) with check (privado.ve_caja(empresa_id));

-- ---------------------------------------------------------------------
-- Cerrar la caja: el sistema calcula el efectivo esperado; la persona dice
-- cuánto contó. Queda la diferencia (sobrante o faltante) y el resumen.
-- ---------------------------------------------------------------------
create function public.cerrar_caja(p_caja uuid, p_contado numeric, p_observaciones text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_caja public.cajas;
  v_resumen jsonb;
  v_esperado numeric;
begin
  select * into v_caja from public.cajas where id = p_caja;
  if not found then
    raise exception 'No se encontró la caja.' using errcode = 'no_data_found';
  end if;
  if v_caja.estado <> 'abierta' then
    raise exception 'Esta caja ya está cerrada.' using errcode = 'check_violation';
  end if;

  with pagos as (
    select medio, sum(case when tipo = 'devolucion' then -monto else monto end) neto, count(*) cuantos
    from public.pagos where caja_id = p_caja and estado = 'confirmado' group by medio
  ), movs as (
    select medio, sum(case when tipo = 'ingreso' then monto else 0 end) ingresos, sum(case when tipo = 'egreso' then monto else 0 end) egresos
    from public.movimientos_caja where caja_id = p_caja and estado = 'confirmado' group by medio
  ), medios as (
    select m.medio, coalesce(p.neto, 0) cobros, coalesce(p.cuantos, 0) cuantos, coalesce(v.ingresos, 0) ingresos, coalesce(v.egresos, 0) egresos
    from (values ('efectivo'), ('yape'), ('plin'), ('tarjeta'), ('transferencia')) m (medio)
    left join pagos p on p.medio = m.medio left join movs v on v.medio = m.medio
  )
  select jsonb_object_agg(medio, jsonb_build_object('cobros', cobros, 'pagos', cuantos, 'ingresos', ingresos, 'egresos', egresos)),
         v_caja.monto_inicial + coalesce(sum(cobros + ingresos - egresos) filter (where medio = 'efectivo'), 0)
  into v_resumen, v_esperado
  from medios;

  update public.cajas set
    estado = 'cerrada',
    efectivo_esperado = v_esperado,
    efectivo_contado = p_contado,
    diferencia = round(p_contado - v_esperado, 2),
    resumen = v_resumen,
    observaciones = nullif(btrim(coalesce(p_observaciones, '')), '')
  where id = p_caja;
  return jsonb_build_object('esperado', v_esperado, 'contado', p_contado, 'diferencia', round(p_contado - v_esperado, 2), 'medios', v_resumen);
end;
$$;
revoke execute on function public.cerrar_caja(uuid, numeric, text) from public, anon;
grant execute on function public.cerrar_caja(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Cotización con IGV o sin IGV (operación sin IGV: tasa 0)
-- ---------------------------------------------------------------------
drop function public.crear_cotizacion(uuid, boolean, jsonb);
create function public.crear_cotizacion(p_orden uuid, p_adicional boolean, p_items jsonb, p_con_igv boolean default true)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_empresa uuid;
  v_tasa numeric;
  v_cot uuid;
  v_version integer;
  v_item jsonb;
begin
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'La cotización necesita al menos una línea.' using errcode = 'check_violation';
  end if;
  select o.empresa_id, c.tasa_igv into v_empresa, v_tasa
  from public.ordenes_trabajo o join public.configuracion_empresa c on c.empresa_id = o.empresa_id
  where o.id = p_orden;
  if v_empresa is null then
    raise exception 'No se encontró la orden.' using errcode = 'no_data_found';
  end if;
  if not coalesce(p_con_igv, true) then v_tasa := 0; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.cotizaciones where orden_id = p_orden;

  insert into public.cotizaciones (empresa_id, orden_id, version, es_adicional, tasa_igv)
  values (v_empresa, p_orden, v_version, coalesce(p_adicional, false), v_tasa)
  returning id into v_cot;

  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.cotizacion_items (empresa_id, cotizacion_id, tipo, descripcion, cantidad, precio_unitario_total, subtotal_sin_igv, igv, total)
    values (v_empresa, v_cot, v_item ->> 'tipo', btrim(v_item ->> 'descripcion'), (v_item ->> 'cantidad')::numeric,
            (v_item ->> 'precio')::numeric, (v_item ->> 'sin_igv')::numeric, (v_item ->> 'igv')::numeric, (v_item ->> 'total')::numeric);
  end loop;

  update public.cotizaciones c set
    subtotal_sin_igv = s.sin_igv, igv = s.igv, total = s.total
  from (select sum(subtotal_sin_igv) sin_igv, sum(igv) igv, sum(total) total from public.cotizacion_items where cotizacion_id = v_cot) s
  where c.id = v_cot;
  return v_cot;
end;
$$;
revoke execute on function public.crear_cotizacion(uuid, boolean, jsonb, boolean) from public, anon;
grant execute on function public.crear_cotizacion(uuid, boolean, jsonb, boolean) to authenticated;
