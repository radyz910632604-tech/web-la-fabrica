# Fase 0 — Plan de Taller Control

> **Estado:** aprobado. El usuario respondió «Sí», tomado como aceptación de todas las recomendaciones de la sección 2. La Fase 1 está en curso: ver [Entrega 1A](fase-1a-entrega.md).

---

## 1. Lo que entendí, en pocas palabras

- Una app para el personal del taller (celular y computadora, se instala como app) y un número de WhatsApp. Las dos guardan en la **misma base de datos**.
- Por WhatsApp el personal manda un audio, una foto o un texto ("entró la placa ABC-123, cambio de aceite, cliente Juan"). La IA lo entiende, el sistema responde con un resumen y **nada se guarda hasta que la persona toca "Confirmar"**.
- Cada persona ve solo lo que su rol permite, y eso lo hace cumplir la **base de datos**, no solo la pantalla.
- Dos o más talleres en el mismo sistema; gerencia ve cada uno y el total.
- El dinero nunca se borra (se anula con motivo) y la utilidad siempre se calcula **sin IGV**.

```
 Celular / PC ─────► App Taller Control (Next.js, se instala) ─────┐
                                                                   ├──► Supabase
 WhatsApp ──► Meta ──► n8n ──► API interna de la app ──────────────┘   (datos, login, fotos)
                        │
                        └──► IA: OpenAI (audios) · Claude (fotos y PDF)
```

---

## 2. Preguntas antes de seguir

Para cada una te dejo mi recomendación. Si estás de acuerdo con todas, basta con que respondas **"acepto tus recomendaciones"** y me digas lo que quieras cambiar.

### A. Bloquean la Fase 1

| # | Pregunta | Mi recomendación |
|---|---|---|
| 1 | **¿Dónde guardamos el proyecto?** Esta sesión solo tiene acceso al repositorio `web-la-fabrica`, que es la web del gimnasio y además es **público** (cualquiera en internet puede leerlo). | Crear un repositorio nuevo **privado** llamado `taller-control` en GitHub (vacío, sin README). Me avisas y lo conecto. Mientras tanto, guardé el plan solo en esta sesión y **no lo subí** al repositorio público. |
| 2 | **¿Dónde corre Supabase?** (a) En la nube de Supabase: gratis para desarrollar; para usarlo de verdad, plan Pro (aprox. US$ 25 al mes, verifica el precio actual). (b) Instalado en tu VPS con EasyPanel: sin pago extra, pero los respaldos y actualizaciones quedan a tu cargo y necesita bastante memoria del VPS. | (a) para desarrollar ahora (gratis). Decidimos producción al final de la Fase 1, cuando sepamos cuánto espacio usan las fotos. |
| 3 | **¿Los dos talleres comparten clientes?** | **No**: cada taller tiene su lista. Si un cliente va a los dos, aparece en ambos. El reporte conjunto de gerencia suma igual. Es más simple y más seguro. |
| 4 | **¿Cómo entra el personal a la app?** | Con **celular y contraseña** (la crea el administrador). Gratis y sin correo. La alternativa, código por WhatsApp, cuesta por cada mensaje. |
| 5 | **¿Un solo técnico por orden?** La especificación dice "técnico asignado". ¿A veces trabajan dos en el mismo carro? | Un técnico **responsable** por orden. Si luego hace falta, agregamos ayudantes y reparto de mano de obra. |
| 6 | **¿Qué placas atienden?** ¿Motos, placas antiguas, carros de otro país? | Validar el formato actual (ABC-123, también con números como A1B-234). Si llega otro formato, el sistema pregunta "¿la placa es correcta?" en vez de rechazarla. |
| 7 | **Plazo de garantía** para marcar "reingreso por garantía". | 90 días por defecto, y cada servicio puede tener su propio plazo. |
| 8 | **Citas:** tolerancia para marcar "no llegó" y hora de cierre del taller. | 30 minutos de tolerancia; cierre a las 7:00 p. m. Las dos se cambian en configuración. |
| 9 | **Agregar el estado `cancelada` a las citas** (el cliente avisó que no viene). No está en la especificación. | Sí: así el reporte separa "no llegó sin avisar" de "canceló". |
| 10 | **Fase 1 es grande. ¿La dividimos en dos entregas?** | Sí. **1A:** diseño, login, empresas, usuarios, roles y panel. **1B:** clientes, vehículos, órdenes con fotos, citas y app instalable. Así ves y apruebas el diseño temprano. |

