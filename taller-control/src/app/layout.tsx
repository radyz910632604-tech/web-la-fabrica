import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { ProveedorTema } from "@/components/armazon/proveedor-tema";

export const metadata: Metadata = {
  title: { default: "Taller Control", template: "%s · Taller Control" },
  description: "Control del taller: carros, órdenes, citas, compras, cobros y utilidad.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ededed" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-PE" suppressHydrationWarning>
      <body>
        <ProveedorTema>{children}</ProveedorTema>
      </body>
    </html>
  );
}
