# Agente de WhatsApp: qué pide la especificación y qué falta

Comparación de la especificación del agente (texto del usuario, 17/11/2026) con lo ya construido.
✅ hecho · 🟡 hecho en parte · ❌ falta.

## Ya funciona (probado con mensajes simulados, nunca con Meta real)
- ✅ Placa como llave: se normaliza (abc123 → ABC-123); sin placa el agente la pide.
- ✅ Lista blanca por celular y permisos por rol (con la sesión de la persona: RLS).
- ✅ Notas de voz (Whisper), texto, fotos y PDF de comprobantes (Claude con visión).
- ✅ Ingreso por voz: reutiliza cliente y carro si ya existen, abre la orden, hora prometida.
- ✅ Fotos del carro a la galería de la orden; avances y cambios de estado por voz.
- ✅ Almacén: foto + voz con placa → repuestos comprados cargados a esa orden (por confirmar).
- ✅ PDF por WhatsApp: proforma, orden de reparación, recibo.
- ✅ Comprobante de venta por foto (boleta/factura) con placa.
- ✅ Resúmenes de mediodía y cierre, entrega por vencer y atrasada, horarios configurables.
- ✅ Auditoría de cada mensaje: original, transcripción, intención, respuesta.

## Falta o difiere
1. ❌ Estados de la orden: hoy son En taller → En proceso → Espera repuesto → Listo → Entregado.
   Faltan En diagnóstico, Espera aprobación, Aprobado y Facturado.
2. 🟡 Confirmación: hoy el agente pregunta «¿Confirmo?» ANTES de guardar. La especificación pide
   guardar y luego permitir corregir («No, el kilometraje es 58 mil»).
3. ❌ Diagnóstico como campo propio de la orden (hoy va como avance).
4. ❌ Corrección de lo ya guardado por voz o texto.
5. ❌ Varias cosas en un mensaje («aprobó el cliente y ya pedí los repuestos»).
6. ❌ Varias fotos seguidas sin texto: agruparlas y preguntar la placa una sola vez.
7. 🟡 Fotos: falta etiqueta automática (ingreso / daño / tablero / trabajo / salida) y leer el kilometraje del tablero.
8. ❌ Almacén: vale de SALIDA del inventario por foto (hoy solo compras al proveedor);
   tomar costo y precio del catálogo y preguntar el costo si el repuesto es nuevo.
9. ❌ Al llegar a «Listo», enviar a caja el resumen para facturar.
10. ❌ Comparar el monto del comprobante con el total de la orden y avisar si no cuadra.
11. ❌ Alertas por WhatsApp: carro sin movimiento, esperando aprobación más de X horas,
    listo sin facturar, repuesto sin costo, comprobante que no cuadra.
12. ❌ PDF del historial del carro y resumen para facturar.
13. 🟡 Respuesta de la IA con «nivel de confianza».
14. ❌ Conexión real: número de Meta, llaves de IA, flujos de n8n importados y prueba con mensajes reales.
