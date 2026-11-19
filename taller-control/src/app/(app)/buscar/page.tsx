import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Placa } from "@/components/marca/placa";
import { ListaOrdenes } from "@/components/taller/lista-ordenes";
import { CabeceraTarjeta, Tarjeta } from "@/components/ui/tarjeta";
import { formatearCelular } from "@/lib/celulares";
import { normalizarPlaca } from "@/lib/placas";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { listarOrdenes, type FilaOrden } from "@/lib/taller/consultas";

export const metadata = { title: "Buscar" };

export default async function Buscar({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await obtenerContexto();
  const { q = "" } = await searchParams;
  const texto = q.trim().slice(0, 60);
  const supabase = await clienteServidor();
  const verClientes = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "vendedor_redes", "confirmador", "recepcion"]);
  const verOrdenes = tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "almacen", "tecnico", "recepcion"]);

  let vehiculos: { id: string; placa: string; marca: string | null; modelo: string | null }[] = [];
  let clientes: { id: string; nombre: string; celular: string }[] = [];
  let ordenes: FilaOrden[] = [];

  if (texto.length >= 2) {
    const placa = normalizarPlaca(texto);
    const digitos = texto.replace(/\D/g, "");
    const numero = /^(ot-?)?\d{1,6}$/i.test(texto.replace(/\s/g, "")) ? Number(digitos) : null;
    const seguro = texto.replace(/[%_,()]/g, " ");
    const [v, c, o] = await Promise.all([
      placa.length >= 2
        ? supabase.from("vehiculos").select("id, placa, marca, modelo").eq("empresa_id", ctx.taller.id).ilike("placa", `%${placa}%`).limit(10)
        : Promise.resolve({ data: [] }),
      verClientes
        ? supabase
            .from("clientes")
            .select("id, nombre, celular")
            .eq("empresa_id", ctx.taller.id)
            .or(digitos.length >= 3 ? `nombre.ilike.%${seguro}%,celular.like.%${digitos}%` : `nombre.ilike.%${seguro}%`)
            .limit(10)
        : Promise.resolve({ data: [] }),
      verOrdenes && numero ? listarOrdenes(ctx.taller.id, { limite: 300 }) : Promise.resolve([]),
    ]);
    vehiculos = v.data ?? [];
    clientes = c.data ?? [];
    ordenes = numero ? o.filter((x) => x.numero === numero) : [];
  }
  const nada = texto.length >= 2 && vehiculos.length + clientes.length + ordenes.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Buscar</h1>
        <form action="/buscar" className="relative mt-4 max-w-xl">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-tinta-3" />
          <input
            type="search"
            name="q"
            defaultValue={texto}
            autoFocus
            placeholder={verClientes ? "Placa, nombre, celular o número de orden" : "Placa o número de orden"}
            aria-label="Qué buscar"
            className="h-14 w-full rounded-full border border-borde bg-tarjeta pr-4 pl-12 text-[17px] outline-none placeholder:text-tinta-3 focus-visible:border-tinta"
          />
        </form>
      </header>
      {texto.length > 0 && texto.length < 2 ? <p className="text-tinta-2">Escribe al menos 2 letras o números.</p> : null}
      {nada ? <p className="text-[15px] text-tinta-2">No se encontró nada con «{texto}».</p> : null}
      {vehiculos.length > 0 ? (
        <Tarjeta aria-labelledby="r-carros">
          <CabeceraTarjeta id="r-carros" titulo="Carros" />
          <ul className="flex flex-col gap-2">
            {vehiculos.map((v) => (
              <li key={v.id}>
                <Link href={`/vehiculos/${v.placa}`} className="flex items-center gap-3 rounded-2xl bg-interna px-3 py-2.5 hover:bg-hundida">
                  <Placa placa={v.placa} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{[v.marca, v.modelo].filter(Boolean).join(" ") || "Sin datos"}</span>
                  <ChevronRight className="size-5 text-tinta-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}
      {clientes.length > 0 ? (
        <Tarjeta aria-labelledby="r-clientes">
          <CabeceraTarjeta id="r-clientes" titulo="Clientes" />
          <ul className="flex flex-col gap-2">
            {clientes.map((c) => (
              <li key={c.id}>
                <Link href={`/clientes/${c.id}`} className="flex items-center gap-3 rounded-2xl bg-interna px-4 py-3 hover:bg-hundida">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{c.nombre}</span>
                  <span className="num text-[14px] text-tinta-2">{formatearCelular(c.celular)}</span>
                  <ChevronRight className="size-5 text-tinta-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}
      {ordenes.length > 0 ? (
        <Tarjeta aria-labelledby="r-ordenes">
          <CabeceraTarjeta id="r-ordenes" titulo="Órdenes" />
          <ListaOrdenes ordenes={ordenes} verCliente={tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor", "recepcion"])} vacio="" />
        </Tarjeta>
      ) : null}
    </div>
  );
}
