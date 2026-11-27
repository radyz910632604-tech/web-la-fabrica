# Trabajo en equipo: Claude (en la nube) y Codex (en la PC del dueño)

## La idea
GitHub es el punto de encuentro. Cada agente trabaja en su rama, sube lo que termina y el otro lo baja.
Si a uno se le acaban los tokens, el otro sigue desde lo último que está en GitHub.

- Repositorio: `radyz910632604-tech/web-la-fabrica`, carpeta `taller-control/`.
- **Rama de Claude:** `claude/relaxed-goodall-6phhv2`. **EasyPanel despliega esta rama**: lo que llega aquí llega a la web.
- **Rama de Codex:** `codex/trabajo` (créala desde la de Claude).

## Reglas para no pisarse
1. Tareas separadas: no tocar los mismos archivos a la vez. Decidir antes quién hace qué.
2. Antes de empezar: traer lo último de la rama de Claude.
3. Al terminar algo que funciona: commit pequeño en español y subirlo a la propia rama.
4. Para juntar: el dueño le dice a Claude «une lo de Codex»; Claude lo revisa, corre las pruebas y lo une
   a su rama (así llega a la web). También puede hacerse al revés.
5. Migraciones nuevas: avisar antes al otro agente el número que se va a usar (por ejemplo 0018), para no repetirlo.

## Comandos (Windows, en la carpeta `taller-control`)
```
git fetch origin
git checkout -b codex/trabajo origin/claude/relaxed-goodall-6phhv2   (solo la primera vez)
git pull origin claude/relaxed-goodall-6phhv2                        (traer lo último de Claude)
npm install
npm test
git push -u origin codex/trabajo                                     (subir lo de Codex)
```

## Dónde está cada cosa
- Reglas y mapa del código: `CLAUDE.md` y `AGENTS.md`.
- Qué pidió el dueño: `ESPECIFICACION.md` y `docs/agente-whatsapp-brechas.md`.
- Ideas sin aprobar (no construir sin que el dueño lo pida): `docs/ideas/`.
- Despliegue: `docs/despliegue-easypanel.md`.

## Pendientes (actualizar al terminar cada tarea)
- Conectar WhatsApp real: número de Meta, llaves de IA (OpenAI y Claude), flujos de n8n (`n8n/README.md`). Necesita las cuentas del dueño.
- Decidir si se mueve Supabase a São Paulo (más rápido); conviene antes de importar muchos datos.
- Dirección propia `taller.corporacionmotors.com` y repositorio privado (necesita token de GitHub en EasyPanel antes).
