import Link from "next/link";
import { Copiar } from "@/components/base/copiar";
import { Logo } from "@/components/marca/logo";
import { Boton } from "@/components/ui/boton";
import { estadoActualizador } from "@/lib/base/aplicar";
import { bloquesPendientes, urlEditorSql } from "@/lib/base/esquema";
import { instalacionAbierta } from "@/lib/base/instalacion";
import { FormularioInstalar } from "./formulario";

export const metadata = { title: "Instalar" };
export const dynamic = "force-dynamic";

/** Primera vez: crea el taller y la primera persona de gerencia, sin pegar SQL. */
export default async function Instalar() {
  const estado = await instalacionAbierta();
  const bloques = estado === "falta_base" ? await bloquesPendientes() : [];
  const act = estadoActualizador();
  const editor = urlEditorSql();
  return (
    <div className="min-h-dvh md:p-4 lg:p-5">
      <main className="flex min-h-dvh flex-col bg-lienzo px-5 py-8 md:min-h-[calc(100dvh-32px)] md:rounded-lienzo md:px-10 lg:min-h-[calc(100dvh-40px)]">
        <Logo />
        <div className="mx-auto my-auto w-full max-w-xl py-10">
          {estado === "abierta" ? (
            <>
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">Instalar Taller Control</h1>
              <p className="mt-2 text-[15px] text-tinta-2">Crea el taller y tu acceso de gerencia. Se hace una sola vez; después, el resto del personal se agrega desde la app.</p>
              <FormularioInstalar />
            </>
          ) : estado === "ya_instalado" ? (
            <>
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">El sistema ya está instalado</h1>
              <p className="mt-2 text-[15px] text-tinta-2">Entra con tu celular y tu contraseña. Ya puedes quitar CLAVE_INSTALACION de EasyPanel.</p>
              <Boton asChild className="mt-6">
                <Link href="/ingresar">Ir a ingresar</Link>
              </Boton>
            </>
          ) : estado === "falta_base" ? (
            <>
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">Primero hay que preparar la base de datos</h1>
              <p className="mt-2 text-[15px] text-tinta-2">
                {process.env.SUPABASE_DB_URL
                  ? "La app intentó crear las tablas sola y no pudo. Revisa la conexión (SUPABASE_DB_URL y SUPABASE_DB_PASSWORD) en EasyPanel y vuelve a tocar «Implementar»."
                  : "Lo más simple: pon SUPABASE_DB_URL y SUPABASE_DB_PASSWORD en EasyPanel y toca «Implementar»; la app crea las tablas sola. Si prefieres hacerlo a mano, copia cada paso y pégalo en el editor SQL de Supabase."}
              </p>
              {act?.modo === "automatico" && act.error ? (
                <p role="alert" className="mt-4 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
                  {act.error}
                </p>
              ) : null}
              <ol className="mt-6 flex flex-col gap-4">
                {bloques.map((b, i) => (
                  <li key={i} className="rounded-tarjeta bg-tarjeta p-5 shadow-reposo">
                    <p className="text-sm text-tinta-3">
                      Paso {i + 1} de {bloques.length}
                    </p>
                    <div className="mt-3">
                      <Copiar texto={b.sql} etiqueta={`Copiar el paso ${i + 1}`} />
                    </div>
                  </li>
                ))}
              </ol>
              {editor ? (
                <Boton asChild variante="secundario" className="mt-5">
                  <a href={editor} target="_blank" rel="noreferrer">
                    Abrir el editor SQL de Supabase
                  </a>
                </Boton>
              ) : null}
              <p className="mt-5 text-sm text-tinta-3">Cuando termines, recarga esta página.</p>
            </>
          ) : (
            <>
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">La instalación está cerrada</h1>
              <p className="mt-2 text-[15px] text-tinta-2">
                Para instalar un taller nuevo, pon en EasyPanel una línea CLAVE_INSTALACION con una frase de al menos 12 letras que solo tú sepas, toca «Implementar» y vuelve a esta página.
              </p>
              <Boton asChild variante="secundario" className="mt-6">
                <Link href="/ingresar">Ir a ingresar</Link>
              </Boton>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
