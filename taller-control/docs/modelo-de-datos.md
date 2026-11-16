# Modelo de datos propuesto — Taller Control

> Fase 0 · Propuesta para tu visto bueno. Todavía no existe en la base de datos.
> Explicado en sencillo: cada "tabla" es como una hoja de Excel; cada "campo" es una columna.

---

## 1. Reglas que cumplen todas las tablas

| Regla | Qué significa en la práctica |
|---|---|
| `id` | Cada registro tiene un código único interno (UUID). Nadie lo escribe a mano. |
| `empresa_id` | Todas las tablas dicen a qué taller pertenece el registro. Las únicas excepciones son `empresas` y `perfiles` (una persona puede trabajar en dos talleres). |
| Quién y cuándo | `creado_por`, `creado_en`, `actualizado_por`, `actualizado_en`. Los llena la base de datos sola. |
| Historial de cambios | Cada cambio queda en la tabla `auditoria` con cómo estaba antes y cómo quedó. |
| Nada con dinero se borra | Compras, ventas, pagos, cotizaciones y comisiones no se pueden borrar. Se **anulan** con `anulado_en`, `anulado_por` y `motivo_anulacion` (obligatorio). |
| Montos | Siempre en tres partes: `*_sin_igv`, `*_igv` y `*_total`, en soles con 2 decimales. Cada documento guarda la `tasa_igv` con la que se registró, así un cambio futuro del IGV no altera lo pasado. Si el comprobante trae los montos (XML o foto), se guardan tal cual; solo se calculan si faltan. |
| Fechas | Se guardan con zona horaria y se muestran y agrupan en hora de Lima (America/Lima). "Hoy" y "este mes" siempre son de Lima. |
| Origen | Los registros que pueden venir de WhatsApp guardan `origen` (`app`, `whatsapp`, `sistema`) y, si aplica, `mensaje_id`. |
| Permisos | Todas las tablas tienen RLS: la base de datos misma decide qué ve y qué cambia cada rol (sección 6). |
| Celulares | Se guardan en formato internacional: `+51987654321`. Se aceptan escritos con espacios o sin el +51. |
| Placas | Se guardan en mayúsculas y sin guion (`ABC123`) y se muestran con guion (`ABC-123`). |

---

## 2. Mapa general (quién se conecta con quién)

```
empresas
 ├─ miembros ───────────── perfiles (personas con acceso; celular para WhatsApp)
 │                          └─ costos_personal (solo gerencia)
 ├─ configuracion_empresa · metas_ventas · catalogo_servicios · preferencias_notificacion
 │
 ├─ clientes
 │   └─ vehiculos
 │       └─ ordenes_trabajo ◄──── citas ◄── campanas
 │           ├─ orden_servicios          (lo que pidió el cliente)
 │           ├─ orden_estados_historial  (cada cambio de estado)
 │           ├─ orden_avances            (reportes del técnico)
 │           ├─ archivos                 (fotos, videos, PDFs, XML)
 │           ├─ cotizaciones ── cotizacion_items
 │           ├─ comprobantes_venta ── comprobante_venta_items
 │           ├─ pagos
 │           ├─ compra_items ◄── compras ◄── proveedores
 │           ├─ entregas_stock           (repuesto sacado de stock para el carro)
 │           ├─ mano_obra_orden
 │           ├─ comisiones ◄── reglas_comision
 │           └─ alertas
 │
 ├─ cierres_diarios
 ├─ recordatorios_mantenimiento · encuestas_satisfaccion
 ├─ mensajes_whatsapp ── acciones_pendientes
 ├─ notificaciones · suscripciones_push
 ├─ auditoria
 └─ repuestos ── movimientos_inventario   (Fase 6, opcional)
```

Fase en la que se crea cada tabla: **F1** base · **F2** WhatsApp · **F3** dinero · **F4** cliente · **F6** inventario.

---

## 3. Tablas

### 3.1 Empresas, personas y acceso (F1)

**`empresas`** — cada taller.
- `nombre`, `razon_social`, `ruc`, `direccion`, `telefono`, `logo_url`, `activa`.

