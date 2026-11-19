# Respaldo y restauración

Un respaldo es una copia de todo lo registrado (órdenes, clientes, dinero, personal) en archivos que puedes guardar fuera del sistema. Si algo sale mal, con esa copia se vuelve a dejar todo como estaba ese día.

## Qué se respalda

| Archivo | Qué tiene |
| --- | --- |
| `1-estructura.sql` | Las tablas y las reglas de permisos (también están en `supabase/migrations/`). |
| `2-usuarios.sql` | Las cuentas para entrar (celular y contraseña cifrada). |
| `3-datos.sql` | Todo lo registrado: talleres, personal, clientes, carros, órdenes, citas, compras, comprobantes, pagos, cierres y auditoría. |

**Las fotos no van en estos archivos.** Están en el almacenamiento de Supabase (carpeta `ordenes`). Para copiarlas: Supabase → Storage → `ordenes` → descargar, o pídelo a quien administre el servidor.

Los respaldos tienen datos de clientes: guárdalos en un lugar privado (Drive personal de la empresa, USB guardado). La carpeta `respaldos/` nunca se sube al repositorio.

## Hacer un respaldo

En Warp, dentro de la carpeta `taller-control`:

```powershell
# Base en la nube (la que usa el taller):
npm run respaldo -- --nube

# Base local de pruebas:
npm run respaldo
```

Para la nube necesitas en `.env.local` la línea `SUPABASE_DB_URL=...` (Supabase → Project Settings → Database → Connection string → URI). Esa cadena tiene la contraseña de la base: no la compartas.

Necesita Docker Desktop abierto (el comando usa la herramienta oficial de Supabase).

Queda una carpeta como `respaldos/2026-11-16-1830-nube/` con los tres archivos.

**Recomendado:** un respaldo cada semana y antes de cada cambio grande. Supabase de pago (plan Pro) además guarda copias diarias automáticas por 7 días.

## Restaurar

Restaurar reemplaza lo que hay en la base. Hazlo con calma y, si puedes, primero en un proyecto de prueba.

1. Crea la estructura en la base vacía (proyecto nuevo de Supabase):

   ```powershell
   npx supabase link --project-ref TU-PROYECTO
   npx supabase db push
   ```

2. Carga las cuentas y luego los datos, en ese orden. Con `psql` (viene con PostgreSQL) y la cadena de conexión:

   ```powershell
   psql "TU_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f respaldos\CARPETA\2-usuarios.sql
   psql "TU_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f respaldos\CARPETA\3-datos.sql
   ```

   Los archivos desactivan las reglas automáticas mientras cargan, para que no se dupliquen perfiles ni se bloqueen registros de dinero ya anulados.

3. Sube las fotos a Storage → `ordenes`, con las mismas carpetas.

4. Entra con un celular de gerencia y revisa el panel, una orden y la caja.

## Probado

Se probó en la base local: respaldo, borrado completo, restauración y entrada con un usuario. Volvieron las 104 órdenes, los 127 pagos y las 9 cuentas.
