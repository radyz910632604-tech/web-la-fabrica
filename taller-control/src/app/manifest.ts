import type { MetadataRoute } from "next";

/** Para instalar Taller Control como app en el celular y la computadora. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Taller Control",
    short_name: "Taller",
    description: "Control del taller: carros, órdenes, citas y clientes.",
    lang: "es-PE",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ededed",
    theme_color: "#ededed",
    icons: [
      { src: "/iconos/icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/iconos/icono-512.png", sizes: "512x512", type: "image/png" },
      { src: "/iconos/icono-mascara-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Nuevo ingreso", url: "/ordenes/nueva" },
      { name: "Citas de hoy", url: "/citas" },
    ],
  };
}
