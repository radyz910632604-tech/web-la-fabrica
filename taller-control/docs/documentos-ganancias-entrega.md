# Entrega: documentos del taller, ganancias y WhatsApp para almacén

## 1. Documentos PDF con el formato del taller

Todos los PDF llevan arriba un recuadro gris con el **logo**, la razón social, el RUC, el teléfono, el correo, la dirección y la frase del taller. A la derecha va el tipo de documento con su número y fecha.

| Documento | Qué trae |
| --- | --- |
| **Recibo** (nuevo) | Número correlativo, número de orden, fecha y hora, «Hecho por»; cliente con DNI o RUC y teléfono; información del vehículo (placa, marca, modelo, estilo, color, año, kilometraje); detalle CANTIDAD · DESCRIPCIÓN · UNITARIO · DESC. · IMP · TOTAL; «Última línea»; «Recibe conforme (Cliente)»; totales (otros cargos, gravado o exento, subtotal, descuento, IGV, total); método de pago; **monto en letras**; observaciones (el asesor) y la marca de agua **ORIGINAL** (o **ANULADO**). |
| **Proforma** (cotización) | Número en azul, fecha, **fecha de vencimiento a 30 días**, cliente y carro, detalle con el mismo formato, «Firmado por» el taller y «PRECIOS SUJETOS A CAMBIOS SIN PREVIO AVISO». |
| **Orden de reparación** | Placa y número en rojo, fecha, fecha de inicio, fecha final, entrega prometida y responsable; cliente con WhatsApp; detalles del vehículo con el **medidor de combustible**; detalle con precios (si quien la pide ve la caja) y el recuadro PRODUCTOS · SERVICIOS · SUBTOTAL · ABONOS · TOTAL; firmas. |
| **Arqueo de caja** | Ingreso de ventas por medio de pago, otras entradas (abonos, pago inicial, movimientos), total consolidado por medio, salidas, cierre de caja en efectivo (esperado, contado, descuadre) y el detalle de cada cobro con su número de recibo. |

**Configuración → Datos del taller**: correo y frase. **Configuración → Logo**: sube el logo (PNG o JPG, hasta 1 MB). **Configuración → Reglas**: «Seguir los recibos desde el número», para continuar la numeración del sistema anterior.

**Nuevo ingreso** ahora pide también el **tipo de carro** (sedán, SUV, camioneta…) y el **nivel de combustible** (reserva, 1/4, 1/2, 3/4, lleno). Salen en la orden de reparación.

## 2. Recibo de venta y ganancias exactas

- En la orden, **Dinero → Recibo de venta → Emitir recibo**. Lo pueden emitir recepción, el asesor, administración y gerencia. Cobra lo de la cotización aprobada y la base le pone el número correlativo. Solo hay un recibo vigente por orden; para cambiarlo, gerencia o administración lo **anulan con motivo**.
- **El recibo cuenta como la venta** cuando la orden no tiene boleta ni factura, así no se cuenta dos veces. Por eso, al emitirlo, la venta queda registrada y se le restan sus costos.
- **Ganancia de cada carro** (en Reportes): venta − repuestos (compras para la orden y salidas del inventario) − mano de obra = **utilidad**, con su margen.
- **Utilidad neta del mes** (en Reportes, PDF y Excel):

  | | |
  | --- | --- |
  | Ventas | |
  | − Repuestos y compras | |
  | − Mano de obra técnica | |
  | **= Utilidad bruta** | |
  | − Gastos del taller | alquiler, luz, agua, internet, publicidad… |
  | − Sueldos del resto del personal | asesores, recepción, almacén… |
  | − Comisiones | |
  | **= Utilidad neta** | lo que realmente gana el taller |

- **Caja → Gastos del taller** (gerencia y administración): se registran el alquiler, la luz, el agua y demás gastos, con su total por categoría. Un gasto equivocado se anula con motivo; no se borra.

## 3. WhatsApp

### Almacén: «llegaron repuestos»

1. Almacén manda una **nota de voz**: «Llegaron 4 galones de aceite 10W40 de Lubricantes Demo, factura F001-123, a 85 cada uno».
2. El sistema entiende el proveedor, el comprobante y cada repuesto, y **pide la foto** de los repuestos o de la factura como evidencia. Si no hay foto, se responde «sin foto».
3. Muestra el resumen: cada repuesto con su precio y si está en el inventario. Si viene con placa, los repuestos van a esa orden.
4. Al tocar **Confirmar**, queda como compra **por confirmar** en **Compras**, con la foto. Cuando alguien la revisa y confirma, entra al inventario y aparece en el reporte de compras.

Sin llave de IA también funciona con el formato «llegaron de Lubricantes Demo factura F001-123: 4 aceite 10W40 a 85, 2 filtros a 30».

### Gerencia, administración y asesores: pedir un PDF

| Mensaje | Respuesta |
| --- | --- |
| «recibo ABC123» | El recibo de la última orden de ese carro. |
| «cotización ABC123» o «proforma ABC123» | La última proforma. |
| «orden ABC123» | La orden de reparación. |
| «cierre de caja» | El arqueo de la caja de hoy (o el último). |

El PDF se arma con los permisos de quien lo pide y se envía como **documento de WhatsApp**. El enlace vence en una hora. El técnico no recibe documentos con montos.

En n8n no hay que configurar nada nuevo: solo se vuelve a importar `whatsapp-entrante.json`.

## Cómo se probó

- `npm test`: **137 pruebas**, entre ellas el monto en letras, el lector de «llegaron repuestos», el pedido de documentos y las alertas de entrega.
- `npm run test:db`: **191 pruebas de permisos**, 16 nuevas: numeración de recibos que sigue la del sistema anterior, un recibo vigente por orden, quién emite y quién anula, gastos que solo ven gerencia y administración, nivel de combustible por cuartos.
- Recorridos automáticos:
  - Recepción por nota de voz con foto, el técnico sin permiso, y los cuatro PDF por WhatsApp con su enlace (15 pasos).
  - Hora prometida (25 pasos).
  - WhatsApp completo (todo bien).
- PDF de muestra revisados frente a los modelos del taller, y capturas a 390 y 1440 px de Reportes, Gastos y Configuración.

## Para activarlo en producción

1. Supabase → SQL Editor: pega y ejecuta la **parte 4** (`supabase/migrations/20261116000012_recibos_gastos_documentos.sql`).
2. EasyPanel → taller → **Implementar**.
3. En la app: Configuración → Datos del taller (correo y frase), Logo, y Reglas → «Seguir los recibos desde el número».
4. n8n: vuelve a importar `n8n/whatsapp-entrante.json` (reemplaza el anterior).
