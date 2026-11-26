# Personal, permisos y nómina: arquitectura

Diseño del módulo **Personal** (Configuración), sus **permisos por persona** y su conexión con **Gastos**.
Se construye sobre lo que ya existe; no se crean tablas paralelas de usuarios ni de gastos.

> Regla de oro: **la base de datos manda.** Cada permiso y cada regla de dinero se hace cumplir con
> RLS, funciones y disparadores en Postgres. La pantalla solo esconde lo que la base igual rechazaría.

---

## 0. Punto de partida (lo que ya existe)

| Pedido en el requerimiento | Ya existe | Decisión |
|---|---|---|
| `usuarios` | `auth.users` + `perfiles` (nombre, celular, `activo`) | Se **extiende** `perfiles`; no se crea otra tabla |
| `roles` | Tipo `rol_t` (gerencia, administrador, asesor, recepcion, tecnico, almacen, vendedor_redes, confirmador) + `miembros` (persona + rol + taller, varios roles por persona) | Se mantiene. «Dueño» = gerencia; «Mecánico» = técnico |
| Protección del dueño | Disparador `proteger_ultima_gerencia` (siempre queda al menos una gerencia activa) | Se refuerza con un **dueño marcado** (ver 2.4) |
| Desactivar acceso | `perfiles.activo` y `miembros.activo`; `privado.tiene_rol` ya exige ambos | Se usa `miembros.activo` por taller + cierre de sesión inmediato |
| Restablecer contraseña | `asignarClave` en `usuarios/acciones.ts` | Se mueve dentro de «Modificar» |
| Costo del personal | `costos_personal` (costo mensual con `vigente_desde`) | Lo reemplaza `esquemas_pago` (versionado) |
| Comisiones | `reglas_comision` (por evento, fijo o %), sin liquidar | Se convierten en **comisiones por orden** liquidables |
| `gastos` | Tabla `gastos` con anulación con motivo (`proteger_dinero`), categoría `sueldos`, enlace 1 a 1 con caja (`movimiento_caja_id`) | Se agrega el **origen** (manual, caja, personal) con referencia exacta |

Hoy los permisos se deciden **por rol** en unas 180 reglas de RLS (`tiene_rol`, `es_gestor`, `ve_caja`…).
Cambiar todo de golpe es riesgoso; la fase 2 lo hace **módulo por módulo** sin cambiar lo que ve cada rol.

---

## 1. Modelo de datos

### 1.1 Personas (extiende `perfiles` y `miembros`)

```sql
alter table perfiles add column
  documento text,                       -- DNI / CE
  cargo text,                           -- texto libre: «Mecánico de motor», «Cajera»
  fecha_ingreso date,
  fecha_cese date,
  motivo_cese text;

alter table miembros add column es_dueno boolean not null default false;
create unique index un_dueno_por_taller on miembros (empresa_id) where es_dueno;
```

- **Usuario** = `perfiles` (uno por persona; entra con su celular).
- **Rol en un taller** = filas de `miembros`. Desactivar en un taller = `miembros.activo = false` en todas
  sus filas de ese taller (no afecta otro taller donde trabaje).

### 1.2 Permisos (catálogo + plantilla por rol + excepciones por persona)

```sql
-- Catálogo fijo (lo define el sistema, viene en la migración).
create table permisos (
  codigo text primary key,              -- 'ordenes.crear', 'gastos.ver', 'personal.pagar'…
  modulo text not null,                 -- Clientes, Órdenes, Almacén, Caja, Gastos, Reportes, Configuración
  nombre text not null,                 -- «Crear órdenes»
  sensible boolean not null default false -- dinero o personal: se avisa al activarlo
);

-- Plantilla por rol, editable por el dueño para su taller.
create table rol_permisos (
  empresa_id uuid not null references empresas,
  rol rol_t not null,
  permiso text not null references permisos,
  primary key (empresa_id, rol, permiso)
);                                      -- existe la fila = el rol lo tiene

-- Excepciones de UNA persona (no tocan a los demás del mismo rol).
create table usuario_permisos (
  empresa_id uuid not null references empresas,
  perfil_id uuid not null references perfiles,
  permiso text not null references permisos,
  permitido boolean not null,           -- true = se lo doy, false = se lo quito
  motivo text,
  primary key (empresa_id, perfil_id, permiso)
  -- + sellos y auditoría (quién y cuándo)
);
```

