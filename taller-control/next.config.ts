import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera una versión autónoma para el Dockerfile (EasyPanel).
  output: "standalone",
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
