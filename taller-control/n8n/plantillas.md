# Plantillas de WhatsApp para Meta

Cuando el **taller** escribe primero (no responde a un mensaje de las últimas 24 horas), WhatsApp exige una **plantilla aprobada por Meta**. Cada conversación que abre una plantilla **se cobra**. Las respuestas a lo que escribe el personal (dentro de 24 horas) no necesitan plantilla.

Créalas en **Meta Business Suite → WhatsApp Manager → Plantillas de mensajes → Crear plantilla**, con el **nombre exacto** de la columna «Nombre», idioma **Español (es)** y el texto tal cual (las `{{1}}`, `{{2}}`… son las variables que llena la app, en ese orden).

| Nombre | Categoría sugerida | Texto | Botones de respuesta rápida |
| --- | --- | --- | --- |
| `carro_listo` | Utilidad | Hola {{1}}, tu carro de placa {{2}} ya está listo en {{3}}. Te esperamos. | — |
| `cotizacion` | Utilidad | Hola {{1}}, la cotización para tu carro {{2}} es de {{3}} con IGV: {{4}}. ¿La apruebas? | `Apruebo` · `No, gracias` |
| `encuesta` | Utilidad o Marketing (lo decide Meta) | Hola {{1}}, gracias por confiar en {{2}}. ¿Cómo calificas el servicio a tu carro {{3}}? | `Muy bien` · `Regular` · `Mal` |
| `recordatorio_mantenimiento` | Marketing | Hola {{1}}, ya toca {{2}} para tu carro {{3}} (la última vez fue el {{4}}). Escríbenos para separar tu cita en {{5}}. | — |
| `aviso_personal` | Utilidad | Hola {{1}}. {{2}} | — |

Notas:

- Los botones deben quedar **en ese orden**: la app sabe qué botón tocó el cliente por su posición (Apruebo = primero).
- `aviso_personal` lleva los resúmenes del día, las citas del día y las citas sin llegada al **personal**, solo si en Configuración → Avisos eliges WhatsApp para esos avisos. Si los dejas en «Aviso en el celular», no se usa (y no cuesta).
- Meta puede tardar de minutos a un día en aprobar. Mientras una plantilla no esté aprobada, ese aviso queda «Falló» en **WhatsApp y avisos** y se reintenta hasta 3 veces.
- Al cliente **solo** se le escribe si en su ficha dice que acepta recibir mensajes.

## Ejemplos para la revisión de Meta

Meta pide un ejemplo de cada variable:

- `carro_listo`: Ana · ABC123 · Taller Norte
- `cotizacion`: Ana · ABC-123 · S/ 180.00 · Cambio de pastillas delanteras, mano de obra
- `encuesta`: Ana · Taller Norte · ABC-123
- `recordatorio_mantenimiento`: Ana · cambio de aceite y filtro · ABC-123 · 16/08/2026, o al llegar a 85 000 km · Taller Norte
- `aviso_personal`: Rosa · Resumen del mediodía · Taller Norte: En taller 8 · Listos 3 · Entregados hoy 5.
