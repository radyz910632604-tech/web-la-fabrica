"use client";

import { DropdownMenu } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const DisparadorMenu = DropdownMenu.Trigger;
export const GrupoMenu = DropdownMenu.Group;
export const GrupoRadioMenu = DropdownMenu.RadioGroup;

export function ContenidoMenu({ className, sideOffset = 8, ...props }: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        className={cn(
          "flotante z-50 min-w-56 rounded-2xl bg-tarjeta p-1.5 text-tinta shadow-flotante ring-1 ring-borde",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

const estiloOpcion =
  "relative flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[15px] outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-interna [&_svg]:size-[18px] [&_svg]:text-tinta-2";

export function OpcionMenu({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={cn(estiloOpcion, className)} {...props} />;
}

export function OpcionRadioMenu({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cn(estiloOpcion, "pr-9", className)} {...props}>
      {children}
      <DropdownMenu.ItemIndicator className="absolute right-3">
        <span className="block size-2 rounded-full bg-acento" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

export function EtiquetaMenu({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return <DropdownMenu.Label className={cn("px-3 pt-2 pb-1 text-xs text-tinta-3", className)} {...props} />;
}

export function SeparadorMenu({ className, ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn("my-1.5 h-px bg-regla", className)} {...props} />;
}
