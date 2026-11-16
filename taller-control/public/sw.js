// Service worker mínimo de Taller Control: permite instalar la app y muestra
// un aviso claro cuando no hay conexión. No guarda datos del taller en el teléfono.
const PAGINA_SIN_CONEXION = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión · Taller Control</title><body style="margin:0;font-family:system-ui,sans-serif;background:#ededed;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center">
<div><h1 style="font-size:24px;margin:0 0 8px">Sin conexión</h1><p style="margin:0;color:#5c5c5c">Revisa el internet del celular y vuelve a intentar.</p></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request).catch(() => new Response(PAGINA_SIN_CONEXION, { headers: { "Content-Type": "text/html; charset=utf-8" } })),
  );
});
