# Taller Control

Sistema interno de gestión para talleres automotrices en Lima. **No tiene relación con la landing de La Fábrica** que vive en la raíz de este repositorio; está aquí de forma provisional hasta que exista su propio repositorio privado.

@AGENTS.md

- Fuente de verdad: `ESPECIFICACION.md`. Léela completa antes de trabajar.
- Fase actual: **todas las fases construidas** (`docs/fase-1a-entrega.md`, `docs/fase-1b-entrega.md`, `docs/fase-3-4-5-entrega.md`, `docs/caja-notas-pdf-entrega.md`, `docs/fase-2-6-entrega.md`). Pendiente solo lo que necesita cuentas del usuario: publicar en EasyPanel, conectar Meta/n8n y poner las llaves de IA. El usuario autorizó avanzar sin esperar aprobación entre entregas («avanza solo»).
- Inventario: `src/lib/inventario.ts` (puro) y `src/lib/taller/inventario-consultas.ts`; el stock solo cambia con el kardex (disparador `privado.aplicar_movimiento`).
- IA: `src/lib/ia/` (proveedor por `IA_PROVEEDOR`: claude, openai o prueba; `sin-ia.ts` entiende mensajes simples sin IA). Prompts en `n8n/prompts/`. Todo lo leído por IA queda `por_confirmar` (lo fuerza la base).
- WhatsApp: `src/lib/whatsapp/` y `src/app/api/interna/` (clave `CLAVE_API_INTERNA`). Escribe con la sesión de quien escribe (`sesion.ts`); la llave de servicio solo se usa para identificar el celular, la auditoría de mensajes, el ciclo de avisos y las respuestas de clientes (encuesta y cotización), que no tienen sesión.
- Avisos: `src/lib/avisos/` (ciclo cada 15 min desde n8n, push con `web-push`). Flujos de n8n en `n8n/`.
- PDF: `src/lib/pdf/` (pdf-lib, Helvetica) y la ruta `src/app/pdf/[tipo]/[id]/route.ts`; leen con la sesión de quien pide.
- Dinero: cálculos puros en `src/lib/dinero.ts` y `src/lib/alertas.ts` (con pruebas); consultas en `src/lib/taller/*-consultas.ts` y `reportes.ts`. Nada con dinero se borra: se anula con motivo (disparador `privado.proteger_dinero`).
- Plan y modelo de datos: `docs/fase-0-plan.md`, `docs/modelo-de-datos.md`. Contexto de producto: `PRODUCT.md`.
- Pide aprobación antes de cambiar de fase salvo que el usuario haya dicho que avances solo.
- Habla en español sencillo: el usuario no es programador.
- Pregunta antes de instalar algo nuevo o de tomar decisiones que cuesten dinero.
- Commits pequeños, en español.
- Nunca claves, tokens ni datos reales de clientes en el código, los commits o los datos de ejemplo.
- El usuario trabaja en Windows 10 con Warp: todo debe correr con `npm run …`, sin scripts exclusivos de Linux.

## Cómo está hecho

- Next.js 16 (App Router; el middleware se llama `src/proxy.ts`), sin Cache Components. Tailwind v4 con tokens en `src/app/globals.css`.
- Componentes estilo shadcn/ui escritos a mano en `src/components/ui/` (Radix + cva).
- Permisos: RLS en `supabase/migrations/`; funciones de apoyo en el esquema `privado`. Toda tabla nueva: `empresa_id`, sellos, auditoría, RLS y pruebas en `supabase/tests/`.
- Las escrituras van con la sesión de la persona (`clienteServidor`, o `sesionDe()` en WhatsApp). `clienteAdmin` (llave de servicio) solo para Auth, siempre después de verificar el permiso, y para lo que corre sin sesión (auditoría de WhatsApp, ciclo de avisos, respuestas de clientes).
- Lo que ve cada rol en pantalla: `src/lib/navegacion.ts` y `src/lib/panel/vista.ts`, con pruebas en `tests/`.

## Revisar antes de entregar

`npm test`, `npm run test:db`, `npm run lint`, `npm run build`, `npm run respaldo` (si tocaste la base), y capturas con Playwright a 390 y 1440 px (claro y oscuro) para cada rol afectado. Para probar IA y WhatsApp sin llaves: `IA_PROVEEDOR=prueba IA_PROVEEDOR_AUDIO=prueba` y una `CLAVE_API_INTERNA` local.
