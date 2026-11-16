import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera una versión autónoma para el Dockerfile (EasyPanel).
  output: "standalone",
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
