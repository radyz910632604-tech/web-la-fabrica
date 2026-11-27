# Caja integrada y cierre diario — entrega

Implementa el brief «Requerimiento funcional y visual: órdenes, cobro y cierre de caja»
sobre lo que ya existía, sin tablas duplicadas ni datos borrados.

## 1. Auditoría: qué se reutilizó

| Pedido del brief | Se reutilizó | Qué se agregó |
| --- | --- | --- |
| Servicios con cantidad, precio, subtotal, IGV | `cotizaciones` + `cotizacion_items` (precio en la cotización de la orden, una sola fuente del total) | Edición en línea desde la caja (`editar_lineas_orden`), precio sin IGV por unidad |
| Historial y usuario de cada cambio | Versiones de cotización (`editar_cotizacion`, la anterior queda anulada con quién la cambió), `cotizacion_items.creado_por` | El orden de las líneas se conserva (`clock_timestamp`) |
| Pagos parciales, mixtos, sin duplicar, sin cobrar de más | `registrar_cobro` (migración 0030) | Monto precargado con el saldo, selección de comprobante |
| Devoluciones vinculadas | Pagos tipo `devolucion` | `pagos.devuelve_pago_id` y `registrar_devolucion` (mismo medio, hasta lo que hay a favor) |
| IGV ON/OFF | `tasa_igv` por cotización (queda guardado el tratamiento aplicado) | `cambiar_igv_orden`; quitarlo lo autoriza gerencia o administración |
| Constancia / comprobante | Recibo interno, constancia de pago y estado de cuenta en PDF, registro de boleta/factura | Selector Constancia / Boleta / Factura separado del cálculo del IGV |
| Apertura, cierre y arqueo | `cajas`, `cerrar_caja`, `cierres_diarios` | `/cierre` con el diseño de la imagen 1 y «Cerrar caja» que también guarda el cierre del día |
| Word diario y Excel acumulativo | `exceljs` (ya en el proyecto) | `/cierre/word/[dia]` (con `jszip`, ya instalado) y `/cierre/excel?mes=` con 4 hojas |

Reglas que se mantienen:
- Ingresos = pagos confirmados.
- Cotización ≠ ingreso.
- Nada con dinero se borra.
- Los cierres quedan como histórico.
- Todo sigue con RLS y con las funciones de la base que revisan el rol.

Emisión electrónica: no hay integración con la SUNAT ni con un proveedor (OSE/PSE). La boleta o la factura se emite fuera del sistema y luego se registra en la orden. Conectar una integración tiene costo y requiere decidirlo antes.

## 2. Archivos

- **Base de datos:**
  - `supabase/migrations/20261116000032_caja_edicion_y_devoluciones.sql`
  - pruebas en `supabase/tests/28_caja_edicion.test.sql`
- **Cobro en una sola pantalla:**
  - `src/app/(app)/caja/cobro/page.tsx` y `acciones.ts`
  - `src/components/caja/panel-cobro.tsx`
  - `src/lib/taller/caja-cobro.ts`
  - `FormCobro` en `src/components/caja/cobro.tsx`
  - `/ordenes/[id]/cobrar` ahora redirige a la nueva pantalla
- **Cierre:**
  - `src/app/(app)/cierre/page.tsx`, `controles.tsx`, `acciones.ts`
  - `src/app/(app)/cierre/historial/page.tsx`
- **Ingresos** (una sola fuente para la pantalla, el Word y el Excel):
  - `src/lib/caja/ingresos.ts`
  - `src/lib/caja/ingresos-calculo.ts`
- **Exportaciones:**
  - `src/lib/word/docx.ts`
  - `src/app/(app)/cierre/word/[dia]/route.ts`
  - `src/app/(app)/cierre/excel/route.ts`
- **Pruebas:**
  - `tests/caja-cobro.test.ts`
  - `tests/ingresos.test.ts`

## 3. Pruebas hechas

- **Base de datos (16 nuevas):**
  - el técnico no cambia importes;
  - recepción arma la orden en caja: S/ 430 + IGV = S/ 507.40, aprobada;
  - editar crea una versión nueva y la línea que no cambia conserva su monto;
  - quitar el IGV es solo de gerencia, y prenderlo de nuevo restaura el total;
  - con la orden pagada, recepción ya no edita;
  - gerencia ajusta el total y la devolución queda limitada a lo que el cliente tiene a favor, por el mismo medio y vinculada al pago.
- **Navegador, recorrido completo:**
  1. Se buscó la orden por placa.
  2. Se agregaron 3 servicios en línea: S/ 550 + IGV = S/ 649.
  3. Se editó un precio: el total pasó a S/ 660.80 y quedó la versión anterior.
  4. Se comprobó que recepción no puede quitar el IGV.
  5. Abono de S/ 200 por Yape; quedó un saldo de S/ 460.80 y apareció la constancia.
  6. Pago mixto en efectivo y tarjeta, con doble clic: 3 pagos, sin duplicados, y la orden quedó «Pagada».
  7. Gerencia ajustó el precio y se registró una devolución vinculada al pago.
  8. El cierre muestra los 4 movimientos.
  9. Se cerró la caja con el conteo y la diferencia en cero.
  10. Word: incluye resumen, detalle, devoluciones y arqueo.
  11. Excel: tiene las 4 hojas, el registro suma S/ 649 y descargarlo dos veces no duplica filas.
  12. El total por métodos coincide con el ingreso neto.
  13. El historial muestra el cierre.
  14. Las pantallas no se desbordan a 390 px.

## 4. Cómo validarlo

1. EasyPanel → **Implementar** (la base se actualiza sola).
2. Caja → **Órdenes y cobro**:
   - elige una orden y agrega o edita servicios con el lápiz;
   - mira el subtotal, el IGV y el total;
   - cobra en uno o varios medios.
3. Caja → **Cierre del día**:
   - revisa el resumen y el detalle;
   - pulsa **Cerrar caja** con el efectivo contado;
   - descarga **Reporte en Word** y **Excel del mes**.
4. **Historial de cierres**: vuelve a descargar un día anterior o el Excel de otro mes.