**`perfiles`** — cada persona con acceso al sistema (app o WhatsApp). Va unida al login de Supabase.
- `nombre`, `celular` (único en todo el sistema: así WhatsApp sabe quién escribe), `avatar_url`, `activo`.
- Sin `empresa_id`: las empresas de cada persona están en `miembros`.

**`miembros`** — qué rol tiene cada persona en cada taller.
- `empresa_id`, `perfil_id`, `rol` (ver enumeraciones), `activo`.
- Una fila por combinación empresa + persona + rol. Así alguien puede ser `asesor` en un taller y `confirmador` en el otro, o tener dos roles en el mismo.

**`costos_personal`** — cuánto cuesta cada persona al mes. **Solo gerencia** lo ve.
- `empresa_id`, `perfil_id`, `costo_mensual`, `vigente_desde`, `vigente_hasta`.
- Se guarda por periodos: si el sueldo cambia, se cierra el anterior y se abre otro. Los meses pasados no cambian.

### 3.2 Configuración (F1, se completa en F3)

**`configuracion_empresa`** — una fila por taller.
- `tasa_igv` (0.18), `dias_cliente_inactivo` (180), `dias_garantia_defecto` (por definir), `tolerancia_cita_minutos` (30), `horas_orden_sin_cambio` (48), `margen_minimo_pct`, `hora_resumen_mediodia` (12:00), `hora_cierre` (por definir), `regla_mano_obra` (`fijo_por_servicio` o `prorrateo_mensual`), `admin_ve_utilidad` (no), `admin_ve_sueldos` (no).

**`metas_ventas`** — `empresa_id`, `anio`, `mes`, `meta_sin_igv`. Una por mes.

**`catalogo_servicios`** — los servicios que ofrece el taller.
- `nombre` (ej. "Cambio de aceite", "Mantenimiento de caja automática", "Conversión a GNV"), `categoria` (`transmision`, `gnv_glp`, `aire_acondicionado`, `frenos`, `aceite`, `otro`), `precio_referencial`, `costo_mano_obra_fijo` (para la regla fija), `dias_garantia` (si es distinto al general), `activo`.
- Sirve para tres cosas: cotizar rápido, calcular mano de obra y detectar el reingreso por garantía ("mismo servicio").

**`preferencias_notificacion`** — por qué canal sale cada aviso, para controlar el costo.
- `empresa_id`, `tipo_aviso`, `por_push` (sí/no), `por_whatsapp` (sí/no), `plantilla_whatsapp` (nombre de la plantilla aprobada por Meta, si aplica).

### 3.3 Clientes y vehículos (F1)

**`clientes`**
- `nombre`, `celular` (único por empresa; es el identificador principal), `tipo_documento` (`dni`, `ruc`, `ce`, `ninguno`), `numero_documento`, `origen` (`redes`, `referido`, `recurrente`, `otro`), `referido_por_id` (otro cliente, opcional), `acepta_mensajes` (sí/no), `acepta_mensajes_en` (fecha en que dio o quitó el permiso), `notas`.
- Visitas, total gastado y última visita **no se guardan**: se calculan (vista `v_clientes_resumen`), así nunca quedan desactualizados.

**`vehiculos`**
- `placa` (única por empresa, validada con formato peruano), `marca`, `modelo`, `anio`, `color`, `combustible` (`gasolina`, `diesel`, `gnv`, `glp`, `dual`, `electrico`, `hibrido`), `transmision` (`mecanica`, `automatica`, `cvt`, `otra`), `kilometraje_actual`, `cliente_id` (dueño actual).
- Si el carro cambia de dueño, se cambia `cliente_id`; las órdenes antiguas conservan al cliente de ese momento.

### 3.4 Órdenes de trabajo (F1)

**`ordenes_trabajo`** — una por visita.
- `numero` (correlativo por taller: OT-000123), `vehiculo_id`, `cliente_id`, `cita_id` (si vino por cita), `kilometraje_ingreso`, `observaciones_ingreso`, `tecnico_id` (técnico responsable), `estado`, `estado_cambiado_en`, `ingresado_en`, `listo_en`, `entregado_en`, `es_reingreso_garantia` (sí/no), `orden_garantia_origen_id` (la orden original), `origen`.
- Estados: `en_taller` → `en_proceso` → `esperando_repuesto` → `listo` → `entregado`. Se puede volver atrás (por ejemplo de `listo` a `en_proceso`), y queda registrado.
- **No tiene precios.** El dinero vive en otras tablas; así el técnico puede ver la orden completa sin ver montos.

