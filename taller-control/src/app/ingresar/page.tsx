import { Logo } from "@/components/marca/logo";
import { Placa } from "@/components/marca/placa";
import { FormularioIngreso } from "./formulario";

export const metadata = { title: "Ingresar" };

const MOTIVOS: Record<string, string> = {
  inactivo: "Tu acceso está desactivado. Habla con administración.",
  "sin-taller": "Todavía no tienes un taller asignado. Pide a administración que te asigne uno.",
  instalado: "¡Listo! El taller quedó creado. Entra con tu celular y la contraseña que acabas de poner.",
};

export default async function Ingresar({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const { motivo } = await searchParams;
  const aviso = motivo ? MOTIVOS[motivo] : undefined;

  return (
    <div className="grid min-h-dvh md:p-4 lg:grid-cols-[1.05fr_1fr] lg:gap-4 lg:p-5">
      {/* Panel de marca (computadora) */}
      <section
        aria-hidden
        className="relative hidden overflow-hidden rounded-lienzo bg-acento p-10 text-acento-tinta lg:flex lg:flex-col"
      >
        <Logo className="[&_circle:first-child]:fill-[#1a1a1a] [&_path]:stroke-[var(--acento)] [&_circle:last-child]:fill-[var(--acento)]" />
        <div className="mt-auto max-w-md">
          <p className="text-[40px] leading-[1.05] font-semibold tracking-[-0.03em]">Todo el taller, en tu celular.</p>
          <p className="mt-4 text-[17px] leading-7">
            Ingresos, avances, citas, compras y cobros en un solo lugar. Con un toque, una foto o un audio.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2">
            {["BKR-472", "F7Q-315", "C3T-764", "V2P-086"].map((p) => (
              <li key={p}>
                <Placa placa={p} className="h-8 px-2.5 text-[14px]" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Formulario */}
      <main className="flex flex-col bg-lienzo px-5 py-8 md:rounded-lienzo md:px-10">
        <Logo className="lg:hidden" />
        <div className="my-auto w-full max-w-sm self-center py-10">
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.025em]">Ingresar</h1>
          <p className="mt-2 text-[15px] text-tinta-2">Con tu celular y la contraseña que te dio administración.</p>
          {aviso ? (
            <p
              role={motivo === "instalado" ? "status" : "alert"}
              className={motivo === "instalado" ? "mt-5 rounded-2xl bg-positivo-fondo px-4 py-3 text-sm text-positivo" : "mt-5 rounded-2xl border border-aviso-borde bg-aviso-fondo px-4 py-3 text-sm text-aviso"}
            >
              {aviso}
            </p>
          ) : null}
          <FormularioIngreso />
          <p className="mt-6 text-sm text-tinta-2">¿Olvidaste tu contraseña? Pide a administración que te asigne una nueva.</p>
        </div>
      </main>
    </div>
  );
}
