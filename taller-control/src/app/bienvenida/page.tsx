import { redirect } from "next/navigation";
import { Logo } from "@/components/marca/logo";
import { obtenerContexto } from "@/lib/sesion";
import { FormularioBienvenida } from "./formulario";

export const metadata = { title: "Bienvenida" };

export default async function Bienvenida() {
  const ctx = await obtenerContexto();
  if (!ctx.perfil.debeCambiarClave) redirect("/");
  return (
    <div className="grid min-h-dvh place-items-center bg-lienzo px-4 py-10">
      <div className="w-full max-w-md rounded-[28px] bg-tarjeta p-6 shadow-reposo md:p-8">
        <Logo />
        <h1 className="mt-6 text-[26px] leading-tight font-semibold tracking-[-0.025em]">Hola, {ctx.perfil.nombre.split(" ")[0]}</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2">Entraste con una contraseña temporal. Elige tu usuario y tu propia contraseña: con ellos entrarás desde ahora.</p>
        <FormularioBienvenida usuario={ctx.perfil.usuario ?? ""} />
      </div>
    </div>
  );
}
