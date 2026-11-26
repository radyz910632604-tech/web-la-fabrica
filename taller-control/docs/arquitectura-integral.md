# Arquitectura integral: personal, caja y cobros, orden, almacén y rentabilidad

Diseño de los 5 módulos pedidos, **sobre lo que ya funciona**: no se crean tablas paralelas de órdenes,
pagos, compras ni gastos. Cada regla de dinero la hace cumplir la base de datos (RLS, funciones y
disparadores); la pantalla solo esconde lo que la base igual rechazaría.

- El módulo 1 (Personal, permisos y nómina) está detallado en `docs/personal-permisos-nomina.md`.
  Este documento le suma la regla del mecánico y lo une con los otros módulos.
- Términos: **orden** = orden de servicio (`ordenes_trabajo`); **línea** = servicio o repuesto de la orden.

---

## 0. Qué existe, qué se ajusta y qué es nuevo

| Pedido | Hoy | Acción |
|---|---|---|
| Personal: modificar, dar de baja, dueño protegido | Hecho (migración 0020) | — |
| Permisos por persona, esquema de pago, nómina | Diseñado | Construir (fases P2 a P7) |
| Cotización → orden, versiones, edición por recepción | Hecho (`cotizaciones`, `editar_cotizacion`) | Se vuelve la fuente de las **líneas** de la orden |
| Adicionales | Cotización adicional aparte (`es_adicional`) aprobada en bloque | **Aprobación por línea** |
| Descuentos | No hay | **Nuevo**: precio de lista, descuento, motivo, límite |
| Pagos parciales | Hecho (`pagos`: adelanto y saldo; saldo por orden) | Recibo **por cada abono** |
| Caja diaria con arqueo | Hecho (`cajas`, `movimientos_caja`, cierre con contado, esperado y diferencia) | Se conecta con cuentas por cobrar y la nómina |
| Cuentas por cobrar | Parcial: «Cobros y deudas» lista saldos | Bandeja con **fecha de compromiso**, días de atraso y entrega autorizada con deuda |
| Estado de pago separado | Se calcula el saldo, sin estado propio | **Estado de pago calculado** (nunca escrito a mano) |
| Despacho desde stock | Hecho (kardex; costo promedio a la orden) | Devolución a stock y precio de venta a la línea |
| Compra express para orden | Parcial: compras con `orden_id` (varios pasos) | **Nuevo**: 1 paso, 1 transacción |
| Alerta «falta costo» | Aviso por WhatsApp al almacén | Bloqueo/aviso al pasar a Listo o Entregado |
| Rentabilidad por orden | Hecho (`ganancias.ts`) | Alerta si falta costo |
| Resumen del dueño | Parcial (`totalesPeriodo`) | **Corregir doble conteo** (abajo) y agregar liquidez |

### Doble conteo que existe hoy (se corrige en la fase R1)

1. **Compras para el almacén** cuentan como costo el día que se compran, y otra vez como costo de la
   orden cuando el repuesto sale a un carro. Regla nueva: lo comprado para el almacén es **inventario**, no
   costo. Se vuelve costo solo al salir a una orden, por su costo promedio.
2. **Sueldos**: la utilidad neta resta el costo estimado del personal (`costos_personal`) **y además** los
   gastos de categoría «sueldos». Si se registran los dos, se cuentan dos veces. Regla nueva: el costo del
   personal sale **solo** de la nómina pagada (Gastos con origen Personal); el estimado sirve para planificar.

---

## 1. Esquema de base de datos (cambios)

Solo columnas y tablas nuevas; lo demás queda igual.

### 1.1 Líneas de la orden (sobre `cotizacion_items`)

La cotización ya tiene versiones, IGV, PDF y envío por WhatsApp. Sus líneas pasan a ser las líneas de la
orden, con estado por línea:

```sql
alter table cotizacion_items add column
  momento text not null default 'inicial' check (momento in ('inicial','adicional')),
  estado_aprobacion text not null default 'pendiente'
    check (estado_aprobacion in ('pendiente','aprobado','rechazado')),
  aprobado_en timestamptz, aprobado_por_medio text,       -- whatsapp, presencial, llamada
  precio_lista numeric(12,2),                              -- antes del descuento (con IGV)
  descuento numeric(12,2) not null default 0 check (descuento >= 0),
  descuento_motivo text, descuento_por uuid, descuento_autorizado_por uuid,
  -- origen del costo (repuestos)
  repuesto_id uuid references repuestos,                   -- si sale del stock
  compra_item_id uuid unique references compra_items,      -- si vino de una compra express (1 a 1)
  costo_unitario_sin_igv numeric(12,4),                    -- null = falta costo
  check (descuento <= coalesce(precio_lista, precio_unitario_total) * cantidad);
```