**`orden_servicios`** — lo que pidió el cliente.
- `orden_id`, `servicio_id` (del catálogo, opcional), `descripcion`, `es_adicional` (sí/no: surgió después del ingreso).

**`orden_estados_historial`** — cada cambio de estado, automático.
- `orden_id`, `estado_anterior`, `estado_nuevo`, `nota`, `cambiado_por`, `cambiado_en`.

**`orden_avances`** — lo que reporta el técnico ("ya bajé la caja, falta el kit").
- `orden_id`, `texto` (o la transcripción del audio), `autor_id`, `origen`, `mensaje_id`.

**`archivos`** — fotos, videos, PDFs, XML y audios.
- `orden_id`, `avance_id`, `compra_id`, `comprobante_venta_id`, `mensaje_id` (solo uno se llena), `tipo` (`foto`, `video`, `pdf`, `xml`, `audio`), `etapa` (`ingreso`, `proceso`, `entrega`, `comprobante`, `placa`), `bucket`, `ruta`, `mime`, `tamano_bytes`, `ancho`, `alto`, `duracion_seg`, `procesado` (si ya se comprimió).

### 3.5 Citas de redes (F1)

**`campanas`** — `nombre`, `red` (`facebook`, `instagram`, `tiktok`, `whatsapp`, `google`, `otro`), `fecha_inicio`, `fecha_fin`, `activa`.

**`citas`**
- `cliente_id` (si ya existe), `nombre_cliente`, `celular`, `fecha_hora`, `servicio_id` o `servicio_texto`, `red`, `campana_id`, `vendedor_id`, `estado`, `confirmada_por`, `confirmada_en`, `orden_id` (cuando llegó), `reprogramada_desde_id` (la cita anterior, si se reagendó), `notas`.
- Estados: `agendada`, `confirmada`, `llego`, `no_llego`, `reagendada`. Propongo agregar `cancelada` (el cliente avisó que no viene): ver preguntas.
- **Unión automática:** al crear una orden, la base de datos busca una cita del mismo celular, del mismo día (hora Lima) y en estado `agendada` o `confirmada`; si la encuentra, la pasa a `llego` y las une.
- **No llegó:** una tarea cada 10 minutos marca `no_llego` las citas cuya hora + tolerancia ya pasó sin orden, y avisa al vendedor.
- **Reagendar:** la cita original queda `reagendada` y se crea una nueva unida a ella (el reporte no la cuenta dos veces).

### 3.6 Cotizaciones (F4)

**`cotizaciones`** — `orden_id`, `version` (1, 2, 3…), `es_adicional` (sí/no), `estado` (`borrador`, `enviada`, `aprobada`, `rechazada`, `anulada`), `enviada_en`, `enviada_por`, `respuesta_en`, `respuesta_texto`, `aprobada_por_medio` (`whatsapp`, `presencial`, `llamada`), `mensaje_id` (el mensaje del cliente que sirve de prueba), `subtotal_sin_igv`, `igv`, `total`, `tasa_igv`.

**`cotizacion_items`** — `cotizacion_id`, `tipo` (`servicio`, `repuesto`), `servicio_id`, `descripcion`, `cantidad`, `precio_unitario_total` (lo que ve el cliente, con IGV), `subtotal_sin_igv`, `igv`, `total`.

- Un trabajo adicional = una nueva cotización con `es_adicional = sí`. Si se marca un servicio adicional en la orden y no hay cotización adicional aprobada, sale la alerta.

### 3.7 Compras y proveedores (F3)

**`proveedores`** — `ruc` (único por empresa), `razon_social`, `nombre_comercial`, `celular`, `activo`.

