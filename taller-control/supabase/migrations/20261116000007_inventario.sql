-- =====================================================================
-- 0007 · Inventario (Fase 6)
--
-- Repuestos con código, stock, costo, precio y stock mínimo. El stock solo
-- se mueve con movimientos (kardex):
--   * entrada: llega sola al confirmar una compra cuya línea apunta a un repuesto;
--   * salida: un repuesto que se entrega a una orden (su costo pasa a la orden);
--   * ajuste: conteo físico, merma o consumo interno, siempre con motivo.
-- Los movimientos no se borran: se anulan con motivo y el stock se revierte.
-- El costo es promedio ponderado y sin IGV.
-- =====================================================================

create table public.repuestos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Z0-9][A-Z0-9./-]{0,29}$'),
  nombre text not null check (char_length(btrim(nombre)) between 2 and 160),
  marca text check (marca is null or char_length(btrim(marca)) <= 60),
  unidad text not null default 'unidad' check (unidad in ('unidad', 'juego', 'litro', 'galon', 'metro', 'kilo', 'kit')),
  stock numeric(12, 2) not null default 0 check (stock >= 0),
  stock_minimo numeric(12, 2) not null default 0 check (stock_minimo >= 0),
  costo_promedio_sin_igv numeric(12, 4) not null default 0 check (costo_promedio_sin_igv >= 0),
  ultimo_costo_sin_igv numeric(12, 4) check (ultimo_costo_sin_igv is null or ultimo_costo_sin_igv >= 0),
  precio_venta_sin_igv numeric(12, 4) check (precio_venta_sin_igv is null or precio_venta_sin_igv >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  unique (empresa_id, codigo)
);
create index repuestos_nombre on public.repuestos (empresa_id, nombre);

create table public.movimientos_inventario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas (id) on delete cascade,
  repuesto_id uuid not null references public.repuestos (id),
  tipo text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  -- Con signo: la entrada suma, la salida resta, el ajuste suma o resta.
  cantidad numeric(12, 2) not null check (cantidad <> 0),
  costo_unitario_sin_igv numeric(12, 4) not null default 0 check (costo_unitario_sin_igv >= 0),
  stock_despues numeric(12, 2),
  compra_item_id uuid references public.compra_items (id),
  orden_id uuid references public.ordenes_trabajo (id),
  nota text check (nota is null or char_length(nota) <= 300),
  estado text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  motivo_anulacion text,
  anulado_por uuid,
  anulado_en timestamptz,
  creado_en timestamptz not null default now(),
  creado_por uuid,
  actualizado_en timestamptz not null default now(),
  actualizado_por uuid,
  check (tipo <> 'entrada' or cantidad > 0),
  check (tipo <> 'salida' or (cantidad < 0 and orden_id is not null)),
  check (tipo <> 'ajuste' or char_length(btrim(coalesce(nota, ''))) >= 5)
);
create index movimientos_repuesto on public.movimientos_inventario (repuesto_id, creado_en desc);
create index movimientos_orden on public.movimientos_inventario (orden_id) where orden_id is not null;
create unique index movimientos_una_entrada_por_linea on public.movimientos_inventario (compra_item_id)
  where compra_item_id is not null and estado = 'vigente';

-- Una línea de compra puede ir al inventario (repuesto con código).
alter table public.compra_items add column repuesto_id uuid references public.repuestos (id);
alter table public.compra_items add constraint compra_items_repuesto_en_stock check (repuesto_id is null or destino = 'stock');

-- ---------------------------------------------------------------------
-- El stock y el costo solo cambian por movimientos.
-- ---------------------------------------------------------------------
create function privado.proteger_repuesto() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un repuesto no se borra: desactívalo.' using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'INSERT' then
    new.stock := 0;
    new.costo_promedio_sin_igv := 0;
    new.ultimo_costo_sin_igv := null;
  elsif coalesce(current_setting('privado.kardex', true), '') <> 'si'
     and (new.stock is distinct from old.stock
          or new.costo_promedio_sin_igv is distinct from old.costo_promedio_sin_igv
          or new.ultimo_costo_sin_igv is distinct from old.ultimo_costo_sin_igv) then
    raise exception 'El stock solo cambia con una entrada, una salida o un ajuste.' using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