Catálogo inicial (se amplía por fase):

| Módulo | Permisos |
|---|---|
| Clientes | `clientes.ver`, `clientes.crear`, `clientes.editar`, `clientes.ver_contacto` |
| Órdenes | `ordenes.ver_todas`, `ordenes.ver_asignadas`, `ordenes.crear`, `ordenes.cambiar_estado`, `ordenes.asignar_tecnico`, `ordenes.diagnostico`, `ordenes.entregar`, `citas.gestionar` |
| Cotizaciones y caja | `cotizaciones.crear`, `cotizaciones.editar`, `cotizaciones.aprobar`, `cobros.registrar`, `comprobantes.emitir`, `caja.abrir_cerrar`, `dinero.anular` |
| Almacén | `inventario.ver`, `inventario.mover`, `inventario.despachar`, `compras.registrar`, `repuestos.solicitar` |
| Gastos | `gastos.ver`, `gastos.registrar`, `gastos.anular` |
| Reportes | `reportes.ver`, `reportes.utilidad` |
| Personal | `personal.ver`, `personal.gestionar`, `personal.permisos`, `nomina.ver`, `nomina.preparar`, `nomina.aprobar`, `nomina.pagar` |
| Configuración | `configuracion.taller`, `configuracion.avisos`, `configuracion.whatsapp`, `sistema.respaldos` |

Plantillas iniciales (equivalentes a lo que hoy permite cada rol, para que **nada cambie** al migrar):

| Rol | Resumen |
|---|---|
| Gerencia (dueño) | Todo |
| Administración | Todo menos `personal.permisos` y `sistema.respaldos` |
| Asesor de servicio | Clientes, órdenes (todas), diagnóstico, cotizaciones (crear, editar, aprobar), cobros, entrega |
| Recepción y caja | Clientes, ingreso y citas, órdenes (ver), cotizaciones (crear, editar), cobros, recibos, caja |
| Técnico | Órdenes asignadas, cambiar estado técnico, diagnóstico, solicitar repuestos |
| Almacén | Inventario, entradas y salidas, despacho a órdenes, compras, alertas de stock |

### 1.3 Esquema de pago (versionado; reemplaza `costos_personal`)

```sql
create table esquemas_pago (
  id uuid primary key,
  empresa_id uuid not null, perfil_id uuid not null,
  tipo text not null check (tipo in ('fijo','comision','mixto','destajo')),
  frecuencia text not null check (frecuencia in ('semanal','quincenal','mensual')),
  sueldo_base numeric(12,2) not null default 0,      -- por periodo (0 si es solo comisión/destajo)
  comision_base text check (comision_base in ('mano_obra','total_orden')),
  comision_porcentaje numeric(5,2),                   -- 0 a 100
  vigente_desde date not null,
  vigente_hasta date,                                 -- se llena al crear la siguiente versión
  unique (empresa_id, perfil_id, vigente_desde)
);
create table tarifas_destajo (                       -- monto por servicio del catálogo
  esquema_id uuid references esquemas_pago, servicio_id uuid, monto numeric(12,2),
  primary key (esquema_id, servicio_id)
);
```

- **Nunca se edita una versión ya usada en una liquidación.** Cambiar el sueldo crea una versión nueva con
  `vigente_desde` = hoy o una fecha futura. Las liquidaciones guardan `esquema_id`, así lo pasado no cambia.
