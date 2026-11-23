# Idea (no aprobada): conectar el sistema con las redes sociales

Estado: **solo idea**, para decidir más adelante. No se construye sin que el usuario lo pida.
Anotada el 23/11/2026.

## Qué se quiere
Facebook, Instagram, WhatsApp, TikTok y YouTube conectados al sistema para:
- Responder mensajes y comentarios desde un solo lugar.
- Medir el progreso: mensajes → citas → carros → ventas por red (el sistema ya guarda la red de origen de cada cita).
- Si se puede, publicar posts, reels e historias.

## Qué permite cada red (revisar de nuevo antes de construir: las reglas cambian)
| Red | Mensajes | Comentarios | Publicar | Medir |
|---|---|---|---|---|
| WhatsApp | Sí (ya está) | — | No (estados) | Sí |
| Facebook (página) | Sí | Sí | Posts, reels, historias | Sí |
| Instagram (empresa) | Sí | Sí | Posts, carruseles, reels, historias | Sí |
| YouTube | No existen | Sí | Videos y Shorts | Sí |
| TikTok | Muy limitado | Limitado | Sí, tras aprobación de TikTok | Sí |

## Conexiones oficiales
- Meta for Developers (developers.facebook.com): Graph API, Messenger, Instagram Messaging, WhatsApp Cloud API. Una sola app de Meta para las tres.
- Google Cloud (console.cloud.google.com): YouTube Data API y YouTube Analytics API.
- TikTok for Developers (developers.tiktok.com): Content Posting API y Display API.
- Se puede pasar por n8n (ya instalado en EasyPanel).

## Costos
Conexiones gratis. WhatsApp: responder dentro de 24 h es gratis; los mensajes que inicia el sistema cuestan centavos (Meta).
YouTube: cuota diaria gratuita (unos 6 videos por día).
Alternativas pagadas que no se unen con las ventas: Metricool, Hootsuite. Gratis de Meta: Business Suite.

## Riesgos
Aprobaciones de Meta/TikTok/Google (1 a 3 semanas, pueden rechazar), conexiones que vencen (avisar en Estado del sistema),
cambios de reglas, calidad del número de WhatsApp si hay mensajes masivos.

## Orden sugerido (si se aprueba)
1. Terminar el WhatsApp del taller (crea la app de Meta).
2. Bandeja única de Facebook e Instagram unida a citas y ventas.
3. Publicar en Facebook e Instagram con calendario.
4. YouTube.
5. TikTok al final.
