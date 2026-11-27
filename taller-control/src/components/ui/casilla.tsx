"use client";

import { Checkbox } from "radix-ui";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Casilla({ className, ...props }: ComponentProps<typeof Checkbox.Root>) {
  return (
    <Checkbox.Root
      className={cn(
        "grid size-5 shrink-0 cursor-pointer place-items-center rounded-md border-[1.5px] border-control bg-tarjeta transition-colors duration-150 data-[state=checked]:border-primario data-[state=checked]:bg-primario data-[state=checked]:text-primario-tinta",
        className,
      )}
      {...props}
    >
      <Checkbox.Indicator>
        <Check className="size-3.5" strokeWidth={3} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