- La ganancia por carro (`ganancias.ts`) pasa a leer el costo de aquí.

### 1.4 Comisiones (una por orden y persona)

```sql
create table comisiones (
  id uuid primary key, empresa_id uuid, perfil_id uuid,
  orden_id uuid not null references ordenes_trabajo,
  esquema_id uuid not null references esquemas_pago,
  tipo text check (tipo in ('comision','destajo')),
  base numeric(12,2) not null,          -- monto sobre el que se calculó
  monto numeric(12,2) not null,
  rol_en_ese_momento rol_t not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','liquidada','anulada')),
  liquidacion_id uuid references liquidaciones,
  motivo_anulacion text,
  unique (orden_id, perfil_id, tipo)    -- imposible comisionar dos veces la misma orden
);
```

### 1.5 Adelantos, bonos y descuentos sueltos

```sql
create table movimientos_personal (
  id uuid primary key, empresa_id uuid, perfil_id uuid,
  tipo text check (tipo in ('adelanto','bono','descuento')),
  monto numeric(12,2) check (monto > 0),
  fecha date, detalle text,
  medio text,                            -- efectivo, yape, transferencia… (solo adelanto)
  estado estado_pago_personal not null default 'borrador',
  liquidacion_id uuid references liquidaciones,   -- se llena cuando la liquidación lo descuenta o suma
  rol_en_ese_momento rol_t not null,
  aprobado_por uuid, aprobado_en timestamptz, pagado_por uuid, pagado_en timestamptz,
  anulado_por uuid, anulado_en timestamptz, motivo_anulacion text
);
```

### 1.6 Liquidaciones (nómina por periodo)

```sql
create type estado_pago_personal as enum ('borrador','aprobado','pagado','anulado');

create table liquidaciones (
  id uuid primary key, empresa_id uuid, perfil_id uuid,
  esquema_id uuid not null references esquemas_pago,
  rol_en_ese_momento rol_t not null,
  frecuencia text not null, periodo_inicio date not null, periodo_fin date not null,
  sueldo_base numeric(12,2), comisiones numeric(12,2), bonos numeric(12,2),
  adelantos numeric(12,2), descuentos numeric(12,2),
  neto numeric(12,2) generated always as
    (sueldo_base + comisiones + bonos - adelantos - descuentos) stored,
  estado estado_pago_personal not null default 'borrador',
  medio text, -- + quién y cuándo aprobó, pagó o anuló, y motivo
  check (periodo_fin >= periodo_inicio)
);
-- Bloqueo anti-duplicado: un solo periodo vigente por persona.
create unique index una_liquidacion_por_periodo on liquidaciones (empresa_id, perfil_id, periodo_inicio)
  where estado <> 'anulado';
-- Y que no se crucen periodos (extensión btree_gist ya disponible en Supabase):
alter table liquidaciones add constraint sin_cruce exclude using gist
  (perfil_id with =, daterange(periodo_inicio, periodo_fin, '[]') with &&) where (estado <> 'anulado');
```

### 1.7 Gastos: origen y trazabilidad (extiende `gastos`)

```sql
alter table gastos add column
  origen text not null default 'manual' check (origen in ('manual','caja','personal','importado')),
  origen_tabla text,                    -- 'liquidaciones' | 'movimientos_personal'
  origen_id uuid,
  perfil_id uuid references perfiles,
  rol_en_ese_momento rol_t,
  periodo daterange,
  concepto text;                        -- 'sueldo', 'adelanto', 'comision', 'bono'
create unique index gasto_por_origen on gastos (origen_tabla, origen_id) where origen_id is not null;
```

El índice único hace la relación **1 a 1**: un pago de personal no puede tener dos gastos.

