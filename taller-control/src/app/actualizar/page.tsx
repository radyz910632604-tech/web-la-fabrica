import { redirect } from "next/navigation";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Copiar } from "@/components/base/copiar";
import { Logo } from "@/components/marca/logo";
import { Boton } from "@/components/ui/boton";
import { estadoActualizador } from "@/lib/base/aplicar";
import { bloquesPendientes, urlEditorSql, versionesFaltantes } from "@/lib/base/esquema";
import { clienteServidor } from "@/lib/supabase/servidor";
import { revisarBase } from "./acciones";

export const metadata = { title: "Actualizar la base de datos" };
export const dynamic = "force-dynamic";

/**
 * Aparece cuando la app es más nueva que la base de datos. Gerencia ve qué
 * pegar en Supabase (o el error del actualizador automático); el resto del
 * personal solo ve que el sistema se está actualizando.
 */
export default async function Actualizar() {
  if (!(await versionesFaltantes()).length) redirect("/");
  const supabase = await clienteServidor();
  const { data: sesion } = await supabase.auth.getClaims();
  const uid = sesion?.claims?.sub;
  if (!uid) redirect("/ingresar");
  const { data: roles } = await supabase.from("miembros").select("rol").eq("perfil_id", uid).eq("activo", true);
  const esGerencia = (roles ?? []).some((r) => r.rol === "gerencia" || r.rol === "administrador");
  const bloques = esGerencia ? await bloquesPendientes() : [];
  const act = estadoActualizador();
  const editor = urlEditorSql();

  return (
    <div className="min-h-dvh md:p-4 lg:p-5">
      <main className="flex min-h-dvh flex-col bg-lienzo px-5 py-8 md:min-h-[calc(100dvh-32px)] md:rounded-lienzo md:px-10 lg:min-h-[calc(100dvh-40px)]">
        <Logo />
        <div className="mx-auto my-auto w-full max-w-2xl py-10">
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">{esGerencia ? "Falta actualizar la base de datos" : "Estamos actualizando el sistema"}</h1>
          {!esGerencia ? (
            <p className="mt-3 text-[17px] text-tinta-2">Vuelve a entrar en unos minutos. Si sigue así, avísale a gerencia.</p>
          ) : (
            <>
              <p className="mt-3 text-[17px] text-tinta-2">
                La app tiene mejoras nuevas y la base de datos todavía no. Tus datos están intactos: solo falta agregar lo nuevo. Mientras tanto nadie puede registrar, para que nada quede a medias.
              </p>
              {act?.modo === "automatico" && act.error ? (
                <p role="alert" className="mt-5 rounded-2xl bg-negativo-fondo px-4 py-3 text-sm text-negativo">
                  La actualización automática no pudo terminar. {act.error}
                </p>
              ) : null}
              <ol className="mt-7 flex flex-col gap-4">
                {bloques.map((b, i) => (
                  <li key={i} className="rounded-tarjeta bg-tarjeta p-5 shadow-reposo md:p-6">
                    <p className="text-sm text-tinta-3">
                      Paso {i + 1} de {bloques.length}
                    </p>
                    <h2 className="mt-0.5 text-[17px] font-semibold">{b.titulo}</h2>
                    <div className="mt-4">
                      <Copiar texto={b.sql} etiqueta={bloques.length > 1 ? `Copiar el paso ${i + 1}` : "Copiar la actualización"} />
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-6 rounded-tarjeta bg-tarjeta p-5 shadow-reposo md:p-6">
                <h2 className="text-[17px] font-semibold">Cómo se hace</h2>
                <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-[15px] text-tinta-2">
                  <li>Toca el botón «Copiar» de arriba.</li>
                  <li>Abre el editor SQL de Supabase, borra lo que haya, pega con Ctrl + V y toca «Run». Debe decir «Success».</li>
                  {bloques.length > 1 ? <li>Repite con cada paso, en orden.</li> : null}
                  <li>Vuelve aquí y toca «Ya lo hice».</li>
                </ol>
                <div className="mt-5 flex flex-wrap gap-3">
                  {editor ? (
                    <Boton asChild variante="secundario">
                      <a href={editor} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        Abrir el editor SQL
                      </a>
                    </Boton>
                  ) : null}
                  <form action={revisarBase}>
                    <Boton type="submit">
                      <RefreshCw />
                      Ya lo hice
                    </Boton>
                  </form>
                </div>
                <p className="mt-5 text-sm text-tinta-3">
                  Para no repetir esto nunca más: pon la conexión de la base (SUPABASE_DB_URL) en EasyPanel y la app la actualizará sola cada vez que toques «Implementar». Está explicado en Configuración → Estado del sistema.
                </p>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
