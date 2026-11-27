# Entrega: Fases 3, 4 y 5 (dinero, cobros, reportes y respaldo)

Lo que se agregó en esta entrega, explicado sin tecnicismos. Lo de WhatsApp (Fase 2) y la lectura con IA siguen pendientes: necesitan las cuentas de WhatsApp Business, n8n y la llave de IA.

## Qué puede hacer cada rol ahora

| Rol | Nuevo |
| --- | --- |
| Gerencia | Todo lo de abajo, más **Reportes** (con Excel), la **utilidad y el margen** de cada orden, sueldos y comisiones en Configuración. |
| Administración y asesor | **Caja**: cobrar y ver deudas, registrar boletas y facturas, cotizar, cerrar el día y ver alertas. |
| Almacén | **Compras**: registrar la factura del proveedor (o subir su XML), mandar cada repuesto a una orden o al stock, y entregar repuestos del stock. |
| Técnico, ventas por redes, confirmación | Sin cambios: no ven montos. |

## Pantallas nuevas

- **Caja → Cobros y deudas** (`/cobros`): quién debe y cuánto, primero las órdenes ya entregadas. Botón «Cobrar» en cada una (monto sugerido = saldo) y lista de los últimos pagos. Medios: efectivo, Yape, Plin, tarjeta y transferencia.
- **Caja → Comprobantes** (`/ventas`): registrar boletas y facturas que ya emitiste. Si subes el XML de SUNAT se llena todo solo. Un comprobante sin orden queda en alerta hasta que lo asignes.
- **Compras** (`/compras` y `/compras/nueva`): factura del proveedor con sus repuestos. Proveedor nuevo o existente (se reconoce por RUC). Soles o dólares con tipo de cambio. Solo la factura descuenta IGV; en boleta o ticket el costo es el total. Pestaña «Stock sin orden» para entregar repuestos a una orden.
- **Dentro de cada orden**: tarjeta **Dinero** (cotizaciones con versiones y adicionales, aprobación por WhatsApp, en persona o por llamada; comprobantes; pagos; a cobrar, pagado y saldo), **Repuestos comprados** y, solo para gerencia, **Utilidad** con margen.
- **Caja → Cierre del día** (`/cierre`): boletas y facturas por separado, cobros por medio de pago, compras, utilidad estimada (gerencia) y «lo que no cuadra». «Cerrar el día» guarda una copia que ya no cambia.
- **Caja → Alertas** (`/alertas`, también desde la campana): las 9 de la especificación, ordenadas por urgencia: entregada sin comprobante, entregada con saldo, repuesto comprado que no aparece en el comprobante, margen bajo, orden sin avance, ingreso sin fotos o servicios, repuesto más caro que la última vez, adicional sin aprobar y comprobante sin orden.
- **Reportes** (`/reportes`, gerencia): ventas, compras, mano de obra, utilidad, margen y carros entregados mes a mes; por taller o todos juntos; personal con costo mensual y comisiones. **Descargar Excel** con 5 hojas (Resumen, Mes a mes, Comprobantes, Compras, Personal).
- **Panel**: ventas, compras, utilidad, la meta y el gráfico ya salen de lo registrado (antes decían «Ejemplo»).
- **Configuración** (gerencia): regla de mano de obra (prorrateo mensual o fijo por servicio), costo mensual de cada persona (con historia: un cambio vale desde ese día), mano de obra por servicio y reglas de comisión (pausar sin borrar).

## Cómo se calcula

- **Todo monto guarda sin IGV, IGV y total**, y la tasa de IGV de ese momento (si el IGV cambia, lo anterior no se mueve).
- **Utilidad de una orden** = venta sin IGV − repuestos comprados para esa orden sin IGV − mano de obra.
- **Mano de obra**: con prorrateo, el costo mensual del técnico ÷ órdenes que entregó ese mes; con fijo por servicio, la suma de los montos de sus servicios.
- **Saldo** = lo del comprobante (o, si aún no hay, lo de la cotización aprobada) − pagos confirmados.
- **Comisiones**: «cita que llegó y pagó» para quien la agendó; «trabajo entregado» para el técnico. Monto fijo o porcentaje de la venta sin IGV.

## Reglas que protegen el dinero (en la base de datos, no solo en pantalla)

- Nada con dinero se borra: se **anula con motivo** (mínimo 5 letras) y queda quién y cuándo.
- Un registro anulado ya no cambia; uno confirmado tampoco (se anula y se registra de nuevo).
- Cada rol solo lee y escribe lo suyo: almacén no ve ventas; técnicos no ven montos; sueldos solo gerencia (o administración si se lo permite).
- La compra y sus repuestos se guardan juntos o no se guarda nada (igual la cotización y sus líneas).

## Respaldo

`npm run respaldo -- --nube` guarda estructura, cuentas y datos con fecha en `respaldos/`. Guía para restaurar: [respaldo.md](respaldo.md). Se probó borrar la base local y restaurarla completa.

## Cómo se probó

- `npm test`: **83 pruebas** de cálculos (IGV céntimo a céntimo, utilidad, mano de obra, saldo, comisiones, cierre, las 9 alertas, lectura del XML) y de qué ve cada rol en el menú.
- `npm run test:db`: **88 pruebas de permisos** en la base (29 nuevas del dinero).
- Recorrido en el navegador con cada rol (13 pasos, todos OK): el asesor cobra, registra una boleta y aprueba una cotización; almacén registra una compra leyendo el XML y entrega un repuesto; gerencia anula un pago, cierra el día, crea una comisión y ve las alertas; el técnico no ve dinero; asesor y almacén no entran a Reportes ni a Cobros respectivamente.
- Capturas a 390 px y 1440 px, claro y oscuro, sin desbordes.

## Pendiente

- **Fase 2 (WhatsApp con n8n)** y **lectura con IA** de fotos de comprobantes: necesitan tus cuentas. Todo lo que lea la IA quedará «por confirmar» hasta que una persona lo apruebe (la base ya tiene ese estado).
- **Publicar en EasyPanel**: necesita el proyecto de Supabase en la nube y acceso a tu EasyPanel ([despliegue-easypanel.md](despliegue-easypanel.md)).
- **Fase 6 (inventario con stock mínimo)**: hoy existe el «stock sin orden» de compras; el inventario completo con códigos y stock mínimo queda para la siguiente entrega.
- `exceljs` trae una dependencia (`uuid` antigua) con un aviso de seguridad moderado que no afecta este uso (solo se generan archivos en el servidor).
