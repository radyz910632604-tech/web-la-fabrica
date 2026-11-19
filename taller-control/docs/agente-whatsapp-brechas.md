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

## Hecho el 17/11/2026 (probado con mensajes simulados)
1. ✅ Estados: Ingresado → En diagnóstico → Espera aprobación → Aprobado → En reparación → Espera repuestos → Listo → Entregado.
   «Facturado» lo marca la base (`ordenes_trabajo.facturado_en`) al tener boleta, factura o recibo vigente (migraciones 0014 y 0015).
2. ✅ Guardar y avisar: ingreso, avances, fotos, repuestos, compras, comprobantes y citas se guardan al toque y se responde el resumen.
   Pagos y cotizaciones siguen con «Confirmar». Lo leído por IA con dinero igual queda «por confirmar» en la app.
3. ✅ Diagnóstico como campo de la orden (`registrar_diagnostico`), en pantalla, en el PDF y por voz.
4. ✅ Corrección por voz o texto de lo último guardado («No, el kilometraje es 58 mil»).
5. ✅ Varias cosas en un mensaje (diagnóstico + estado + avance).
6. ✅ Fotos seguidas sin texto: se juntan y se pregunta la placa una sola vez.
7. ✅ Etiqueta de cada foto (ingreso, daño, tablero, trabajo, salida, repuestos) y kilometraje leído del tablero.
8. ✅ Almacén por foto del vale o nota de voz: salida del inventario con su costo; repuesto nuevo → pregunta el costo → compra por confirmar.
9. ✅ Resumen para facturar a caja al quedar «Listo».
10. ✅ Cuadre del comprobante con lo aprobado (al recibirlo por WhatsApp y en el ciclo de avisos).
11. ✅ Alertas configurables: sin movimiento, espera aprobación, listo sin facturar, comprobante que no cuadra, repuesto sin costo.
12. ✅ PDF del historial del carro y resumen para facturar (app y WhatsApp).
13. ✅ Campo «confianza» en lo que devuelve la IA.

## Falta
14. ❌ Conexión real: número de Meta, llaves de IA (OpenAI para voz, Claude para fotos), flujos de n8n importados y prueba con mensajes reales.