-- Aplica un movimiento al repuesto: stock, costo promedio y saldo después.
create function privado.aplicar_movimiento() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.repuestos%rowtype;
  v_signo numeric;
  v_cant numeric;
  v_nuevo numeric;
  v_costo numeric;
begin
  if tg_op = 'DELETE' then
    raise exception 'Los movimientos del inventario no se borran: se anulan con motivo.' using errcode = 'insufficient_privilege';
  end if;

  if tg_op = 'UPDATE' then
    if old.estado = 'anulado' then
      raise exception 'Este movimiento está anulado y ya no cambia.' using errcode = 'check_violation';
    end if;
    if new.estado <> 'anulado'
       or (to_jsonb(new) - array['estado', 'motivo_anulacion', 'anulado_por', 'anulado_en', 'actualizado_en', 'actualizado_por'])
          is distinct from (to_jsonb(old) - array['estado', 'motivo_anulacion', 'anulado_por', 'anulado_en', 'actualizado_en', 'actualizado_por']) then
      raise exception 'Un movimiento no se edita: se anula con motivo y se registra de nuevo.' using errcode = 'check_violation';
    end if;
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 5 then
      raise exception 'Para anular escribe el motivo.' using errcode = 'check_violation';
    end if;
    new.anulado_en := now();
    new.anulado_por := auth.uid();
    v_signo := -1;   -- revertir
  else
    new.estado := 'vigente';
    v_signo := 1;
  end if;

  select * into r from public.repuestos where id = new.repuesto_id for update;
  if r.id is null or r.empresa_id <> new.empresa_id then
    raise exception 'El repuesto no es de este taller.' using errcode = 'check_violation';
  end if;
  if new.orden_id is not null
     and not exists (select 1 from public.ordenes_trabajo o where o.id = new.orden_id and o.empresa_id = new.empresa_id) then
    raise exception 'La orden no es de este taller.' using errcode = 'check_violation';
  end if;

  v_cant := v_signo * new.cantidad;
  v_nuevo := r.stock + v_cant;
  if v_nuevo < 0 then
    raise exception 'No hay stock suficiente de %: quedan %.', r.nombre, trim(to_char(r.stock, 'FM999999990.##'))
      using errcode = 'check_violation';
  end if;

  v_costo := r.costo_promedio_sin_igv;
  if tg_op = 'INSERT' then
    if new.cantidad > 0 and new.costo_unitario_sin_igv > 0 then
      -- Entra mercadería con costo: promedio ponderado.
      v_costo := case when r.stock <= 0 then new.costo_unitario_sin_igv
                      else (r.stock * r.costo_promedio_sin_igv + new.cantidad * new.costo_unitario_sin_igv) / v_nuevo end;
    else
      -- Sale (o entra un ajuste sin costo): vale al costo promedio de hoy.
      new.costo_unitario_sin_igv := r.costo_promedio_sin_igv;
    end if;
    new.stock_despues := v_nuevo;
  elsif new.cantidad > 0 and v_nuevo > 0 then
    -- Se anula una entrada: se quita su costo del promedio.
    v_costo := greatest(0, (r.stock * r.costo_promedio_sin_igv - new.cantidad * new.costo_unitario_sin_igv) / v_nuevo);
  end if;

  perform set_config('privado.kardex', 'si', true);
  update public.repuestos set
    stock = v_nuevo,
    costo_promedio_sin_igv = round(v_costo, 4),
    ultimo_costo_sin_igv = case when tg_op = 'INSERT' and new.tipo = 'entrada' then new.costo_unitario_sin_igv else ultimo_costo_sin_igv end
  where id = r.id;
  perform set_config('privado.kardex', '', true);
  return new;
end;
$$;

