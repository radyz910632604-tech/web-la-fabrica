# Despliegue en EasyPanel (borrador)

> Borrador de la Entrega 1A. Se completa y se prueba en tu VPS al cerrar la Fase 1, cuando decidamos dónde va Supabase en producción (pregunta 2 del plan).

## Lo que se necesita

- El VPS de Hostinger con EasyPanel (ya lo tienes).
- El repositorio en GitHub, conectado a EasyPanel.
- Un proyecto de Supabase con las migraciones aplicadas (`npx supabase db push`) y el registro libre **desactivado** (Authentication → Sign In / Providers → Allow new users to sign up: apagado).

## Pasos

1. En EasyPanel: **Create Service → App**. Fuente: GitHub, el repositorio y la rama.
2. **Build:** Dockerfile. Si el proyecto sigue dentro de la carpeta `taller-control/` del repositorio, pon esa carpeta como "Build Path" o "Root Directory".
3. **Environment:** pega las variables de `.env.example` con los valores de tu Supabase de producción:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secreta)
4. **Port:** 3000.
5. **Domains:** agrega el dominio o subdominio (por ejemplo `taller.tunegocio.pe`). EasyPanel pone el certificado HTTPS.
6. Deploy. La primera vez, entra a Supabase y crea a la primera persona de gerencia (se documenta el comando al cerrar la Fase 1).

## Verificar

- Abre el dominio: debe mostrar **Ingresar**.
- Entra con gerencia y revisa **Personal y roles**.
- Nunca cargues los datos de ejemplo en producción.