### B. Conviene empezar ya (para la Fase 2)

| # | Pregunta | Mi recomendación |
|---|---|---|
| 11 | **¿Tienes el negocio verificado en Meta (Business Manager) y un número para WhatsApp?** La verificación puede tardar días. | Un **número dedicado** (un chip nuevo) que no se use en el WhatsApp normal. Empieza la verificación del negocio en Meta desde ya. |
| 12 | **¿Tu VPS de Hostinger qué plan es (memoria)?** Ahí vivirán n8n y la app. | Me dices el plan y te confirmo si alcanza. |

### C. Pueden esperar (Fase 3 en adelante)

| # | Pregunta | Mi recomendación |
|---|---|---|
| 13 | Confirmo que **el sistema no emite** boletas ni facturas electrónicas: registra las que ya emiten con su sistema actual. ¿Con qué sistema facturan? Si puede descargar el XML, lo leemos directo sin IA. | Solo registrar, como dice la especificación. |
| 14 | Para un monto leído por IA, ¿basta con que la persona que lo envió toque "Confirmar"? ¿O lo debe aprobar otra persona (gerencia o asesor)? | Las compras las confirma quien las envía y gerencia las ve marcadas como "leídas por IA". Si quieres más control, se agrega una segunda aprobación. |
| 15 | ¿El **asesor** puede ver lo que costaron las compras? Si lo ve, puede calcular un margen aproximado. | Sí puede ver costos de repuestos (los necesita para cotizar), pero no la mano de obra ni la utilidad. |
| 16 | ¿Cada persona ve **sus propias comisiones**? | Sí, solo las suyas. |
| 17 | ¿Compran repuestos en **dólares**? | Permitir dólares con tipo de cambio; la utilidad se calcula en soles. |
| 18 | **Prorrateo de mano de obra:** dividir el costo mensual del técnico entre las órdenes que entregó ese mes. | Así de simple al inicio. |
| 19 | La **meta de ventas** del mes, ¿es sin IGV? | Sin IGV, igual que la utilidad. |
| 20 | ¿El nombre "Taller Control" y un logo propio simple están bien por ahora? | Sí; se cambian en un solo lugar cuando tengan el nombre definitivo. |

---

## 3. Decisiones técnicas que propongo

Son puntos donde la especificación deja espacio. No cambian la tecnología elegida.

1. **Una sola puerta para los permisos.** Las acciones importantes (cambiar estado, confirmar cita, anular un pago) son funciones dentro de la base de datos que revisan el rol. La app y WhatsApp usan las mismas funciones.
2. **n8n actúa en nombre de la persona.** La API interna recibe la clave secreta de n8n y el celular de quien escribió; luego actúa con los permisos de esa persona. Un técnico no puede registrar un pago ni siquiera por WhatsApp.
3. **"Confirmar / Corregir" con una tabla de espera** (`acciones_pendientes`). Lo que entendió la IA espera ahí; recién al confirmar se crean los registros reales. Si nadie confirma en 24 horas, se descarta.
4. **La IA vive en n8n**, como pide la especificación (prompts en archivos de texto en `/n8n/prompts`). Cuando alguien sube la foto de un comprobante desde la app, la app le pide la lectura al mismo flujo de n8n. Un solo lugar para los prompts y para cambiar de proveedor.
5. **El dinero no está en la orden.** La orden de trabajo no tiene precios; los montos viven en cotizaciones, comprobantes y pagos. Así es fácil que el técnico vea la orden sin ver dinero.
6. **Compras asignadas por línea.** Una factura del proveedor suele traer repuestos para varios carros: cada línea se asigna a una orden o a stock.
7. **Fotos reducidas en el celular y videos convertidos en el servidor** (720p, máximo 60 segundos), para ahorrar datos y espacio.
8. **El reloj de las tareas programadas es n8n** (citas que no llegaron, resúmenes, alertas). La lógica está en la app; n8n solo la dispara a la hora indicada.
9. **Diseño:** la imagen que mandaste es la referencia de estilo (distribución, pestañas en píldora, tarjetas, gráfico de barras). El nombre, el logo y los textos son propios.
10. **Windows:** yo trabajo en un entorno en la nube, pero todo se manejará con comandos `npm run …`, que funcionan igual en Windows y en Warp. Nada que dependa de Linux.

