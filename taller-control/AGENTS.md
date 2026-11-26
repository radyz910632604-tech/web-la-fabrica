<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Taller Control: reglas para cualquier agente (Codex, Claude u otro)

Este proyecto lo construyen varios agentes por turnos o en paralelo. Las reglas completas están en
`CLAUDE.md` (léelo entero: tiene el mapa del código) y la especificación en `ESPECIFICACION.md`.
El trabajo en equipo se explica en `docs/trabajo-en-equipo.md`. Lo esencial:

- **El dueño no es programador.** Explica todo en español sencillo, un paso a la vez.
- **Secretos:** nunca claves, tokens ni datos reales de clientes en el código, los commits o los datos
  de ejemplo. Solo en `.env.local` (documentado en `.env.example`).
- **Permisos en la base (RLS)**, no solo escondiendo botones. Toda tabla nueva: `empresa_id`, sellos,
  auditoría, RLS y pruebas en `supabase/tests/`. Las migraciones van numeradas en `supabase/migrations/`
  y se registran en `src/lib/base/versiones.ts` (la app las aplica sola al desplegar).
- **Dinero:** nada se borra, se anula con motivo. Lo leído por IA queda «por confirmar».
- **Escrituras con la sesión de la persona** (`clienteServidor`); la llave de servicio solo donde
  `CLAUDE.md` lo permite.
- **Antes de instalar algo nuevo o de algo que cueste dinero: preguntar al dueño.**
- **Commits pequeños, en español.** Cada agente en su propia rama (ver `docs/trabajo-en-equipo.md`).
- **Antes de entregar:** `npm test`, `npm run lint`, `npm run build` y, si tocaste la base,
  `npm run test:db` (necesita Docker y `npm run db:iniciar`).
- **Comandos compatibles con Windows** (el dueño usa Windows 10): todo con `npm run …`.
