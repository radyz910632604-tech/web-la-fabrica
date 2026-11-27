# Fase 1 · Entrega 1B — El taller

> **Estado:** lista para revisar. Con esta entrega se completa la Fase 1 de la especificación (falta solo publicarla en tu EasyPanel).
> La pediste directamente («avanza solo»), así que la hice sin esperar la aprobación de la 1A.

## Qué hay nuevo

| Pantalla | Qué hace | Quién la ve |
|---|---|---|
| **Nuevo ingreso** | Escribes la placa; si el carro ya vino, se completan solos el carro y el dueño. Tocas los servicios, anotas observaciones, eliges técnico y tomas fotos con la cámara (se reducen en el celular antes de subir). | Gerencia, administración, asesor |
| **Órdenes** | Todas las órdenes por estado (en el taller, en proceso, espera repuesto, listo, entregado), con buscador. | Gerencia, administración, asesor, almacén (sin datos del cliente) |
| **Orden** | Cambiar estado con un toque (y nota opcional), asignar técnico, agregar trabajos adicionales, fotos, avances e historial de estados. Marca **Garantía** si el carro volvió por el mismo servicio dentro del plazo. | Quien puede verla; el técnico solo las suyas y nunca marca la entrega |
| **Mis trabajos** | Los carros asignados al técnico. | Técnico |
| **Clientes** | Lista con buscador (nombre, celular o placa), filtro de **inactivos** (sin visita hace N días), ficha con sus carros y visitas, crear y editar. | Gerencia, administración, asesor, ventas por redes, confirmación |
| **Historial por placa** | Todas las visitas de un carro, con reingresos por garantía. | Según su rol |
| **Citas** | Día por día. Agendar, confirmar, reagendar, cancelar y «Llegó: registrar» (abre el ingreso con los datos de la cita). Si pasa la hora más la tolerancia sin ingreso, queda «No llegó». Reporte de asistencia por vendedor y por campaña (30 días). | Gerencia, administración, asesor, confirmación; ventas por redes ve solo las suyas |
| **Buscar** | Placa, nombre, celular o número de orden, desde la lupa de arriba. | Todos, según su rol |
| **Ayuda** | Una hoja por rol con los pasos de su trabajo. | Todos |
| **Configuración → Servicios del taller** | La lista de servicios que aparece al registrar un ingreso, con su propio plazo de garantía. Cada taller nuevo empieza con 12 servicios típicos. | Gerencia, administración |
| **App instalable** | Ícono, nombre «Taller», pantalla completa y aviso cuando no hay conexión. En iPhone: Safari → Compartir → «Agregar a inicio». | Todos |

**El panel ahora es real:** carros en el taller, listos, esperando repuesto, actividad reciente, mis trabajos, citas de hoy y carros entregados del mes. Los **montos** (ventas, compras, utilidad, lo vendido de la meta) siguen siendo de ejemplo y lo dice cada tarjeta con la marca «Ejemplo»: se vuelven reales en la Fase 3.

## Cómo probarlo

Con la base local o un proyecto de pruebas (ver el [README](../README.md)), corre `npm run datos:ejemplo`: crea en el Taller Norte 14 carros en el taller, 46 entregas de las últimas semanas y citas de hoy y de los últimos 30 días, todo ficticio.

1. **Asesor (900 000 003):** «Nuevo ingreso», escribe `BKR-472` y mira cómo se completa solo. Prueba con una placa nueva, elige un servicio, toma una foto y registra. En la orden toca «Empezar trabajo».
2. **Técnico (900 000 004):** «Mis trabajos», abre un carro, márcalo listo y escribe un avance. Comprueba que no ve el cliente ni el botón de entregar.
3. **Confirmación (900 000 007):** «Citas», toca «Confirmar» en una cita.
4. **Ventas por redes (900 000 006):** agenda una cita y verifica que solo ves las tuyas.
5. **Gerencia (900 000 001):** busca `AXM` con la lupa, abre un cliente y su historial.

## Pruebas automáticas (todas pasan)

- `npm test`: **55 pruebas** (se agregaron las de numeración de órdenes, pasos de estado y que la navegación ya no lleve a «Próximamente»).
- `npm run test:db`: **59 pruebas** de permisos. Las nuevas cubren: numeración correlativa, unión automática de la cita con el ingreso, historial con nota, kilometraje, que el técnico solo ve y cambia lo suyo y no entrega, que almacén no ve clientes ni registra ingresos, que ventas por redes ve solo sus citas, que confirmación solo confirma, «no llegó» automático, reingreso por garantía y separación entre talleres.
- Pruebas en el navegador de punta a punta: ingreso con placa conocida y nueva, foto subida y visible, cambio de estado con nota, avance del técnico, confirmación de cita, cita agendada por ventas, ficha de cliente, historial por placa, buscador.
- Capturas en celular (390 px) y computadora (1440 px) de cada pantalla nueva: sin desbordes.

Las pruebas encontraron y corrigieron un error real: al crear un carro u orden, la base no dejaba leer de vuelta la fila recién creada. Se corrigió la regla de permisos y se agregaron pruebas que lo cubren.

## Decisiones que tomé

1. **Ventas por redes y confirmación ven la lista de clientes del taller** (nombre y celular). Los necesitan para agendar y llamar. Ventas por redes sigue viendo solo sus propias citas.
2. **La campaña de una cita se escribe** (texto libre). En la Fase 5, con los reportes, puede volverse una lista fija.
3. **La entrega al cliente solo la marca quien atiende al cliente** (asesor, administración, gerencia). El técnico llega hasta «Listo».
4. **Los trabajos adicionales se anotan ya**, marcados como «Adicional». La aprobación del cliente por WhatsApp llega en la Fase 4.
5. **«No llegó» se marca al abrir Citas.** En la Fase 2, n8n lo hará cada 10 minutos y avisará al vendedor.
6. **Solo fotos por ahora.** Los videos (convertidos a 720p en el servidor) quedan para después, porque necesitan ffmpeg en el VPS.

## Lo que sigue

- **Publicar en tu EasyPanel** para usarla desde tu celular con datos reales (necesito tu proyecto de Supabase y acceso a EasyPanel).
- **Fase 2:** WhatsApp con n8n (ingresos y avances por audio y foto, resúmenes diarios).
- **Fase 3:** compras, comprobantes, utilidad real, comisiones, cierre diario y alertas.
