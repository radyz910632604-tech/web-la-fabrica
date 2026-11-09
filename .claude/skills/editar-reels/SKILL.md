---
name: editar-reels
description: Edición de reels y TikToks verticales para La Fábrica (Centro de Alto Rendimiento de Fútbol) con Python, ffmpeg y gráficos en HTML. Úsala cuando el usuario quiera editar un vídeo, reel o TikTok, crear subtítulos, motion graphics, portada, música o efectos para redes, o revisar un vídeo antes de publicarlo.
---

# Editar reels · La Fábrica

Método de edición en 5 pasadas, con vista previa y aprobación en cada una.
Estilo de marca: ver `Reglas-de-estilo.md` (en esta misma carpeta). Si una
instrucción del usuario choca con la guía, pregunta cuál manda.

## Formato de salida (fijo)
- 1080×1920, 30 fps, H.264 + AAC 48 kHz.
- Zona segura de Instagram/TikTok: nada importante en los **220 px de arriba**,
  los **380 px de abajo** ni los **140 px de la derecha**.
- Audio master: **−14 LUFS integrados**, pico real **< −1 dBTP** (medir con
  `ffmpeg -af loudnorm=print_format=json` o `ebur128`).
- Entregar también una portada PNG 1080×1920 con una palabra grande legible en miniatura.

## Cómo trabajar
- Todo en código: Python + ffmpeg para vídeo y audio; HTML/CSS/JS para los
  gráficos, renderizados fotograma a fotograma (Playwright está instalado).
- Carpeta de proyecto con cada pieza separada (transcripción, mate, capas,
  renders) para que rehacer una pasada no rompa las demás.
- Al terminar cada pasada: renderiza una vista previa MP4 y **espera notas**.
  No pases a la siguiente hasta que el usuario diga «siguiente».
- Pide permiso antes de instalar o borrar nada. Nunca modifiques los
  archivos originales del usuario: trabaja sobre copias.

## Las 5 pasadas (siempre en este orden)

### 1. Transcribir y cortar
- **A (sin cortar):** Whisper con tiempos por palabra → `words.json`
  (`inicio`/`fin` en segundos). Muestra una tabla (n.º, palabra, inicio, fin)
  para corregir nombres y términos de fútbol. Lista pausas > 0,4 s,
  tartamudeos y tomas repetidas. Espera correcciones.
- **B (cortar):** aplica correcciones, corta pausas > 0,4 s y tomas repetidas
  (quédate con la última buena), deja ~0,1 s de respiración a cada lado.
  Recalcula `words.json` y di duración antes/después.

### 2. Recortar a la persona del fondo
- Modelo de matting de vídeo (RobustVideoMatting o similar); guarda el mate
  como secuencia aparte para reutilizarlo.
- Bordes suaves, luz de borde ligera. Sin contorno blanco ni brillo. Sin
  agujeros en cuerpo/manos; conservar el pelo.
- Pruebas de 3 s: sobre tablero de ajedrez y sobre el fondo de la guía con
  una palabra grande detrás de la cabeza.

### 3. Subtítulos
- 1–3 palabras a la vez; cada palabra aparece cuando se dice.
- Una palabra clave por frase en grande (estilo de palabra clave); el resto pequeño.
- Mínimo 0,4 s en pantalla cada uno. A la altura del pecho, nunca sobre la
  cara, dentro de la zona segura.
- Antes de renderizar, enseña la lista de palabras clave y espera OK.

### 4. Motion graphics
- **A (plan, sin construir):** tabla con 4 columnas: lo que se dice · tiempo
  exacto · qué aparece · por qué. Un gráfico por idea, disparado en su
  palabra. Contenido real (fotos de la academia, logos oficiales) antes que
  inventado. Cifras siempre con fuente. Espera aprobación.
- **B (construir):** cada escena en HTML/CSS/JS, disparada por `words.json`,
  compuesta delante o detrás de la persona según el plan.
  - Entrada de 0,2–0,35 s con frenado suave (ease-out), se mantiene, sale limpia.
  - Títulos y enseñanzas clave a pantalla completa con fondo limpio.
  - Zooms: corte seco para enfatizar, lento para tensión, rápido con motion
    blur para energía. Punch-in máx. 6 %. Cada zoom necesita una razón.

### 5. Sonido y exportación
- Efectos: golpe en el gancho, tap en cada clic, whoosh en cambio de
  escena, chime/silbato al cierre. Entre 20 y 25 dB por debajo de la voz.
- Música (si hay): 12 dB por debajo de la voz, ducking de −7 dB mientras se
  habla (ataque 40 ms, relajación 450 ms), entrada 0,6 s, fundido final 1,5 s.
- Limpieza de voz: paso alto contra graves de fondo, de-esser.
- Masteriza a −14 LUFS / < −1 dBTP. Exporta MP4 final + portada PNG e
  informa los valores medidos.

## Revisión final antes de publicar (informe ✓/✗)
1. Nada importante fuera de la zona segura (220 / 380 / 140 px).
2. Ningún subtítulo dura menos de 0,4 s.
3. Nada tapa la cara en ningún fotograma.
4. Cumple `Reglas-de-estilo.md`: fuentes, colores, movimiento.
5. −14 LUFS integrados y pico real < −1 dB (medidos, no estimados).
6. Portada con una palabra grande legible en miniatura.
Arregla lo que falle, reexporta y di qué cambió.

## Notas de dirección que entiendes (se aplican a todo el vídeo)
- «Me tapa la cara» → mueve el gráfico y deja la cara libre en todo el vídeo.
- «Demasiadas cosas» → una idea a la vez.
- «Entra tarde» → adelanta N fotogramas.
- «Subtítulos rápidos» → mínimo 0,4 s cada uno.
- «No sigue mi guía» → revisa colores y fuentes contra la guía.
- «Efectos fuertes» → bájalos (p. ej. −6 dB).
- «Gancho flojo» → primera palabra más grande + golpe en el primer fotograma.
- «Rehaz solo de 0:04 a 0:07» → toca únicamente ese tramo.

## Música y efectos sin derechos
Si el usuario aporta un generador por síntesis en HTML (p. ej. SynthFlow),
ábrelo en Chromium sin interfaz con Playwright, genera el WAV desde su API y
mézclalo según la pasada 5. Si falla, arregla una copia, nunca su archivo.