**`compras`** — el comprobante del proveedor.
- `proveedor_id`, `tipo_comprobante` (`factura`, `boleta`, `nota_venta`, `ticket`, `sin_comprobante`), `serie`, `numero`, `fecha_emision`, `moneda` (`PEN` o `USD`), `tipo_cambio`, `subtotal_sin_igv`, `igv`, `total`, `tasa_igv`, `estado` (`por_confirmar`, `confirmado`, `anulado`), `origen_datos` (`manual`, `xml_sunat`, `ia`), `confirmado_por`, `confirmado_en`.
- No se puede registrar dos veces el mismo comprobante (mismo proveedor + tipo + serie + número).

**`compra_items`** — cada línea del comprobante.
- `compra_id`, `descripcion`, `codigo` (si lo trae), `cantidad`, `precio_unitario_sin_igv`, `subtotal_sin_igv`, `igv`, `total`, `destino` (`orden` o `stock`), `orden_id` (si es para un carro), `repuesto_id` (Fase 6).
- La orden se asigna **por línea**, no por comprobante: una sola factura del proveedor suele traer repuestos para varios carros. En pantalla se elige una orden para todo el comprobante y se puede cambiar línea por línea.

**`entregas_stock`** — almacén saca un repuesto del stock para un carro.
- `orden_id`, `compra_item_id` (de qué compra de stock salió, si se sabe), `repuesto_id` (Fase 6), `descripcion`, `cantidad`, `costo_unitario_sin_igv`, `entregado_por`, `entregado_en`.

### 3.8 Ventas y cobros (F3–F4)

**`comprobantes_venta`** — la boleta o factura que se entregó al cliente. **El sistema no emite comprobantes electrónicos**; registra los que ya emitieron con su sistema actual.
- `orden_id` (si falta, sale la alerta), `cliente_id`, `tipo` (`boleta`, `factura`), `serie`, `numero`, `fecha_emision`, `documento_cliente`, `subtotal_sin_igv`, `igv`, `total`, `tasa_igv`, `estado` (`por_confirmar`, `confirmado`, `anulado`), `origen_datos`, `confirmado_por`, `confirmado_en`.

**`comprobante_venta_items`** — `comprobante_id`, `descripcion`, `cantidad`, `precio_unitario_sin_igv`, `subtotal_sin_igv`, `igv`, `total`, `compra_item_id` (opcional: une el repuesto vendido con el comprado, para la alerta "comprado pero no cobrado").

**`pagos`** — `orden_id`, `monto`, `tipo` (`adelanto`, `saldo`), `medio` (`efectivo`, `yape`, `plin`, `tarjeta`, `transferencia`), `pagado_en`, `numero_operacion` (opcional), `registrado_por`, `origen`, más los campos de anulación.

### 3.9 Mano de obra y comisiones (F3)

**`mano_obra_orden`** — cuánto costó la mano de obra de cada orden.
- `orden_id`, `tecnico_id`, `regla` (`fijo_por_servicio`, `prorrateo_mensual`), `monto`, `es_estimado` (sí mientras el mes no termina, en el caso del prorrateo), `calculado_en`.
- Se guarda (no solo se calcula) para que un reporte de un mes cerrado no cambie después.

**`reglas_comision`** — las define gerencia.
- `nombre`, `rol` al que aplica, `evento` (`cita_llego_y_pago`, `trabajo_entregado`, `venta_de_servicio`), `tipo_monto` (`fijo` o `porcentaje_venta_sin_igv`), `valor`, `servicio_id` (opcional, si aplica a un servicio), `vigente_desde`, `vigente_hasta`, `activa`.

**`comisiones`** — cada comisión ganada.
- `perfil_id`, `regla_id`, `orden_id`, `cita_id`, `periodo` (año-mes), `monto`, `estado` (`calculada`, `aprobada`, `pagada`, `anulada`).

### 3.10 Alertas y cierre (F3)

**`alertas`**
- `tipo` (los 9 de la especificación, ver enumeraciones), `severidad` (`info`, `atencion`, `urgente`), `orden_id`, `compra_id`, `comprobante_venta_id`, `mensaje` (texto claro: "OT-000123 se entregó con S/ 150.00 de saldo"), `datos` (detalle técnico), `estado` (`abierta`, `resuelta`, `descartada`), `resuelta_por`, `resuelta_en`, `motivo`.
- No se repite: si la misma alerta ya está abierta para la misma orden, no se crea otra.

