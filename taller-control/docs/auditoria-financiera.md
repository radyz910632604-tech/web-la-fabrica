# Auditoría del sistema financiero (órdenes, ventas, cobros y caja)

Revisión hecha antes de programar, sobre la base actual (migraciones 0001 a 0029) y las pantallas.
Regla seguida: reutilizar lo que ya existe, no duplicar tablas y no cambiar lo que no hace falta.

## 1. Qué ya existía (y se reutilizó)

| Pedido | Dónde está | Estado |
| --- | --- | --- |
| Servicios y repuestos con cantidad, precio unitario y subtotal | `cotizaciones` + `cotizacion_items` (tipo servicio/repuesto), editor en `/cotizaciones/nueva?orden=…` (trae los servicios de la orden) | Ya estaba |
| Total automático, IGV sí/no, editar precios | `guardar_cotizacion()` y `privado.totales_cotizacion` (la base recalcula) | Ya estaba |
| Servicios adicionales durante la reparación | Cotización adicional (versión nueva) y «Agregar trabajo adicional» en la orden | Ya estaba |
| Una cotización no es ingreso | La venta sale de boleta/factura o del recibo; lo cobrado sale de `pagos` | Ya estaba |
| Pagos parciales con fecha, hora, usuario, medio y n° de operación | `pagos` (tipos adelanto, abono, saldo, devolución; `creado_por` por sello) | Ya estaba |
| Comprobante interno | `recibos` (`emitir_recibo`, correlativo propio) y constancia de cada pago | Ya estaba; se mejoró |
| Boletas y facturas SUNAT | `comprobantes_venta` + notas de crédito (se registran, no se emiten) | Ya estaba |
| Apertura y cierre de caja | `cajas` por área, `cerrar_caja()`, `privado.calcular_caja`, PDF de caja, corte automático 00:00, Caja Maestra | Ya estaba |
| Egresos aparte de ingresos | `movimientos_caja` y `gastos` | Ya estaba |
| Anular sin borrar, con motivo | Disparador `privado.proteger_dinero`; pagos de caja cerrada no se anulan | Ya estaba |
| Utilidad separada de venta y cobro | `totalesPeriodo`, `reporteMensual`, ganancia por carro | Ya estaba |
| Permisos en la base | RLS `privado.ve_caja` (gerencia, administración, asesor, recepción) | Ya estaba |

## 2. Qué faltaba (y se hizo)

1. **Pago mixto en una sola operación.** Antes se registraba un medio a la vez. Ahora
   `registrar_cobro(orden, código, líneas)` (migración 0030) guarda varios medios a la vez, todo o nada.
2. **Sin pagos duplicados.** Cada cobro lleva un código único creado por la pantalla
   (`pagos.cobro_id` + índice único). Un doble clic o un reintento no se registra dos veces.
   La orden se bloquea mientras se cobra (`for update`).
3. **Validación en el servidor.** La base calcula lo que falta cobrar (`privado.cuenta_orden`, igual que
   `saldo()` en `src/lib/dinero.ts`) y no deja cobrar de más. El tipo (adelanto, abono o saldo) también lo
   decide la base.
4. **Pantalla «Cobrar orden»** (`/ordenes/[id]/cobrar`): número de orden, cliente, DNI o RUC, placa,
   servicios, repuestos, descuento, total, pagado, saldo, pagos con quién los cobró, y el formulario de cobro.
   Avisa si la caja de Recepción está cerrada.
5. **Estado de pago visible** en la orden: Sin precio, Pendiente de pago, Pago parcial, Pagada o Saldo a
   favor (`estadoPago()`, calculado y no guardado, para que nunca se desincronice), con el botón «Cobrar».
6. **Recibo interno más completo:** descuento, importe pagado, saldo pendiente, pagos por medio y la
   aclaración de que no es boleta ni factura electrónica.
7. **Resumen de caja** (`/caja/resumen`): Hoy, Ayer, Esta semana, Este mes o fechas elegidas. Muestra el total
   vendido, el total cobrado, lo pendiente de cobro, las salidas, los ingresos por medio, el detalle por
   trabajador y cada operación enlazada a su orden. Quien no es gerencia ni administración ve solo sus
   operaciones.
8. **Descuentos autorizados:** solo gerencia o administración ponen o cambian un descuento
   (disparador `cotizaciones_descuento_autorizado`). Una versión nueva que conserva el descuento ya autorizado sí pasa.

## 3. Decisiones

- **No se creó una tabla nueva de «servicios con precio» en la orden.** Los precios viven en la
  cotización aprobada, que ya tiene líneas, descuento, IGV, versiones y PDF. Duplicarlos en la orden
  habría creado dos totales que pueden no coincidir.
- **El estado de pago no se guarda:** se calcula de lo cobrado y lo aprobado, así no puede quedar mal.
- **Los pagos entran a la caja de Recepción** (regla ya existente). Si está cerrada, el cobro se guarda en
  la orden pero no entra al cuadre del día; la pantalla lo advierte.
- **Anulaciones** de pagos, recibos y órdenes siguen pidiendo motivo; nada con dinero se borra.

## 4. Pruebas

- Base de datos: `supabase/tests/26_cobro_mixto.test.sql` cubre los permisos, el todo o nada, que no se
  cobre de más, el parcial, el reintento sin duplicar, el mixto que completa, quién cobró y los descuentos autorizados.
- Unitarias: `tests/estado-pago.test.ts` y `tests/periodo.test.ts`.
- Navegador (los 10 escenarios pedidos):
  1. Orden con tres servicios.
  2. Repuesto agregado.
  3. Total de S/ 500 con descuento.
  4. Pago completo.
  5. Pago parcial: S/ 200 Yape, saldo S/ 300.
  6. Pago mixto: S/ 200 efectivo + S/ 100 transferencia, orden pagada.
  7. Recibo PDF.
  8. Resumen con las tres operaciones.
  9. Cierre de caja con el efectivo esperado correcto (sube solo lo cobrado en efectivo) y su PDF.
  10. Sin duplicados, incluso con doble clic.
