"use client";

import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

/** Globo con el nombre de un botón de solo ícono. */
export function ProveedorConsejos({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={600}>
      {children}
    </Tooltip.Provider>
  );
}

export function Consejo({ texto, lado = "right", children }: { texto: string; lado?: "top" | "right" | "bottom" | "left"; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={lado}
          sideOffset={10}
          className="z-50 rounded-lg bg-primario px-2.5 py-1.5 text-[13px] font-medium text-primario-tinta shadow-flotante data-[state=delayed-open]:animate-[aparecer_120ms_ease]"
        >
          {texto}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