**`cierres_diarios`** — una foto del día cuando alguien lo cierra.
- `fecha` (única por empresa), `ventas_boletas`, `ventas_facturas`, `compras`, `cobros_por_medio` (efectivo, Yape, Plin, tarjeta, transferencia), `utilidad_estimada`, `descuadres` (lista de lo que no cuadra), `observaciones`, `cerrado_por`, `cerrado_en`.

### 3.11 Clientes: seguimiento (F4)

**`recordatorios_mantenimiento`** — `vehiculo_id`, `cliente_id`, `servicio_id`, `tipo` (`fecha` o `kilometraje`), `fecha_objetivo`, `km_objetivo`, `estado` (`programado`, `enviado`, `cumplido`, `cancelado`), `enviado_en`, `orden_origen_id`.
- Para el kilometraje se estima cuántos km por día recorre el carro según sus visitas anteriores.
- Solo se envía si el cliente tiene `acepta_mensajes = sí`. Esto lo revisa la base de datos, no solo la pantalla.

**`encuestas_satisfaccion`** — `orden_id`, `cliente_id`, `enviada_en`, `respondida_en`, `puntaje` (1 a 5), `comentario`.

### 3.12 WhatsApp, notificaciones y auditoría (F1–F2)

**`mensajes_whatsapp`** — la tabla de auditoría de WhatsApp: todo lo que entra y sale.
- `wa_message_id` (único: si Meta reenvía el mismo mensaje, no se procesa dos veces), `direccion` (`entrante`, `saliente`), `celular`, `perfil_id` (vacío si el número no está registrado), `empresa_id` (vacío si no se sabe), `tipo` (`texto`, `audio`, `imagen`, `video`, `documento`, `boton`), `texto`, `transcripcion`, `archivo_id`, `intencion`, `datos_extraidos`, `resultado` (`sin_acceso`, `pendiente_confirmacion`, `confirmado`, `corregido`, `faltan_datos`, `error`), `respuesta`, `error_detalle`, `proveedor_ia`, `modelo_ia`.

**`acciones_pendientes`** — lo que la IA entendió y espera el botón "Confirmar".
- `perfil_id`, `mensaje_id`, `intencion`, `datos`, `resumen` (el texto que se le mostró), `faltan` (qué datos se están preguntando), `estado` (`esperando_confirmacion`, `confirmada`, `corregida`, `expirada`, `cancelada`), `expira_en`, `resultado` (qué registros se crearon al confirmar).
- **Nada se guarda en las tablas reales hasta que se confirma.** Si nadie confirma en 24 horas, expira.

**`notificaciones`** — cada aviso enviado.
- `perfil_id` o `cliente_id`, `tipo_aviso`, `canal` (`push`, `whatsapp`), `titulo`, `cuerpo`, `estado` (`pendiente`, `enviada`, `fallida`, `leida`), `enviada_en`, `error`.

**`suscripciones_push`** — los celulares y computadoras donde cada persona aceptó recibir avisos de la app.
- `perfil_id`, `endpoint`, `claves`, `dispositivo`.

**`auditoria`** — quién cambió qué y cuándo, en todas las tablas.
- `tabla`, `registro_id`, `empresa_id`, `accion` (`crear`, `editar`, `anular`), `antes`, `despues`, `perfil_id`, `origen`, `creado_en`.
- Nadie puede editarla ni borrarla, ni siquiera gerencia.

### 3.13 Inventario (F6, opcional)

**`repuestos`** — `codigo` (único por empresa), `descripcion`, `marca`, `unidad`, `stock_actual`, `stock_minimo`, `costo_promedio_sin_igv`, `precio_venta`, `activo`.

**`movimientos_inventario`** — `repuesto_id`, `tipo` (`entrada_compra`, `salida_orden`, `ajuste`), `cantidad`, `costo_unitario_sin_igv`, `compra_item_id`, `orden_id`, `motivo`.
- Al llegar a esta fase, `entregas_stock` pasa a alimentar los movimientos de salida; no hay que rehacer nada.