- **Total de la orden** = suma de líneas `aprobado` de versiones vigentes (no anuladas). Las `pendiente`
  se muestran aparte («por aprobar»); las `rechazado` no se cobran ni se ejecutan.
- Aprobar la cotización completa = aprobar todas sus líneas pendientes (lo que hoy hacen los botones de
  WhatsApp sigue igual).

### 1.2 Descuentos

```sql
alter table configuracion_empresa add column descuento_maximo_pct numeric(5,2) not null default 10;
```

Un descuento mayor al máximo exige el permiso `descuentos.sin_limite` o la autorización del dueño
(`descuento_autorizado_por`). Ejemplo: servicio de S/ 380 dejado en S/ 300 → `precio_lista` 380,
`descuento` 80, motivo «Cliente frecuente», total de la línea 300.

### 1.3 Orden: estados y compromiso de pago

```sql
alter type estado_orden add value 'cotizacion' before 'en_taller';  -- presupuesto sin carro
alter table ordenes_trabajo add column
  compromiso_pago date,                      -- cuándo promete pagar el saldo
  salida_con_deuda_por uuid,                 -- quién autorizó entregar con saldo
  salida_con_deuda_en timestamptz,
  cerrada_en timestamptz;                    -- entregada y saldo 0 (lo pone la base)
```

### 1.4 Estado de pago: calculado, nunca escrito

Una vista que la base mantiene al día; nada que se pueda desincronizar:

```sql
create view ordenes_saldo as
select o.id, o.empresa_id,
  total_orden,                                   -- comprobante vigente, si no recibo, si no líneas aprobadas
  total_abonado,                                 -- pagos confirmados - devoluciones
  total_orden - total_abonado as saldo_pendiente,
  case
    when total_abonado = 0 and total_orden > 0 then
      case when o.estado = 'entregado' then 'saldo_por_cobrar' else 'pendiente' end
    when total_abonado < total_orden then
      case when o.estado = 'entregado' then 'saldo_por_cobrar' else 'abono_parcial' end
    else 'pagada'
  end as estado_pago
from ordenes_trabajo o ...;
```

El cálculo ya existe en TypeScript (`calcularSaldo` en `src/lib/dinero.ts`); se pasa a la base para que
las reglas (entrega, cierre, comisiones, cuentas por cobrar) lean la misma cifra.

### 1.5 Recibo por cada abono

```sql
alter table pagos add column numero integer;      -- correlativo por taller
create unique index pagos_numero on pagos (empresa_id, numero);
alter table pagos add column caja_id uuid references cajas;   -- en qué caja entró
```

Cada abono tiene su constancia en PDF («Recibo de pago N.º 000123: S/ 150 a cuenta de OT-000045; saldo
S/ 150»). No se reemplaza el recibo de venta existente: uno es lo vendido, el otro lo cobrado.

### 1.6 Compra express

No se crea una tabla nueva: es **una función** que escribe en las tablas que ya existen, en una sola
transacción.

```sql
create function compra_express(
  p_orden uuid, p_descripcion text, p_cantidad numeric,
  p_costo_unitario numeric,          -- lo que se pagó
  p_precio_unitario numeric,         -- lo que paga el cliente
  p_aprobado boolean,                -- ¿el cliente ya lo aprobó?
  p_proveedor uuid default null, p_comprobante text default null,
  p_medio text default null,         -- si se pagó desde la caja del día
  p_guardar_catalogo boolean default false
) returns uuid;
```

Hace, todo o nada:
1. `compras` (confirmada, `sin_comprobante` si no hay) + `compra_items` con `orden_id`.
2. Si `p_guardar_catalogo`: crea el repuesto y registra **entrada + salida** a la orden en el kardex
   (el stock queda igual; el kardex muestra el paso).
3. Una línea `repuesto` en la orden con `compra_item_id` (único: 1 a 1), costo y precio. Queda
   `adicional`, `aprobado` o `pendiente` según `p_aprobado`.
4. Si `p_medio` es efectivo y hay caja abierta: un egreso en la caja **sin** categoría de gasto.

**No crea un registro en Gastos, a propósito.** En este sistema una compra ya es un costo; si además
fuera gasto, el repuesto restaría dos veces en la utilidad. Esa es justamente la regla anti-doble conteo
del módulo 5. La compra express se ve en Compras y en el costo de la orden.