-- Las compras confirmadas cargan el inventario; anularlas lo descarga.
create function privado.entrada_por_linea(p_item uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare i record;
begin
  select ci.id, ci.empresa_id, ci.repuesto_id, ci.cantidad, ci.precio_unitario_sin_igv, c.tipo_cambio, c.moneda
    into i
  from public.compra_items ci join public.compras c on c.id = ci.compra_id
  where ci.id = p_item and ci.repuesto_id is not null and c.estado = 'confirmado';
  if i.id is null then return; end if;
  if exists (select 1 from public.movimientos_inventario m where m.compra_item_id = i.id and m.estado = 'vigente') then return; end if;
  insert into public.movimientos_inventario (empresa_id, repuesto_id, tipo, cantidad, costo_unitario_sin_igv, compra_item_id, nota)
  values (i.empresa_id, i.repuesto_id, 'entrada', i.cantidad,
          round(i.precio_unitario_sin_igv * case when i.moneda = 'USD' then i.tipo_cambio else 1 end, 4), i.id, 'Compra');
end;
$$;
revoke all on function privado.entrada_por_linea(uuid) from public, anon;

create function privado.inventario_por_linea() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.repuesto_id is not null then
    perform privado.entrada_por_linea(new.id);
  end if;
  return null;
end;
$$;

create function privado.inventario_por_compra() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_item uuid;
begin
  if new.estado = 'confirmado' and old.estado = 'por_confirmar' then
    for v_item in select id from public.compra_items where compra_id = new.id and repuesto_id is not null loop
      perform privado.entrada_por_linea(v_item);
    end loop;
  elsif new.estado = 'anulado' and old.estado <> 'anulado' then
    update public.movimientos_inventario m set estado = 'anulado', motivo_anulacion = 'Compra anulada: ' || coalesce(new.motivo_anulacion, '')
    where m.estado = 'vigente' and m.compra_item_id in (select id from public.compra_items where compra_id = new.id);
  end if;
  return null;
end;
$$;

create trigger repuestos_sellar before insert or update on public.repuestos for each row execute function privado.sellar();
create trigger repuestos_proteger before insert or update or delete on public.repuestos for each row execute function privado.proteger_repuesto();
create trigger repuestos_auditar after insert or update or delete on public.repuestos for each row execute function privado.auditar();
create trigger movimientos_inv_sellar before insert or update on public.movimientos_inventario for each row execute function privado.sellar();
create trigger movimientos_inv_aplicar before insert or update or delete on public.movimientos_inventario for each row execute function privado.aplicar_movimiento();
create trigger movimientos_inv_auditar after insert or update or delete on public.movimientos_inventario for each row execute function privado.auditar();
create trigger compra_items_inventario after insert on public.compra_items for each row execute function privado.inventario_por_linea();
create trigger compras_inventario after update of estado on public.compras for each row execute function privado.inventario_por_compra();

-- ---------------------------------------------------------------------
-- RLS: ven el inventario gerencia, administración, asesor (para cotizar) y
-- almacén; lo mueven gerencia, administración y almacén.
-- ---------------------------------------------------------------------
alter table public.repuestos enable row level security;
alter table public.movimientos_inventario enable row level security;
revoke all on public.repuestos, public.movimientos_inventario from anon;
revoke delete on public.repuestos, public.movimientos_inventario from authenticated;

create policy "repuestos: ver" on public.repuestos for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[]));
create policy "repuestos: crear" on public.repuestos for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));
create policy "repuestos: cambiar" on public.repuestos for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));

create policy "kardex: ver" on public.movimientos_inventario for select to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'asesor', 'almacen']::public.rol_t[]));
create policy "kardex: registrar" on public.movimientos_inventario for insert to authenticated
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));
create policy "kardex: anular" on public.movimientos_inventario for update to authenticated
  using (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]))
  with check (privado.tiene_rol(empresa_id, array['gerencia', 'administrador', 'almacen']::public.rol_t[]));

-- ---------------------------------------------------------------------
-- registrar_compra: cada línea puede apuntar a un repuesto del inventario.
-- ---------------------------------------------------------------------
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
                              tasa_igv, subtotal_sin_igv, igv, total, origen_datos, estado)
  values (p_empresa, v_prov, p_compra ->> 'tipo', nullif(p_compra ->> 'serie', ''), nullif(p_compra ->> 'numero', ''),
          (p_compra ->> 'fecha')::date, p_compra ->> 'moneda', (p_compra ->> 'tipo_cambio')::numeric,
          (p_compra ->> 'tasa_igv')::numeric, (p_compra ->> 'sin_igv')::numeric, (p_compra ->> 'igv')::numeric,
          (p_compra ->> 'total')::numeric, v_origen,
          case when v_origen = 'ia' then 'por_confirmar' else 'confirmado' end::public.estado_documento)
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
