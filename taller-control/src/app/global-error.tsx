"use client";

/** Último recurso: si falla hasta el marco de la app, se muestra esto en vez de una pantalla en blanco. */
export default function ErrorGeneral({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f4f4f2", color: "#1a1a1a", padding: 24 }}>
        <div style={{ maxWidth: 480, margin: "15vh auto", background: "#fff", borderRadius: 24, padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>No se pudo cargar Taller Control</h1>
          <p style={{ color: "#555", fontSize: 15 }}>Revisa tu conexión e intenta otra vez. Lo ya guardado no se perdió.</p>
          <button onClick={() => reset()} style={{ height: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#1a1a1a", color: "#fff", fontSize: 15, cursor: "pointer" }}>
            Intentar otra vez
          </button>
        </div>
      </body>
    </html>
  );
}