### 1.7 Gastos con origen (de la parte de Personal)

```sql
alter table gastos add column origen text not null default 'manual'
  check (origen in ('manual','caja','personal','importado')),
  origen_tabla text, origen_id uuid, perfil_id uuid, rol_en_ese_momento rol_t, periodo daterange, concepto text;
create unique index gasto_por_origen on gastos (origen_tabla, origen_id) where origen_id is not null;
```

### 1.8 Personal: la regla del mecánico

El esquema de pago del técnico (mecánico) solo admite `fijo` o `destajo`. La base rechaza comisiones por
órdenes para el rol técnico:

```sql
check (tipo <> 'comision' or rol_en_ese_momento <> 'tecnico')    -- en comisiones
```

Las comisiones quedan para asesor y recepción (si el dueño lo decide); los bonos son libres para todos.

---

## 2. Máquinas de estado y recálculo

### 2.1 Estado operativo de la orden

```
cotizacion → en_taller (Ingresada) → en_diagnostico → espera_aprobacion → aprobado → en_proceso → listo (Terminada) → entregado
                                                                                     ↑              │
                                                                                     └── adicional ─┘  (aprobado un adicional: listo vuelve a en_proceso)
cualquier estado antes de entregado ──► anulada (con motivo; sin pagos vigentes)
entregado + saldo 0 ──► cerrada (la pone la base, no una persona)
```

| Paso | Regla de la base |
|---|---|
| → en_proceso / en_diagnostico | Debe tener técnico asignado (ya existe) |
| → listo | Ningún repuesto aprobado sin costo, salvo permiso `ordenes.listo_sin_costo` (queda registrado quién) |
| → entregado con saldo | Exige el permiso `autorizar_salida_con_deuda` y una fecha `compromiso_pago`; guarda quién autorizó |
| → entregado sin saldo | Pasa a `cerrada` al instante |
| Pago que deja saldo 0 en una orden entregada | Pasa a `cerrada` sola |
| Pago anulado o adicional aprobado en una orden cerrada | Vuelve a `entregado` con saldo (sale de cerrada) |
| → anulada | Motivo obligatorio; bloqueado si hay pagos o comprobantes vigentes (se anulan primero) |

### 2.2 Estado de pago (calculado)

```
pendiente ──abono──► abono_parcial ──abono──► pagada
    │                     │                     │
    └─ entregado ─► saldo_por_cobrar ◄── adicional aprobado o pago anulado
```

Se recalcula solo cuando cambia algo de esto: una línea aprobada o rechazada, un descuento, un pago, una
devolución, un comprobante o una nota de crédito. No hay botón para «marcar pagada».

### 2.3 Línea adicional

`pendiente → aprobado` (recalcula el total y el saldo; si la orden estaba lista, vuelve a en proceso) ·
`pendiente → rechazado` (no se cobra; si el repuesto ya salió del stock, se registra la **devolución**).
Una línea aprobada no se edita: se reemplaza con una versión nueva (`editar_cotizacion`), como hoy.

### 2.4 Cuentas por cobrar

Es una vista, no una tabla: órdenes con `saldo_pendiente > 0` y estado entregado (o con compromiso de
pago), con cliente, placa, orden, total, abonado, saldo, fecha de compromiso y días de atraso. Un abono
desde la bandeja entra a la caja abierta del día; si deja saldo 0, la orden se cierra.

### 2.5 Almacén

| Movimiento | Efecto |
|---|---|
| Salida a orden (stock) | Resta stock; la línea toma el costo promedio y el precio de venta |
| Devolución de orden | Suma stock al mismo costo con que salió; la línea queda rechazada o se reduce |
| Compra para el almacén | Suma stock y valor del inventario. **No es costo todavía** |
| Compra express | Costo directo de esa orden (ver 1.6) |

### 2.6 Nómina → Gastos

`borrador → aprobado → pagado → anulado`. Solo `pagado` crea **un** gasto (índice único por origen).
El adelanto pagado es gasto al momento y se descuenta en la liquidación. Detalle en
`docs/personal-permisos-nomina.md`.

---

## 3. Pantallas por rol

