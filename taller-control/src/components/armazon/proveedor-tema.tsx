"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { ProveedorConsejos } from "@/components/ui/consejo";

/** Claro por defecto (el taller trabaja de día); el interruptor guarda la elección. */
export function ProveedorTema({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <ProveedorConsejos>{children}</ProveedorConsejos>
    </ThemeProvider>
  );
}
