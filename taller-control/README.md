# Taller Control

Sistema interno para talleres automotrices: app instalable y WhatsApp sobre una misma base de datos.
La especificación completa está en [ESPECIFICACION.md](ESPECIFICACION.md).

**Estado:** Fase 1 completa (entregas [1A](docs/fase-1a-entrega.md) y [1B](docs/fase-1b-entrega.md)): acceso, personal, panel, clientes, carros, órdenes con fotos, citas y app instalable.

---

## Lo que necesitas en tu computadora (Windows 10)

| Programa | Para qué | Cómo saber si ya lo tienes |
|---|---|---|
| [Node.js 22](https://nodejs.org) (versión 22.18 o más nueva) | Correr la app | `node -v` |
| [Git](https://git-scm.com) | Bajar el código | `git --version` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Solo para la base de datos **local** (opción A) | `docker --version` |

Todos los comandos de abajo funcionan igual en Warp, PowerShell o la terminal de VS Code.

## Instalar

```powershell
git clone <dirección-del-repositorio>
cd taller-control
npm install
Copy-Item .env.example .env.local
```

Después elige **una** de las dos opciones para la base de datos.

### Opción A · Base de datos en tu PC (con Docker Desktop)

```powershell
npm run db:iniciar        # la primera vez descarga Supabase (unos minutos)
```

Al terminar imprime una lista. Copia en `.env.local`:

- `API_URL` → `SUPABASE_URL`
- `ANON_KEY` (o `PUBLISHABLE_KEY`) → `SUPABASE_ANON_KEY`
- `SERVICE_ROLE_KEY` (o `SECRET_KEY`) → `SUPABASE_SERVICE_ROLE_KEY`

```powershell
npm run db:reiniciar      # crea las tablas y los permisos
npm run datos:ejemplo     # dos talleres y una persona por rol, todo ficticio
npm run dev
```

Abre <http://localhost:3000> y entra con **900 000 001** y la contraseña **taller-ejemplo**.

### Opción B · Proyecto de pruebas en Supabase (nube, plan gratis)

1. Crea un proyecto en <https://supabase.com> (plan Free).
2. En **Authentication → Sign In / Providers**, desactiva **Allow new users to sign up**: aquí nadie se registra solo, el acceso lo da administración.
3. Sube las tablas y los permisos:
   ```powershell
   npx supabase login
   npx supabase link --project-ref <id-del-proyecto>
   npx supabase db push
   ```
4. Copia en `.env.local` la URL y las dos llaves (**Project Settings → API**) y agrega `CLAVE_EJEMPLO=` con una contraseña de 8 caracteres o más.
5. `npm run datos:ejemplo -- --nube-de-pruebas` y luego `npm run dev`.

> Nunca corras `datos:ejemplo` contra la base de producción. El script se niega si la base no es local, salvo que le pases `--nube-de-pruebas` a propósito.

## Personas de ejemplo

Todas usan la contraseña `taller-ejemplo` en local. Los números son ficticios.

| Celular | Persona | Rol |
|---|---|---|
| 900 000 001 | Rosa Huamán | Gerencia (dos talleres) |
| 900 000 002 | Jorge Salas | Administración (dos talleres) |
| 900 000 003 | Carla Mendoza | Asesor de servicio |
| 900 000 004 | Luis Quispe | Técnico |
| 900 000 005 | Pedro Rojas | Almacén |
| 900 000 006 | Andrea Torres | Ventas por redes |
| 900 000 007 | Milagros Vega | Confirmación de citas |
| 900 000 008 | Diego Paredes | Asesor (Taller Sur) |
| 900 000 009 | Sandra Ríos | Recepción y caja |
| 900 000 010 | Ernesto Lara | Técnico |

El Taller Norte trae 14 carros en el taller, 90 entregas recientes, citas de hoy y su dinero (compras, boletas, pagos, cotizaciones y sueldos), todo ficticio.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Abre la app en modo desarrollo (<http://localhost:3000>) |
| `npm test` | Pruebas de cálculos, formatos y de qué ve cada rol |
| `npm run test:db` | Pruebas de permisos dentro de la base de datos (necesita la opción A) |
| `npm run lint` | Revisa el código |
| `npm run build` | Compila la versión de producción |
| `npm run db:iniciar` / `db:detener` | Enciende o apaga la base local |
| `npm run db:reiniciar` | Borra la base local y la vuelve a crear desde las migraciones |
| `npm run datos:ejemplo` | Carga los datos ficticios (incluye dinero de ejemplo) |
| `npm run respaldo` | Respaldo de la base local; con `-- --nube`, de la base en la nube ([guía](docs/respaldo.md)) |

Guías de cada entrega en `docs/`; la última es [WhatsApp, IA, avisos e inventario](docs/fase-2-6-entrega.md).

## Carpetas

```
src/app/            pantallas (ingresar, panel, órdenes, clientes, citas, caja, compras, reportes, configuración…)
src/components/     piezas visuales (ui/ base, panel/, armazon/ = barras)
src/lib/            reglas: roles, navegación, formatos, celulares, placas, sesión
supabase/           migraciones (tablas y permisos), configuración y pruebas de la base
scripts/            datos de ejemplo y respaldo
tests/              pruebas automáticas
docs/               plan, modelo de datos, entregas y despliegue
n8n/                flujos de WhatsApp y avisos para importar, plantillas de Meta y prompts de IA
```

WhatsApp, IA y avisos se configuran con variables de entorno (todas explicadas en `.env.example`) y con los flujos de [n8n/README.md](n8n/README.md). Sin esas llaves la app funciona igual: se registra a mano.

## Seguridad en una línea

Los permisos los aplica la base de datos (RLS): aunque alguien manipule la app, no puede leer ni cambiar lo que su rol no permite. La llave de servicio solo vive en el servidor.