---

## 4. Cálculos (vistas: se calculan, no se escriben a mano)

| Vista | Qué calcula |
|---|---|
| `v_resumen_orden` | Venta, compras, mano de obra, utilidad, margen, cobrado y saldo de cada orden. **Solo gerencia** (y administrador si gerencia lo permite). |
| `v_clientes_resumen` | Visitas, total gastado, última visita y si está inactivo. |
| `v_panel_mes` | Los 4 indicadores del panel y su variación contra el mes anterior. Cada rol recibe solo los que puede ver. |
| `v_saldos` | Deudas: órdenes con saldo pendiente. |
| `v_mis_trabajos` | Lo que ve el técnico: sus órdenes con carro, servicios, fotos y avances. Sin cliente ni montos. |
| `v_mis_citas_resultado` | Lo que ve el vendedor de redes: si su cliente llegó y cuánto compró (total). Sin costos. |
| `v_citas_reporte` | Asistencia por vendedor y por campaña, y venta generada por cita. |

### Fórmulas

- **IGV** (si el comprobante no trae los montos): `sin_igv = total ÷ (1 + tasa)` redondeado a 2 decimales; `igv = total − sin_igv`.
- **Venta de la orden** = suma de `subtotal_sin_igv` de sus comprobantes de venta confirmados y no anulados.
- **Compras de la orden** = líneas de compra confirmadas asignadas a la orden + entregas de stock (todo sin IGV). Las compras en dólares se convierten con su `tipo_cambio`.
- **Mano de obra:**
  - Fija: suma del `costo_mano_obra_fijo` de los servicios de la orden.
  - Prorrateo: costo mensual del técnico ÷ número de órdenes que entregó ese mes. Mientras el mes está abierto, el monto es **estimado**.
- **Utilidad** = venta − compras − mano de obra. **Margen** = utilidad ÷ venta.
- **Monto a cobrar** = total (con IGV) de los comprobantes de venta; si todavía no hay comprobante, el total de las cotizaciones aprobadas.
- **Saldo** = monto a cobrar − pagos no anulados.
- **Comisión** según su regla: monto fijo por evento, o porcentaje de la venta sin IGV.

---

## 5. Archivos (Supabase Storage)

| Carpeta (bucket) | Qué guarda | Ruta |
|---|---|---|
| `ordenes` | Fotos y videos de ingreso, proceso y entrega | `{empresa}/{orden}/{archivo}` |
| `comprobantes` | Fotos, PDF y XML de compras y ventas | `{empresa}/{compras o ventas}/{id}/{archivo}` |
| `whatsapp` | Lo que llega por WhatsApp, tal cual | `{empresa}/{fecha}/{mensaje}` |

- Todas son privadas: los archivos se abren con enlaces temporales.
- El técnico no puede abrir `comprobantes`. Almacén no puede abrir comprobantes de venta.
- **Fotos:** se reducen en el mismo celular antes de subir (máx. ~1600 px, calidad 80 %). Una foto de 4 MB queda en unos 300 KB.
- **Videos:** se suben y luego el servidor los convierte a 720p con ffmpeg (programa gratuito, va dentro del Docker). Propongo un límite de 60 segundos por video.

---

## 6. Permisos por rol

L = puede ver · E = puede crear o cambiar · — = no ve nada · (propio) = solo lo suyo

