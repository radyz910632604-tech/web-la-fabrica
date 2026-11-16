# Taller Control · imagen para EasyPanel (VPS de Hostinger)
# Construye la app de Next.js en modo "standalone" y la sirve con Node.
# Las claves NO van en la imagen: se pasan como variables de entorno en EasyPanel.

FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:22-alpine AS construccion
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS ejecucion
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S taller && adduser -S taller -G taller
COPY --from=construccion --chown=taller:taller /app/.next/standalone ./
COPY --from=construccion --chown=taller:taller /app/.next/static ./.next/static
COPY --from=construccion --chown=taller:taller /app/public ./public
USER taller
EXPOSE 3000
CMD ["node", "server.js"]
