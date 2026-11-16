/**
 * Lo que se ve al instante mientras llega la página pedida.
 * Con este archivo, Next.js deja lista esta pantalla antes del toque,
 * así el cambio de pestaña responde de inmediato aunque la base tarde.
 */
export default function Cargando() {
  return (
    <div className="cargando" role="status" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div aria-hidden="true">
        <div className="hueso h-9 w-64 max-w-[70%] rounded-full" />
        <div className="hueso mt-3 h-4 w-80 max-w-[85%] rounded-full" />
        <div className="mt-7 grid gap-4 md:grid-cols-3">
          <div className="hueso h-36 rounded-tarjeta" />
          <div className="hueso h-36 rounded-tarjeta" />
          <div className="hueso hidden h-36 rounded-tarjeta md:block" />
        </div>
        <div className="mt-4 rounded-tarjeta bg-tarjeta p-5 shadow-reposo md:p-6">
          <div className="hueso h-5 w-40 rounded-full" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="mt-4 flex items-center gap-4">
              <div className="hueso h-8 w-20 shrink-0 rounded-lg" />
              <div className="hueso h-4 flex-1 rounded-full" />
              <div className="hueso hidden h-4 w-24 rounded-full sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