```
perfiles 1─* miembros (rol por taller)          permisos 1─* rol_permisos
perfiles 1─* usuario_permisos                   permisos 1─* usuario_permisos
perfiles 1─* esquemas_pago 1─* tarifas_destajo
perfiles 1─* comisiones *─1 ordenes_trabajo      comisiones *─1 liquidaciones
perfiles 1─* movimientos_personal *─1 liquidaciones
liquidaciones 1─1 gastos      movimientos_personal (adelanto) 1─1 gastos
```

---

## 2. Lógica de negocio y seguridad

### 2.1 Permiso efectivo

```sql
create function privado.puede(p_empresa uuid, p_permiso text) returns boolean
language sql stable security definer set search_path = '' as $$
  with yo as (
    select m.rol, m.es_dueno from public.miembros m join public.perfiles p on p.id = m.perfil_id
    where m.empresa_id = p_empresa and m.perfil_id = auth.uid() and m.activo and p.activo
  )
  select case
    when not exists (select 1 from yo) then false                         -- sin acceso
    when exists (select 1 from yo where es_dueno) then true               -- el dueño puede todo
    else coalesce(
      (select permitido from public.usuario_permisos                      -- 1) excepción personal
        where empresa_id = p_empresa and perfil_id = auth.uid() and permiso = p_permiso),
      exists (select 1 from public.rol_permisos r join yo using (rol)     -- 2) alguno de sus roles
        where r.empresa_id = p_empresa and r.permiso = p_permiso))
  end;
$$;
```

`permiso_individual ?? permiso_rol`: la excepción manda; si no hay excepción, basta con que **uno** de
sus roles lo tenga. La app lee la lista completa una vez por pedido (`mis_permisos(empresa)`) para
decidir qué menú y botones mostrar.

### 2.2 Migración de reglas sin sorpresas

1. Se crean las plantillas idénticas a lo que hoy permite cada rol.
2. Por módulo, cada política `tiene_rol(…, array[roles])` pasa a `puede(…, 'permiso')`. Pruebas pgTAP
   antes y después: cada rol debe ver exactamente lo mismo.
3. Solo cuando un módulo ya usa `puede()` se muestran sus interruptores en la matriz (un interruptor que
   la base ignoraría no se muestra).

### 2.3 Desactivar (baja lógica)

`desactivar_persona(perfil, motivo)`: pone `activo = false` en sus `miembros` de ese taller y guarda
`fecha_cese` y `motivo_cese`. El efecto es **inmediato**, porque todas las reglas exigen `m.activo`, y
además la acción cierra sus sesiones abiertas (Auth admin: `signOut` global del usuario). No borra nada:
órdenes, movimientos de almacén y gastos siguen apuntando a su ID y muestran su nombre. Reactivar es
el camino inverso, también auditado.

### 2.4 Dueño protegido

Un disparador en `miembros` y `usuario_permisos` rechaza:
- desactivar, quitar el rol gerencia o eliminar al `es_dueno`;
- cualquier `usuario_permisos` con `permitido = false` sobre el dueño;
- que alguien que no es el dueño cambie permisos de gerencia.

Además, `puede()` devuelve siempre `true` para el dueño. Traspasar el dueño a otra persona es una
función aparte que solo el dueño actual puede ejecutar. Se mantiene «al menos una gerencia activa».

### 2.5 Máquina de estados (liquidaciones y movimientos)

```
           preparar / recalcular              pagar (medio, fecha)
 BORRADOR ───────────────► APROBADO ───────────────────────► PAGADO
    │  editable              │  montos congelados               │  crea el gasto (1 a 1)
    │                        │                                  │  + egreso de caja si fue en efectivo
    └──── anular ────────────┴──────── anular (motivo) ─────────┴──► ANULADO
                                                                     anula su gasto (mismo motivo)
                                                                     y libera comisiones y adelantos
```

Reglas que hace cumplir la base (función `cambiar_estado_pago` + disparador, no la pantalla):