---

## 4. Estructura de carpetas

```
taller-control/
├─ ESPECIFICACION.md          la especificación original
├─ README.md                  cómo instalar y correr (en español, comandos de Windows)
├─ .env.example               todas las variables, explicadas, sin valores reales
├─ Dockerfile                 para EasyPanel
├─ package.json
├─ public/
│  ├─ manifest.webmanifest    para que se instale como app
│  └─ iconos/
├─ src/
│  ├─ app/
│  │  ├─ ingresar/            login
│  │  ├─ (panel)/             todo lo que está detrás del login
│  │  │  ├─ page.tsx          panel principal
│  │  │  ├─ ordenes/          lista, nuevo ingreso, detalle con fotos y avances
│  │  │  ├─ vehiculos/        historial por placa
│  │  │  ├─ clientes/
│  │  │  ├─ citas/
│  │  │  ├─ compras/  ventas/  cobros/  cierre/  alertas/   (Fases 3 y 4)
│  │  │  ├─ reportes/         (Fase 5)
│  │  │  └─ configuracion/    empresas, usuarios, roles, servicios, metas
│  │  └─ api/interno/         la API que solo n8n puede llamar
│  ├─ components/
│  │  ├─ ui/                  piezas base (shadcn/ui)
│  │  └─ panel/  graficos/  tablas/  formularios/
│  └─ lib/
│     ├─ supabase/            conexión a la base de datos
│     ├─ dinero/              IGV, utilidad, comisiones, cierre (con pruebas)
│     ├─ placas.ts  celulares.ts  fechas.ts (hora de Lima)
│     └─ permisos.ts
├─ supabase/
│  ├─ migrations/             los cambios de la base de datos, numerados
│  ├─ seed.sql                datos de ejemplo ficticios
│  └─ tests/                  pruebas de permisos por rol
├─ n8n/
│  ├─ README.md               cómo importar y qué credenciales configurar
│  ├─ flujos/                 los flujos en JSON
│  ├─ prompts/                instrucciones para la IA, una por archivo
│  └─ plantillas-whatsapp.md  mensajes que Meta debe aprobar
├─ tests/                     pruebas de cálculos y pantallas
├─ scripts/                   respaldo de la base de datos
└─ docs/
   ├─ fase-0-plan.md          este documento
   ├─ modelo-de-datos.md
   ├─ despliegue-easypanel.md
   ├─ restaurar-respaldo.md
   └─ guias-por-rol/          una hoja por rol
```

---

## 5. Modelo de datos

Está completo en **[modelo-de-datos.md](modelo-de-datos.md)**: 40 tablas agrupadas por módulo, las fórmulas de dinero, los permisos por rol en una tabla y las tareas automáticas.

Lo más importante para revisar:
- **Sección 6, permisos por rol:** confirma que cada rol ve lo que debe.
- **Sección 4, fórmulas:** utilidad, saldo y mano de obra.

---

## 6. Plan de la Fase 1 (cuando apruebes)

### Entrega 1A — Diseño, acceso y panel
1. Crear el proyecto (Next.js, TypeScript, Tailwind, shadcn/ui) con pruebas automáticas listas.
2. Sistema de diseño: colores, tipografía Inter, tarjetas, botones píldora, modo claro y oscuro, logo "Taller Control".
3. Navegación: pestañas arriba y barra de íconos al costado en computadora; barra inferior en celular.
4. Base de datos: empresas, perfiles, miembros, roles, configuración y auditoría, con RLS.
5. Login con celular y contraseña, elegir taller, pantalla de usuarios y roles para el administrador.
6. Panel principal con el saludo, "Carros en taller hoy", los 4 indicadores, el gráfico, la meta y "Actividad reciente". Los montos de dinero se llenan con datos reales desde la Fase 3; mientras tanto se ven con los datos de ejemplo.
7. Pruebas de permisos por rol y capturas en celular (390 px) y computadora (1440 px).

