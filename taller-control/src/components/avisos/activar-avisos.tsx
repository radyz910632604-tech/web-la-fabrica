"use client";

import { useEffect, useState } from "react";
import { BellOff, BellRing } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { guardarSuscripcion, quitarSuscripcion } from "@/lib/avisos/acciones";

function aBytes(base64: string) {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const crudo = atob((base64 + relleno).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(crudo, (c) => c.charCodeAt(0));
}

type Estado = "cargando" | "no_soportado" | "sin_llaves" | "bloqueado" | "apagado" | "activo";

/**
 * Activar los avisos push en este celular o computadora. En iPhone solo
 * funciona con la app instalada en la pantalla de inicio (iOS 16.4 o más).
 */
export function ActivarAvisos({ clavePublica }: { clavePublica: string | null }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [mensaje, setMensaje] = useState<string>();
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      if (!clavePublica) return setEstado("sin_llaves");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setEstado("no_soportado");
      if (Notification.permission === "denied") return setEstado("bloqueado");
      const reg = await navigator.serviceWorker.ready;
      setEstado((await reg.pushManager.getSubscription()) ? "activo" : "apagado");
    })().catch(() => setEstado("no_soportado"));
  }, [clavePublica]);

  async function activar() {
    setOcupado(true);
    setMensaje(undefined);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "apagado");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(clavePublica!) });
      const r = await guardarSuscripcion(sub.toJSON(), navigator.userAgent);
      if (r.error) setMensaje(r.error);
      else setEstado("activo");
    } catch {
      setMensaje("No se pudo activar en este navegador.");
    } finally {
      setOcupado(false);
    }
  }

  async function desactivar() {
    setOcupado(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await quitarSuscripcion(sub.endpoint);
      await sub.unsubscribe();
    }
    setEstado("apagado");
    setOcupado(false);
  }

  const texto: Record<Estado, string> = {
    cargando: "Revisando este celular…",
    no_soportado: "Este navegador no recibe avisos. En iPhone, primero agrega la app a la pantalla de inicio (Compartir → Agregar a inicio) y ábrela desde ahí.",
    sin_llaves: "Los avisos del celular todavía no están configurados en el servidor (faltan las llaves VAPID).",
    bloqueado: "Bloqueaste los avisos para esta app. Actívalos en los ajustes del navegador o del celular.",
    apagado: "Recibe aquí el resumen del mediodía y del cierre, y los avisos de tu trabajo. No consume WhatsApp.",
    activo: "Este celular ya recibe los avisos del taller.",
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-tinta-2">{texto[estado]}</p>
      {estado === "apagado" ? (
        <Boton onClick={activar} disabled={ocupado} className="self-start">
          <BellRing />
          {ocupado ? "Activando…" : "Activar avisos en este celular"}
        </Boton>
      ) : estado === "activo" ? (
        <Boton variante="secundario" onClick={desactivar} disabled={ocupado} className="self-start">
          <BellOff />
          Dejar de recibir avisos aquí
        </Boton>
      ) : null}
      {mensaje ? <p role="alert" className="text-sm text-negativo">{mensaje}</p> : null}
    </div>
  );
}
