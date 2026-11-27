import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { TituloCaja } from "@/components/caja/subnav";
import { estilosBoton } from "@/components/ui/boton";
import { Estado, type ColorEstado } from "@/components/ui/estado";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearEntero, formatearMomento } from "@/lib/formato";
import { obtenerContexto } from "@/lib/sesion";
import { datosDelSistema } from "@/lib/sistema/datos";
import { puntosDelSistema, resumenSistema, type EstadoPunto } from "@/lib/sistema/estado";
import { cn } from "@/lib/utils";
import { CopiaAhora, CrearLlaves } from "./piezas";

export const metadata = { title: "Estado del sistema" };
export const dynamic = "force-dynamic";

const ETIQUETA: Record<EstadoPunto, [string, ColorEstado]> = {
  listo: ["Listo", "verde"],
  atencion: ["Por mejorar", "amarillo"],
  falta: ["Falta", "rojo"],
  opcional: ["Opcional", "gris"],
};

const peso = (bytes: number | null) => (bytes == null ? "—" : bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);

/** Solo gerencia: qué está conectado, qué falta, y las copias de seguridad. */
export default async function EstadoDelSistema() {
  const ctx = await obtenerContexto();
  if (!ctx.roles.includes("gerencia")) notFound();
  const { datos, respaldos } = await datosDelSistema(ctx);
  // Primero lo que falta, después lo que se puede mejorar; lo que ya está listo, al final.
  const ORDEN: Record<EstadoPunto, number> = { falta: 0, atencion: 1, opcional: 2, listo: 3 };
  const puntos = puntosDelSistema(datos).sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]);
  const resumen = resumenSistema(puntos);
  const ahora = datos.ahora;
  const guias = { base: !datos.base.automatica, avisos: !datos.avisos.llaves, n8n: !datos.whatsapp.clave };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TituloCaja
        titulo="Estado del sistema"
        detalle={`${resumen.listos} de ${resumen.total} puntos listos. ${resumen.urgentes ? `${resumen.urgentes === 1 ? "Hay 1 que falta" : `Hay ${resumen.urgentes} que faltan`} y conviene resolver primero.` : "No falta nada urgente."}`}
      />

      <Tarjeta aria-labelledby="t-control" className="p-0 md:p-0">
        <h2 id="t-control" className="sr-only">Lista de control</h2>
        <ul>
          {puntos.map((p, i) => {
            const [texto, color] = ETIQUETA[p.estado];
            return (
              <li key={p.clave} className={cn("grid gap-x-6 gap-y-1 px-5 py-4 md:grid-cols-[230px_minmax(0,1fr)] md:px-6 md:py-5", i > 0 && "border-t border-regla")}>
                <div>
                  <h3 className="text-[15px] font-semibold text-tinta">{p.titulo}</h3>
                  <Estado color={color} texto={texto} className="mt-0.5 text-sm text-tinta-2" />
                </div>
                <div className="min-w-0 text-[15px]">
                  <p className="text-tinta">{p.detalle}</p>
                  {p.como ? <p className="mt-1 text-sm text-tinta-2">{p.como}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Tarjeta>

      <Tarjeta aria-labelledby="t-copias">
        <CabeceraTarjeta
          id="t-copias"
          titulo="Copias de seguridad"
          detalle="Todo lo registrado en el sistema, en un archivo. Se hace sola cada madrugada y se guardan 30 días."
          accion={<div className="hidden sm:block"><CopiaAhora /></div>}
        />
        <div className="mb-4 sm:hidden">
          <CopiaAhora />
        </div>
        {respaldos.length ? (
          <ul className="flex flex-col">
            {respaldos.map((r, i) => (
              <li key={r.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 py-3", i > 0 && "border-t border-regla")}>
                <div className="min-w-0 flex-1 basis-56">
                  <p className="text-[15px] font-medium text-tinta">
                    {formatearMomento(new Date(r.creadoEn), ahora)}
                    <span className="font-normal text-tinta-3"> · {r.origen === "manual" ? "a pedido" : "automática"}</span>
                  </p>
                  {r.estado === "listo" ? (
                    <p className="text-sm text-tinta-2">
                      {r.modo === "completo" ? "Completa" : "Sin contraseñas del personal"} · <span className="num">{formatearEntero(r.filas ?? 0)}</span> registros · <span className="num">{peso(r.bytes)}</span>
                      {r.descargadoEn ? ` · bajada ${formatearMomento(new Date(r.descargadoEn), ahora).replace(/^[A-Z]/, (l) => l.toLowerCase())}` : ""}
                    </p>
                  ) : (
                    <p className="text-sm text-negativo">No se pudo hacer. {r.error}</p>
                  )}
                </div>
                {r.estado === "listo" ? (
                  <a href={`/respaldos/${r.id}`} className={estilosBoton({ variante: "secundario", tamano: "chico" })} aria-label={`Descargar la copia de ${formatearMomento(new Date(r.creadoEn), ahora)}`}>
                    <Download />
                    Descargar
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl bg-interna px-4 py-5 text-[15px] text-tinta-2">Todavía no hay copias. Toca «Hacer una copia ahora» para tener la primera.</p>
        )}
        <p className="mt-4 text-sm text-tinta-2">
          Una vez por semana descarga la más nueva y guárdala fuera del sistema (tu computadora o tu Drive). Las fotos y los PDF subidos no van dentro del archivo: se quedan en Supabase.
        </p>
      </Tarjeta>

      {guias.base || guias.avisos || guias.n8n ? (
        <section aria-labelledby="t-conectar" className="flex min-w-0 flex-col gap-4">
          <div>
            <h2 id="t-conectar" className="text-[19px] font-semibold tracking-[-0.01em]">Lo que falta conectar</h2>
            <p className="mt-1 text-[15px] text-tinta-2">
              Todo se pega en EasyPanel → tu servicio → <strong className="font-medium text-tinta">Entorno</strong>, una línea debajo de la otra. Después «Guardar» y «Implementar».
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {guias.base ? (
              <Tarjeta aria-labelledby="g-base" className="min-w-0">
                <CabeceraTarjeta id="g-base" nivel={3} titulo="Que la base se actualice sola" detalle="Y que la copia de seguridad salga completa." />
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] text-tinta-2">
                  <li>En Supabase, arriba, toca <strong className="font-medium text-tinta">Connect</strong> y elige <strong className="font-medium text-tinta">Session pooler</strong>.</li>
                  <li>Copia la dirección que empieza con <span className="num text-tinta">postgresql://</span> tal como está.</li>
                  <li>
                    En EasyPanel → Entorno agrega estas dos líneas:
                    <pre className="num mt-2 rounded-2xl bg-interna p-3 text-[12px] leading-5 break-words whitespace-pre-wrap text-tinta">{"SUPABASE_DB_URL=la dirección que copiaste\nSUPABASE_DB_PASSWORD=la contraseña de la base"}</pre>
                  </li>
                  <li>Si no recuerdas la contraseña: Supabase → Database → Settings → «Reset database password».</li>
                </ol>
              </Tarjeta>
            ) : null}
            {guias.avisos ? (
              <Tarjeta aria-labelledby="g-avisos" className="min-w-0">
                <CabeceraTarjeta id="g-avisos" nivel={3} titulo="Avisos en el celular" detalle="Dos llaves que se crean una sola vez. Gratis." />
                <CrearLlaves cual="avisos" etiqueta="Crear las llaves de avisos" />
              </Tarjeta>
            ) : null}
            {guias.n8n ? (
              <Tarjeta aria-labelledby="g-n8n" className="min-w-0">
                <CabeceraTarjeta id="g-n8n" nivel={3} titulo="Clave para WhatsApp (n8n)" detalle="La misma clave se pone en EasyPanel y en n8n." />
                <CrearLlaves cual="n8n" etiqueta="Crear la clave para n8n" />
              </Tarjeta>
            ) : null}
          </div>
        </section>
      ) : null}

      <p className="text-sm text-tinta-3">
        ¿Dudas con algún paso? Están explicados en <Link href="/ayuda" className="underline underline-offset-2 hover:text-tinta">Ayuda</Link>.
      </p>
    </div>
  );
}
