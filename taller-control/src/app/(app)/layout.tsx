import { BarraSuperior } from "@/components/armazon/barra-superior";
import { BarraInferior, BarraLateral } from "@/components/armazon/barras-de-acciones";
import { accionesPara, gestionPara, seccionesPara } from "@/lib/navegacion";
import { NOMBRE_ROL } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const ctx = await obtenerContexto();
  const secciones = seccionesPara(ctx.roles);
  const acciones = accionesPara(ctx.roles);
  const gestion = gestionPara(ctx.roles);

  return (
    <div className="min-h-dvh md:p-4 lg:p-5">
      <div className="min-h-dvh bg-lienzo px-4 pt-4 pb-32 md:min-h-[calc(100dvh-32px)] md:rounded-lienzo md:px-6 md:pt-5 md:pb-8 lg:min-h-[calc(100dvh-40px)]">
        <BarraSuperior
          nombre={ctx.perfil.nombre}
          rol={NOMBRE_ROL[ctx.rolPrincipal]}
          talleres={ctx.talleres.map(({ id, nombre }) => ({ id, nombre }))}
          tallerId={ctx.taller.id}
          secciones={secciones}
        />
        <div className="mt-6 flex gap-6">
          <BarraLateral acciones={acciones} gestion={gestion} />
          <main id="contenido" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
      <BarraInferior acciones={acciones} gestion={gestion} />
    </div>
  );
}
