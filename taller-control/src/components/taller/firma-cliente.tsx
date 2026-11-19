"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Eraser, PenLine } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { ContenidoVentana, Ventana, DisparadorVentana } from "@/components/ui/ventana";

type Accion = (form: FormData) => Promise<{ ok?: string; error?: string }>;

/**
 * Recuadro para que el cliente firme con el dedo (o el mouse). La firma se
 * guarda como imagen PNG con tinta oscura sobre fondo transparente, así sale
 * bien en el PDF aunque la pantalla esté en modo oscuro.
 */
export function FirmarCliente({ etiqueta, titulo, texto, accion, variante = "secundario" }: { etiqueta: string; titulo: string; texto: string; accion: Accion; variante?: "primario" | "secundario" }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <Ventana open={abierta} onOpenChange={setAbierta}>
      <DisparadorVentana asChild>
        <Boton type="button" variante={variante} className="w-full sm:w-auto">
          <PenLine />
          {etiqueta}
        </Boton>
      </DisparadorVentana>
      <ContenidoVentana titulo={titulo} descripcion={texto} className="sm:w-[min(640px,calc(100vw-48px))]">
        {abierta ? <Lienzo accion={accion} alTerminar={() => setAbierta(false)} /> : null}
      </ContenidoVentana>
    </Ventana>
  );
}

function Lienzo({ accion, alTerminar }: { accion: Accion; alTerminar: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const trazos = useRef(0);
  const [vacio, setVacio] = useState(true);
  const [error, setError] = useState("");
  const [guardando, iniciar] = useTransition();

  useEffect(() => {
    const c = ref.current!;
    const escala = window.devicePixelRatio || 1;
    const { width, height } = c.getBoundingClientRect();
    c.width = Math.round(width * escala);
    c.height = Math.round(height * escala);
    const g = c.getContext("2d")!;
    g.scale(escala, escala);
    g.lineCap = "round";
    g.lineJoin = "round";
    g.lineWidth = 2.4;
    g.strokeStyle = "#1a1a1a";
    let dibujando = false;
    let ultimo: { x: number; y: number } | null = null;
    const punto = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const bajar = (e: PointerEvent) => {
      if (dibujando) return; // un solo dedo a la vez
      dibujando = true;
      c.setPointerCapture(e.pointerId);
      ultimo = punto(e);
      g.beginPath();
      g.arc(ultimo.x, ultimo.y, 1.2, 0, Math.PI * 2);
      g.fillStyle = "#1a1a1a";
      g.fill();
    };
    const mover = (e: PointerEvent) => {
      if (!dibujando || !ultimo) return;
      const p = punto(e);
      g.beginPath();
      g.moveTo(ultimo.x, ultimo.y);
      g.lineTo(p.x, p.y);
      g.stroke();
      ultimo = p;
    };
    const subir = () => {
      if (!dibujando) return;
      dibujando = false;
      ultimo = null;
      trazos.current++;
      setVacio(false);
    };
    c.addEventListener("pointerdown", bajar);
    c.addEventListener("pointermove", mover);
    c.addEventListener("pointerup", subir);
    c.addEventListener("pointercancel", subir);
    return () => {
      c.removeEventListener("pointerdown", bajar);
      c.removeEventListener("pointermove", mover);
      c.removeEventListener("pointerup", subir);
      c.removeEventListener("pointercancel", subir);
    };
  }, []);

  const borrar = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    trazos.current = 0;
    setVacio(true);
    setError("");
  };

  const guardar = () =>
    iniciar(async () => {
      const c = ref.current!;
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
      if (!blob) return setError("No se pudo leer la firma. Intenta de nuevo.");
      const form = new FormData();
      form.append("firma", new File([blob], "firma.png", { type: "image/png" }));
      const r = await accion(form);
      if (r.error) setError(r.error);
      else alTerminar();
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <canvas
          ref={ref}
          aria-label="Recuadro para firmar"
          className="block h-52 w-full cursor-crosshair touch-none rounded-2xl border border-borde bg-white sm:h-60"
        />
        <span aria-hidden className="pointer-events-none absolute inset-x-8 bottom-12 border-b border-dashed border-[#c8c8c8]" />
        {vacio ? <span className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-sm text-[#6b6b6b]">Firme aquí</span> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-negativo">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Boton type="button" variante="fantasma" onClick={borrar} disabled={guardando || vacio}>
          <Eraser />
          Borrar y repetir
        </Boton>
        <Boton type="button" onClick={guardar} disabled={guardando || vacio}>
          {guardando ? "Guardando…" : "Guardar firma"}
        </Boton>
      </div>
    </div>
  );
}