| Paso | Quién (permiso) | Qué pasa |
|---|---|---|
| Crear y recalcular borrador | `nomina.preparar` | Toma comisiones `pendiente`, adelantos y bonos `pagado`/`aprobado` del periodo sin `liquidacion_id`, y el sueldo del esquema vigente |
| Aprobar | `nomina.aprobar` | Congela montos y marca comisiones `liquidada` y movimientos con `liquidacion_id` |
| Pagar | `nomina.pagar` | Crea **un** gasto (`origen = 'personal'`, `concepto = 'sueldo'`, monto = **neto**) |
| Anular | `nomina.aprobar` + motivo | Si estaba pagada, anula su gasto; devuelve comisiones a `pendiente` y suelta los movimientos |

Saltos prohibidos: de borrador a pagado, de pagado a borrador, y cualquier cambio después de anulado.
Un periodo anulado se puede volver a liquidar (el índice único excluye los anulados).

### 2.6 Cero duplicados con los adelantos

- Adelanto **pagado** → gasto en ese momento (`concepto = 'adelanto'`).
- Al cerrar el periodo, la liquidación lo **resta** (`adelantos`) y el gasto del sueldo es por el **neto**.
- Total en Gastos = adelanto + neto = sueldo real. Nada se cuenta dos veces.
- Si el neto sale negativo (adelantó más de lo que ganó), no se crea gasto: la diferencia pasa como
  `descuento` al siguiente periodo.
- Bonos y descuentos sueltos no generan gasto propio; entran en la liquidación.

### 2.7 Comisiones: solo órdenes cerradas y cobradas

Se generan con un disparador cuando la orden queda **entregada** (cerrada) y con **saldo cero**
(cobrada: `calcularSaldo` en la base). Si después se anula un pago o un comprobante:
- comisión `pendiente` → pasa a `anulada` con motivo;
- comisión ya `liquidada` → se crea un `descuento` por ese monto en el siguiente periodo.

Base: mano de obra de la cotización aprobada (o el total, según `comision_base`). Destajo: suma de
`tarifas_destajo` de los servicios de la orden. El técnico es el `tecnico_id` de la orden.

### 2.8 Gastos de solo lectura

Un disparador en `gastos` rechaza cualquier cambio de monto, fecha, categoría o estado cuando
`origen = 'personal'`, salvo que el cambio venga de las funciones de nómina (marca interna
`set_config('taller.desde_nomina', 'si', true)`). En la pantalla de Gastos esas filas muestran «Pagado
desde Personal» con enlace a la liquidación, y no tienen botón Anular.

Para que no haya dos caminos al mismo gasto, la categoría `sueldos` deja de poder elegirse a mano en
Gastos y en Caja: los pagos al personal se hacen desde Personal. Lo histórico ya registrado se queda
como está.

---

## 3. Pantallas

### 3.1 Configuración → Personal (reemplaza «Personal y roles»)

- **Arriba:** buscador, filtro por rol y por estado (Activos / Dados de baja) y el botón **Agregar persona**.
- **Lista:** nombre y cargo, roles (chips), esquema («Mixto · quincenal»), último acceso, y a la derecha
  **Modificar** y **Dar de baja**. El dueño lleva la etiqueta «Dueño» y no tiene «Dar de baja».
  En el celular cada persona es una tarjeta con los dos botones abajo.
- **Dar de baja:** ventana con motivo y fecha de cese. Explica que pierde el acceso al instante y que su
  historial se conserva.
- **Modificar** abre una vista con 3 pestañas:
  1. **Datos y contraseña:** nombre, celular, documento, cargo, fecha de ingreso, roles. Botón
     **Restablecer contraseña**, que genera una clave temporal que se ve una sola vez o la envía por WhatsApp.
  2. **Permisos de acceso:** matriz por módulo. Cada fila tiene el permiso, un interruptor y la marca
     «del rol» o «personalizado». Botón **Restaurar permisos del rol**. Los permisos sensibles piden
     confirmar. Arriba hay un resumen, por ejemplo: «Recepción + 2 permisos extra, 1 quitado».
  3. **Esquema de pago:** el esquema vigente y su historial de versiones. **Cambiar esquema** pide la
     fecha desde la que vale. Si es comisión o destajo, muestra el porcentaje o las tarifas por servicio.

