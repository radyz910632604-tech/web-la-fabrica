import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera una versión autónoma para el Dockerfile (EasyPanel).
  output: "standalone",
  // Excel se arma en el servidor con exceljs (no se empaqueta para el navegador).
  serverExternalPackages: ["exceljs", "pdf-lib"],
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
