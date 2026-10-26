# Web La Fábrica

Landing estática (index.html + js/ + img/ + fonts/) de Centro de Alto Rendimiento La Fábrica.

## Diseño

- Para cualquier cambio visual, usa las skills del proyecto: `impeccable`, `emil-design-eng` y `design-taste-frontend`.
- Evita diseños genéricos de plantilla. Mantén la identidad visual que ya tiene la web.

## Revisión con Playwright

Después de cada cambio visual:

1. Abre `index.html` con Playwright (servidor local, por ejemplo `npx serve .`, o la ruta `file://`).
2. Toma capturas en móvil (390 px de ancho) y en escritorio (1440 px).
3. Revisa las capturas y corrige lo que se vea mal: desbordes, textos cortados, espaciados irregulares, imágenes deformadas.
4. Si el navegador no está instalado, usa la herramienta `browser_install` de Playwright.