| Pantalla | Quién | Qué cambia |
|---|---|---|
| **Orden → Trabajos y repuestos** | Asesor, recepción, gerencia | Una sola lista de líneas con chip de estado (por aprobar / aprobado / rechazado), «Adicional», precio de lista tachado si hay descuento y el motivo. Botones: Agregar servicio, Desde almacén, **Compra express**, Pedir aprobación |
| **Compra express** (ventana en la orden) | Almacén, asesor, recepción | Descripción, cantidad, costo, precio al cliente, **margen al instante** (S/ y %), proveedor y comprobante opcionales, «¿Pagado desde la caja?», «Guardar en el catálogo» |
| **Orden → Cobro** | Recepción, asesor | Total, abonado, saldo y estado de pago; registrar abono (con recibo); entregar con saldo pide autorización y fecha de compromiso |
| **Caja del día** | Recepción | Igual que hoy: apertura, ingresos por medio y arqueo. Se suman los abonos de cuentas por cobrar y los adelantos de personal en efectivo |
| **Cuentas por cobrar** (reemplaza «Cobros y deudas») | Recepción, asesor, gerencia | Bandeja ordenada por días de atraso; filtro vencidas o por vencer; abonar desde la fila; avisar al cliente por WhatsApp |
| **Mecánico** | Técnico | Sus órdenes; **pedir repuesto** (llega al almacén o a quien hace la compra express); sin precios ni dinero |
| **Almacén** | Almacén | Despachos pendientes por orden, devoluciones y alertas de stock |
| **Rentabilidad por orden** | Gerencia | Venta, cobrado, saldo, costo de repuestos, ganancia S/ y %, y alerta «falta costo» |
| **Resumen del dueño** | Gerencia | Día, semana o mes: utilidad neta real, ingresos por medio, egresos, cuentas por cobrar, valor del inventario |
| **Configuración → Personal** | Gerencia | Modificar (datos, roles, contraseña) y Dar de baja: hecho. Luego Permisos y Esquema de pago |

### Utilidad neta real (anti-doble conteo)

```
Ingresos (ventas sin IGV del periodo)
− Costo directo de repuestos  = salidas de stock a órdenes (a costo promedio) + compras express de esas órdenes
− Gastos de personal          = solo Gastos con origen Personal (nómina y adelantos pagados)
− Gastos operativos           = Gastos manuales y de caja, sin la categoría sueldos
= Utilidad neta real
```

Las compras para el almacén suman al **valor del inventario**, no al costo. Así cada sol se cuenta una vez.

---

## 4. Fases

Cada fase se entrega completa (base de datos con pruebas pgTAP, pantallas, pruebas, capturas a 390 y
1440 px, commit) y deja funcionando lo anterior. Las letras son el módulo.

| # | Fase | Qué entrega | Depende de |
|---|---|---|---|
| 1 | **R1. Utilidad sin doble conteo** | Corrige el cálculo del mes (inventario y sueldos), valor del inventario y cuentas por cobrar en el resumen | — |
| 2 | **O1. Estado de pago y cierre** | Vista `ordenes_saldo`, estado de pago visible, cierre automático, entrega con deuda autorizada y fecha de compromiso | — |
| 3 | **C1. Cuentas por cobrar y recibo por abono** | Bandeja nueva, abono desde la bandeja a la caja, recibo PDF por cada abono | O1 |
| 4 | **O2. Líneas con aprobación y descuentos** | Aprobación por línea, adicionales que reabren la orden, descuento con motivo y límite | O1 |
| 5 | **A1. Compra express y falta de costo** | Función de un paso, ventana con margen, devolución a stock, bloqueo al pasar a Listo | O2 |
| 6 | **P2. Gastos con origen** | Origen y vínculo 1 a 1; «sueldos» deja de poder elegirse a mano | R1 |
| 7 | **P3–P7. Personal** | Esquema de pago (mecánico sin comisión), permisos por persona, adelantos y bonos, comisiones, liquidaciones | P2 |
| 8 | **R2. Resumen del dueño** | Pantalla día, semana y mes, y PDF | Todas |

R1 va primero porque hoy puede mostrar una utilidad equivocada si se registran sueldos en Gastos.

## 5. Decisiones del dueño (antes de las fases indicadas)

1. **Descuento máximo sin autorización** (O2): se propone 10 %.
2. **Comisiones** (P3–P7): quedan para asesor y recepción. ¿Sobre la mano de obra o el total? ¿Al cerrar
   la orden (entregada y pagada)?
3. **Presupuesto sin carro** (O2): ¿se necesita cotizar a alguien que todavía no trae el carro?
4. **Compra express pagada con caja** (A1): ¿sale siempre de la caja del día o a veces de otro lado?