| Datos | gerencia | administrador | asesor | técnico | almacén | vendedor redes | confirmador |
|---|---|---|---|---|---|---|---|
| Empresas y configuración | L E | L E | L | — | — | — | — |
| Personal (nombre, rol, celular) | L E | L E | L | L (nombres) | L (nombres) | L (nombres) | L (nombres) |
| Costo mensual del personal | L E | — ¹ | — | — | — | — | — |
| Clientes | L E | L E | L E | — ² | — | L E (los suyos) | L (de citas del día) |
| Vehículos | L E | L E | L E | L ² | L | L (de sus citas) | — |
| Órdenes (sin dinero) | L E | L E | L E | L E (propio) ³ | L | L (de sus citas) | — |
| Fotos y avances | L E | L E | L E | L E (propio) | L | — | — |
| Citas y campañas | L E | L E | L E | — | — | L E (propio) | L + confirmar |
| Cotizaciones | L E | L | L E | — | — | — | — |
| Compras y proveedores | L E | L | L ⁴ | — | L E | — | — |
| Entregas de stock | L E | L | L | — | L E | — | — |
| Comprobantes de venta | L E | L | L E | — | — | total por cita | — |
| Pagos y deudas | L E | L | L E | — | — | — | — |
| Mano de obra y utilidad | L | — ¹ | — | — | — | — | — |
| Reglas de comisión | L E | — | — | — | — | — | — |
| Comisiones | L E | — | L (propio) ⁵ | L (propio) ⁵ | — | L (propio) ⁵ | L (propio) ⁵ |
| Alertas | L E | L | L (sin margen) | — | L (de compras) | — | — |
| Cierre diario | L E | L | L E (sin utilidad) | — | — | — | — |
| Mensajes WhatsApp y auditoría | L | L | — | — | — | — | — |

1. El administrador no ve sueldos ni utilidad salvo que gerencia lo active en la configuración.
2. El técnico ve el carro de sus órdenes, pero no los datos del cliente ni montos.
3. El técnico solo cambia el estado y agrega avances y fotos; no edita el resto de la orden.
4. Pregunta pendiente: ¿el asesor debe ver el costo de las compras? Si lo ve, puede calcular un margen aproximado por su cuenta.
5. Pregunta pendiente: ¿cada persona ve sus propias comisiones?

**Cómo se hace cumplir:** cada tabla tiene sus reglas RLS en la base de datos. Las acciones con varias reglas (confirmar una cita, cambiar un estado, anular un pago) se hacen con funciones de la base de datos que revisan el rol antes de actuar. La app y WhatsApp usan exactamente las mismas funciones, así no hay "puerta trasera".

---

## 7. Tareas automáticas

| Cada cuánto | Qué hace |
|---|---|
| Al momento (disparadores) | Une cita con orden · historial de estados · auditoría · alerta de precio más alto · alerta de ingreso incompleto · reingreso por garantía · comisiones por evento. |
| Cada 10 minutos | Marca citas `no_llego` y avisa al vendedor. |
| Cada hora | Revisa órdenes estancadas y entregadas sin comprobante o con saldo. |
| Cada mañana (≈7:30) | Lista de citas del día al confirmador. |
| 12:00 y hora de cierre | Resumen por rol. |
| Cada noche | Recordatorios de mantenimiento, clientes inactivos, vencimiento de acciones pendientes. |

La lógica vive en la base de datos y en la app; el "reloj" que las dispara es n8n, así todas las tareas programadas se ven en un solo lugar.

---

## 8. Listas de valores (enumeraciones)

| Lista | Valores |
|---|---|
| rol | `gerencia`, `administrador`, `asesor`, `tecnico`, `almacen`, `vendedor_redes`, `confirmador` |
| estado de orden | `en_taller`, `en_proceso`, `esperando_repuesto`, `listo`, `entregado` |
| estado de cita | `agendada`, `confirmada`, `llego`, `no_llego`, `reagendada` (+ `cancelada` si lo apruebas) |
| origen de cliente | `redes`, `referido`, `recurrente`, `otro` |
| medio de pago | `efectivo`, `yape`, `plin`, `tarjeta`, `transferencia` |
| tipo de pago | `adelanto`, `saldo` |
| estado de documento | `por_confirmar`, `confirmado`, `anulado` |
| origen de los datos | `manual`, `xml_sunat`, `ia` |
| intención (WhatsApp) | `nuevo_ingreso`, `avance`, `compra`, `comprobante_venta`, `pago`, `cita`, `cotizacion`, `historial`, `ayuda`, `desconocido` |
| tipo de alerta | `repuesto_no_cobrado`, `entregada_sin_comprobante`, `entregada_con_saldo`, `margen_bajo`, `orden_estancada`, `ingreso_incompleto`, `precio_compra_subio`, `adicional_sin_aprobacion`, `comprobante_sin_orden` |
| canal | `push`, `whatsapp` |
