# Centro de Alto Rendimiento La Fábrica

Landing page (HTML, CSS y JS puros) del centro de entrenamiento de fútbol La Fábrica, Villa María del Triunfo, Lima Sur.
Todo está en `index.html`; no necesita instalar nada.

## Pendientes (necesitan datos del dueño)

En `index.html` cada punto está marcado con un comentario `PENDIENTE` (búscalo con Ctrl + F).

- [ ] **Precio de la Categoría Libre** (sección Planes).
- [ ] **Plan para las categorías que entrenan 2 días por semana** (2017 y Sub-14 a 20 años): hoy la web les dice que escriban por WhatsApp.
- [ ] **Confirmar "Niños formativos"** (sábados y domingos): la web lo ofrece como opción para los que recién empiezan.
- [ ] **Credenciales del coach** (licencia, años de experiencia, trayectoria): plantilla lista en la sección Nosotros.
- [ ] **Testimonios de padres o jugadores** (2 o 3, con su permiso): plantilla lista antes de la sección Ubicación.
- [ ] **Formas de pago** (Yape, Plin, transferencia, efectivo…): pregunta frecuente "¿Cómo se paga?".
- [ ] **Qué deben llevar a la clase**: pregunta frecuente con un texto general; confirmar.
- [ ] **Frase de Wynslow "Q" Reeves** sobre su experiencia (sección Historia).
- [ ] **Nombre exacto de la página de Facebook** (pie de página).
- [ ] **Permiso de los padres** para usar las fotos de los menores.

## Al publicar con un dominio propio (por ejemplo, Hostinger)

1. Sube **todos** los archivos y carpetas (`index.html`, `img/`, `fonts/`, `favicon.png`, `apple-touch-icon.png`, `robots.txt`, `sitemap.xml`).
2. Si cambias de dominio, reemplaza `https://lafabrica-juankencino.netlify.app/` por el nuevo en:
   - `index.html` (vista previa al compartir y "Datos del negocio para Google"),
   - `robots.txt`,
   - `sitemap.xml`.
3. Crea tu **Perfil de Empresa en Google** (Google Maps) con la misma dirección y el mismo teléfono.
4. Consulta con tu contador si necesitas un **Libro de Reclamaciones virtual**.

## Medir cuántos escriben por WhatsApp (opcional)

Pega el código de **Google Analytics 4** o del **Pixel de Meta** en `index.html`, donde dice `MEDICIÓN`.
La web ya registra sola cada clic en WhatsApp: evento `whatsapp_click` en Analytics y `Contact` en el Pixel,
con la sección desde donde escribieron (`ubicacion`).

## Fotos (carpeta `img/`)

Para cambiar una foto, reemplaza el archivo con **exactamente** el mismo nombre:

| Archivo | Dónde se usa | Tamaño recomendado |
|---|---|---|
| `img/hero.jpg` | Portada | 1600 × 1200 px |
| `img/coach.jpg` | Nosotros (Coach Juan Kenciño) | vertical, 900 × 1600 px |
| `img/equipo-adultos.jpg`, `img/campeones-1.jpg`, `img/equipo.jpg`, `img/campeones-3.jpg` | Tarjetas de "Entrenamiento integral" (ver `GUIA-DE-FOTOS.md`) | 4:3, 900 × 675 px |
| `img/historia.jpg` | Historia de Wynslow "Q" Reeves | vertical |
| `img/tiktok-juan.jpg`, `img/tiktok-q.jpg`, `img/tiktok-perfil.jpg` | Miniaturas de los videos de TikTok | 270 × 480 px |
| `img/compartir.jpg` | Imagen que aparece al compartir el enlace por WhatsApp o redes | 1200 × 630 px |
| `img/logo.png` | Escudo original | — |
| `img/logo-96.png` y `img/logo-96.webp` | Escudo pequeño del menú y del pie de página | 96 × 96 px |

Usa JPG y guárdalos livianos (idealmente menos de 300 KB cada uno).

### Imágenes con versión `.webp`

Muchas imágenes tienen dos versiones: `.png` o `.jpg` y `.webp` (más liviana, la que usan los celulares modernos).

- **Íconos 3D de las secciones** (`img/iconos/pilar-*`, `plan-*`, `loc-*`, `avion`, `saludo`) y el escudo pequeño:
  si cambias el `.png`, borra el `.webp` del mismo nombre y la web usará el `.png` sola.
- **Animaciones de Juan** (`img/iconos/funko-*`), **imágenes del mini juego** (`juan-corre`, `juan-poder`, `juan-copa`,
  `juan-pixel`, `gato`, `chocolate`) y **fondo del CTA final** (`img/cta-fondo*`): reemplaza **las dos** versiones.

## WhatsApp

El número y el mensaje general están al inicio del `<script>` (`WA_NUMBER` y `WA_MESSAGE`).
Cada botón tiene su propio mensaje en su enlace `https://wa.me/51917168725?text=...`.

## Horarios

Cada fila de la tabla lleva en `data-cat` sus categorías (para el filtro) y cada tarjeta lleva en `data-days` sus días.
Si cambias un horario, actualiza también esos datos (hay un comentario `HORARIOS` que lo explica).

## Créditos

- Íconos 3D de [Microsoft Fluent Emoji](https://github.com/microsoft/fluentui-emoji) (licencia MIT).
- Fuentes [Bebas Neue](https://github.com/dharmatype/Bebas-Neue) e [Inter](https://rsms.me/inter/) (licencia SIL Open Font License 1.1, ver `fonts/`).