### Entrega 1B — Taller
8. Clientes y vehículos, con validación de placa y celular.
9. Nuevo ingreso en pocos toques: placa → cliente → servicios → fotos.
10. Orden de trabajo: estados, historial, avances, fotos y videos.
11. Historial completo por placa y marca de reingreso por garantía.
12. Citas de redes: agendar, confirmar, unión automática con el ingreso, "no llegó".
13. App instalable (PWA): ícono, pantalla completa.
14. Datos de ejemplo ficticios, README de instalación en Windows y borrador de la guía de EasyPanel.

### Cómo vas a probarlo
- Te dejaré la app publicada en una dirección de prueba (en tu EasyPanel o en un servicio gratuito, lo vemos contigo) con usuarios de ejemplo, uno por rol. Entras con cada uno y compruebas que cada rol ve lo que debe.
- Te daré una lista corta de cosas para probar en tu celular: instalar la app, registrar un ingreso con foto, cambiar el estado.

---

## 7. Costos a tener en cuenta

No decido ninguno sin tu aprobación. Los precios son aproximados: verifícalos antes de contratar.

| Qué | Costo | Cuándo |
|---|---|---|
| Supabase | Gratis para desarrollar. Plan Pro aprox. US$ 25/mes para usarlo en serio (más espacio para fotos y respaldos diarios). O US$ 0 extra si va en tu VPS. | Al pasar a uso real |
| VPS Hostinger + EasyPanel + n8n | Ya lo tienes | — |
| WhatsApp Cloud API | Responder a quien te escribió dentro de 24 horas es gratis. Los mensajes que inicia el taller (aviso de carro listo, recordatorios, resumen a alguien que no escribió ese día) usan plantillas aprobadas por Meta y **se cobran por mensaje**. Por eso cada aviso tendrá su interruptor push / WhatsApp. | Fase 2 |
| IA | Se cobra por uso: por minuto de audio (OpenAI) y por imagen o PDF leído (Claude). Son centavos por mensaje. Pondremos un tope mensual de gasto en cada proveedor. | Fase 2 |
| Avisos push de la app | Gratis | Fase 2 |
| Dominio propio (ej. `taller.tunegocio.pe`) | Opcional | Al publicar |

---

## 8. Riesgos y cómo los cubrimos

| Riesgo | Cómo lo cubrimos |
|---|---|
| El repositorio actual es público | Proyecto en un repositorio privado (pregunta 1). Nunca claves ni datos reales en el código. |
| La IA entiende mal un audio o un monto | Todo pasa por "Confirmar". Los montos leídos por IA quedan "por confirmar" y se marcan así en los reportes. |
| Alguien escribe al WhatsApp con instrucciones raras ("borra todo") | La IA solo extrae datos; las acciones posibles son una lista cerrada y la app revisa el rol en cada una. |
| Las fotos y videos llenan el espacio | Se reducen al subir; un reporte mostrará cuánto espacio se usa. |
| Meta tarda en aprobar el número o las plantillas | Empezar la verificación ya (pregunta 11). La app funciona sin WhatsApp mientras tanto. |
| Datos personales de clientes (celular, DNI) | Acceso por rol, registro de consentimiento con fecha. Te recomiendo consultar si debes inscribir tu banco de datos de clientes según la Ley 29733 de Protección de Datos Personales. |
| Perder la base de datos | Script de respaldo y guía para restaurar (requisito de la especificación). |

---

## 9. Qué necesito de ti

1. Responder las preguntas de la sección 2 (con "acepto tus recomendaciones" basta para las que estés de acuerdo).
2. Revisar los permisos por rol en el [modelo de datos](modelo-de-datos.md#6-permisos-por-rol).
3. Crear el repositorio privado `taller-control` en GitHub (o decirme que use otro lugar).
4. Darme el visto bueno para empezar la **Entrega 1A**.