### 3.2 Personal → Pagos (nómina)

- **Pestaña «Periodo»:** se elige la frecuencia y el periodo (por ejemplo, 1–15 nov). Muestra una fila por
  persona: base, comisiones, bonos, adelantos, neto y estado. Botones: **Preparar todo**,
  **Aprobar** y **Pagar**, este último con medio y fecha. Cada fila abre el detalle con cada orden
  comisionada y cada adelanto, enlazados.
- **Pestaña «Adelantos y bonos»:** registrar un adelanto (monto, medio; si es efectivo, sale de la caja
  abierta), bono o descuento, con su estado.
- **Boleta de pago en PDF** por liquidación, con el formato del taller y firma del trabajador.

### 3.3 Gastos

- Nuevo filtro **Origen**: Todos, Manual, Caja, Personal. Si eliges Personal, aparecen además filtros por
  persona y por concepto (sueldo, adelanto).
- Las filas de Personal muestran persona, rol en ese momento, periodo y concepto, con el ícono de
  candado y el texto «Se cambia desde Personal → Pagos».
- Los totales del mes separan «Personal» del resto, para ver cuánto cuesta el equipo.

---

## 4. Plan por fases

Cada fase se entrega completa (base con RLS y pruebas pgTAP, pantallas, pruebas, capturas a 390 y
1440 px, commit) y no rompe lo anterior.

| Fase | Contenido | Depende de |
|---|---|---|
| **1. Personal en Configuración** | Datos nuevos de `perfiles`, `es_dueno`, protección del dueño, dar de baja con motivo y cierre de sesión, reactivar, pantalla con «Modificar» (pestaña Datos y contraseña) | — |
| **2. Permisos** | `permisos`, `rol_permisos`, `usuario_permisos`, `puede()`, `mis_permisos()`; matriz con «Restaurar del rol». Menú y botones leen `mis_permisos`. Se migran a `puede()` primero Gastos, Reportes, Personal y Configuración; luego Almacén, Caja, Órdenes y Clientes, con pruebas «antes = después» | 1 |
| **3. Esquema de pago** | `esquemas_pago` versionado y tarifas de destajo; migra `costos_personal`; la ganancia por carro lo usa | 1 |
| **4. Gastos con origen** | Columnas de origen, índice 1 a 1, solo lectura para Personal, filtro Origen; `sueldos` deja de poder elegirse a mano | — |
| **5. Adelantos y bonos** | `movimientos_personal` con su máquina de estados; adelanto pagado → gasto (+ caja si es efectivo) | 3, 4 |
| **6. Comisiones** | Generación al cerrar y cobrar, anulación y ajustes; vista por persona | 3 |
| **7. Liquidaciones** | Preparar, aprobar, pagar y anular por periodo; gasto por el neto; boleta en PDF; reporte de costo de personal | 5, 6 |

Orden sugerido: 1 → 4 → 3 → 2 → 5 → 6 → 7. Lo primero da valor inmediato (altas y bajas seguras) y la
parte más delicada (permisos en todas las reglas) se hace con calma y con pruebas.

## 5. Por definir con el dueño

1. **«Cerrada y cobrada»:** se propone usar *entregada + saldo 0*. ¿O debe además tener boleta o factura?
2. **Base de la comisión:** ¿porcentaje sobre la mano de obra o sobre el total de la orden?
3. **Varios técnicos en un carro:** hoy hay un técnico por orden. ¿Se reparte la comisión?
4. **Frecuencia:** ¿todos con la misma, o cada persona con la suya?
5. **Adelantos en efectivo:** ¿siempre salen de la caja del día?
