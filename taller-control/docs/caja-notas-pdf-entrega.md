# Entrega: caja de recepción, notas de crédito, abonos y PDF

Lo que se agregó después de las Fases 3, 4 y 5, a pedido del taller.

## Rol nuevo: Recepción y caja

| Puede | No puede |
| --- | --- |
| Abrir y cerrar la caja, cobrar (adelanto, abono, saldo, devolución), registrar boletas, facturas y notas de crédito, entregar el carro **listo** al cliente, ver órdenes, clientes y alertas de dinero, descargar recibos, estados de cuenta, arqueos y cierres en PDF. | Registrar ingresos, cambiar estados (salvo entregar), crear cotizaciones, ver compras, sueldos, utilidad o reportes. |

Persona de ejemplo: **Sandra Ríos, 900 000 009** (contraseña `taller-ejemplo` en local).

## Caja del día (`/caja`)

1. **Abrir caja:** se escribe con cuánto sencillo empieza. Solo puede haber una caja abierta por taller.
2. Cada **pago** que se registre (desde Caja, Cobros o la orden) entra solo a la caja abierta.
3. **Gasto o ingreso:** lo que sale o entra y no es pago de una orden (movilidad, útiles, sencillo extra, retiro para gerencia).
4. En pantalla se ve en vivo el **efectivo que debería haber** y lo cobrado por Yape, Plin, tarjeta y transferencia.
5. **Cerrar caja:** se cuenta el efectivo y se escribe. El sistema calcula lo esperado (en la base de datos, no en el celular) y guarda si **sobra o falta**. Una caja cerrada ya no se cambia; un pago de una caja cerrada no se anula (se registra una devolución en la caja de hoy).
6. Cada cierre tiene su **PDF de arqueo** con firmas de quien entrega y quien recibe.

## Abonos y devoluciones

- **Abono (pago a cuenta):** el cliente paga en partes; el saldo baja con cada abono. El **estado de cuenta en PDF** muestra cada cargo, abono y el saldo que va quedando.
- **Devolución:** solo hasta lo que el cliente tiene **a favor** (pagó de más o hubo nota de crédito). En Cobros aparece la lista «Saldo a favor del cliente» con el botón Devolver.

## Notas de crédito

- En **Comprobantes**, cada boleta o factura tiene «Nota de crédito»: serie (BC01, FC01…), número, fecha, motivo del catálogo 09 de SUNAT (anulación, descuento, devolución…) y monto. También se puede **subir el XML** de la nota y se llena sola.
- Nunca puede rebajar más que el comprobante. Resta de ventas, saldos, cierre del día, alertas, reportes y comisiones.
- Se anula con motivo, como todo lo que tiene dinero.

## Con IGV o sin IGV (18 %)

- **Cotización:** al crearla se elige «Con IGV (18 %)» o «Sin IGV», y si los precios que se escriben ya incluyen el IGV.
- **Comprobante:** opción «Operación sin IGV» (exonerada o inafecta).
- **PDF de la cotización:** dos botones, «PDF con IGV» (precios con IGV incluido) y «PDF sin IGV» (valor de venta sin IGV, y el IGV aparte al final).

## Documentos en PDF

Se abren en otra pestaña; desde ahí se descargan, imprimen o comparten (en iPhone: botón Compartir → Guardar en Archivos o WhatsApp).

| Documento | Dónde está el botón |
| --- | --- |
| Cotización (con o sin IGV) | Orden → Dinero → cada cotización |
| Orden de trabajo (con firmas) | Arriba en la orden |
| Recibo de pago o constancia de devolución | Orden → Pagos, y Cobros → Últimos pagos |
| Estado de cuenta (abonos y saldo) | Orden → Dinero |
| Resumen de boleta o factura (con sus notas de crédito) | Comprobantes y la orden |
| Registro de compra | Compras |
| Arqueo de caja | Caja del día |
| Cierre del día | Cierre del día |
| Reporte mensual (gerencia) | Reportes, junto al Excel |

El resumen de boleta o factura dice claramente que es un documento interno: el comprobante válido es el que se emite en el sistema de facturación o en SUNAT. Los datos de la cabecera (razón social, RUC, dirección, teléfono) salen de **Configuración → Datos del taller**.

## Cómo se probó

- 24 pruebas nuevas de permisos en la base (112 en total) y 8 nuevas de cálculos (91 en total).
- Recorrido en el navegador de la recepción: abrir caja, abono, gasto, cerrar con sobrante, abrir otra, PDF del arqueo, nota de crédito, entrega del carro; asesor con cotización sin IGV; técnico sin acceso a recibos (15 pasos, todos bien). Los 13 pasos de dinero anteriores siguen bien.
- Los 10 tipos de PDF generados y revisados.
- Capturas a 390 y 1440 px, claro y oscuro, sin desbordes.
