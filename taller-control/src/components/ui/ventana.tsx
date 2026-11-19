"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Ventana = Dialog.Root;
export const DisparadorVentana = Dialog.Trigger;
export const CerrarVentana = Dialog.Close;

/** Ventana centrada en computadora; hoja que sube desde abajo en celular. */
export function ContenidoVentana({
  titulo,
  descripcion,
  className,
  children,
  ...props
}: ComponentProps<typeof Dialog.Content> & { titulo: string; descripcion?: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 data-[state=open]:animate-[aparecer_160ms_ease]" />
      <Dialog.Content
        className={cn(
          "fixed z-50 flex max-h-[92dvh] flex-col overflow-y-auto bg-tarjeta text-tinta shadow-flotante outline-none",
          "inset-x-0 bottom-0 rounded-t-[28px] p-5 pb-[max(20px,env(safe-area-inset-bottom))] data-[state=open]:animate-[subir_260ms_var(--ease-cajon)]",
          "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(520px,calc(100vw-48px))] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[28px] sm:p-7 sm:data-[state=open]:animate-[aparecer_180ms_ease]",
          className,
        )}
        {...props}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-xl font-semibold tracking-[-0.01em]">{titulo}</Dialog.Title>
            {descripcion ? (
              <Dialog.Description className="mt-1 text-[15px] text-tinta-2">{descripcion}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{titulo}</Dialog.Description>
            )}
          </div>
          <Dialog.Close className="presionable -mt-1 -mr-1 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-interna" aria-label="Cerrar">
            <X className="size-5" />
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
