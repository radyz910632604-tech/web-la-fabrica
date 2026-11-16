import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Antes de cada página: renueva la sesión de Supabase y manda a /ingresar
 * a quien no inició sesión. (En Next.js 16 "middleware" se llama "proxy".)
 */
export async function proxy(request: NextRequest) {
  let respuesta = NextResponse.next({ request });

  const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) request.cookies.set(name, value);
        respuesta = NextResponse.next({ request });
        for (const { name, value, options } of lista) respuesta.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const conSesion = Boolean(data?.claims?.sub);
  const ruta = request.nextUrl.pathname;
  const esIngreso = ruta === "/ingresar";

  if (!conSesion && !esIngreso) {
    return redirigir(request, respuesta, "/ingresar");
  }
  if (conSesion && esIngreso && !request.nextUrl.searchParams.has("motivo")) {
    return redirigir(request, respuesta, "/");
  }
  return respuesta;
}

function redirigir(request: NextRequest, respuesta: NextResponse, destino: string) {
  const url = request.nextUrl.clone();
  url.pathname = destino;
  url.search = "";
  const redireccion = NextResponse.redirect(url);
  for (const cookie of respuesta.cookies.getAll()) redireccion.cookies.set(cookie);
  return redireccion;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|iconos/|.*\\.(?:svg|png|jpg|jpeg|webp|ico|woff2?)$).*)"],
};
