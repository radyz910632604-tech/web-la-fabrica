import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera una versión autónoma para el Dockerfile (EasyPanel).
  output: "standalone",
  // Excel se arma en el servidor con exceljs (no se empaqueta para el navegador).
  serverExternalPackages: ["exceljs", "pdf-lib", "web-push", "pg", "qrcode"],
  // Los prompts de IA y los cambios de la base (supabase/migrations) son archivos de texto:
  // van dentro de la versión autónoma para que la app pueda leerlos al arrancar.
  outputFileTracingIncludes: { "/**": ["./n8n/prompts/**/*", "./supabase/migrations/*.sql"] },
  // Las fotos se reducen en el celular (unos 300 KB) y se suben de a una.
  experimental: { serverActions: { bodySizeLimit: "6mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
