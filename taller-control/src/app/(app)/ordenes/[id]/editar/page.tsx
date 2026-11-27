import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatearCelular } from "@/lib/celulares";
import { tieneAlguno } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";
import { catalogo, nombresPersonal, tecnicosMecanicos } from "@/lib/taller/consultas";
import { numeroOrden } from "@/lib/taller/estados";
import { FormularioIngreso, type Edicion } from "../../nueva/formulario";

export const metadata = { title: "Editar orden" };

/** Corregir la orden mientras el carro está en el taller (hasta que se entrega). */
export default async function EditarOrden({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await obtenerContexto();
  if (!tieneAlguno(ctx.roles, ["gerencia", "administrador", "asesor"])) notFound();
  const { id } = await params;
  const supabase = await clienteServidor();
  const { data: o } = await supabase
    .from("ordenes_trabajo")
    .select(
      "id, numero, estado, anulada, tecnico_id, kilometraje_ingreso, observaciones_ingreso, nivel_combustible, vehiculos (placa, marca, modelo, anio, color, combustible, carroceria), clientes (nombre, celular, tipo_documento, numero_documento, origen, acepta_mensajes), orden_servicios (servicio_id, descripcion, creado_en)",
    )
    .eq("id", id)
    .eq("empresa_id", ctx.taller.id)
    .maybeSingle();
  if (!o) notFound();

  const v = Array.isArray(o.vehiculos) ? o.vehiculos[0] : o.vehiculos;
  const cl = Array.isArray(o.clientes) ? o.clientes[0] : o.clientes;
  const cerrada = o.anulada || o.estado === "entregado";

  const [servicios, tecnicosBase, nombres] = await Promise.all([
    catalogo(ctx.taller.id),
    tecnicosMecanicos(ctx.taller.id),
    o.tecnico_id ? nombresPersonal(ctx.taller.id) : Promise.resolve(new Map<string, string>()),
  ]);
  // Si ya tenía asignada a alguien que no está en la lista, se conserva como opción.
  const tecnicos =
    o.tecnico_id && !tecnicosBase.some((t) => t.id === o.tecnico_id)
      ? [...tecnicosBase, { id: o.tecnico_id, nombre: nombres.get(o.tecnico_id) ?? "Asignado antes" }]
      : tecnicosBase;

  const edicion: Edicion = {
    ordenId: o.id,
    placa: v?.placa ?? "",
    cliente: {
      nombre: cl?.nombre ?? "",
      celular: cl?.celular ? formatearCelular(cl.celular) : "",
      tipoDocumento: cl?.tipo_documento ?? "ninguno",
      numeroDocumento: cl?.numero_documento ?? "",
      origen: cl?.origen ?? "otro",
      aceptaMensajes: Boolean(cl?.acepta_mensajes),
    },
    vehiculo: {
      marca: v?.marca ?? "",
      modelo: v?.modelo ?? "",
      anio: v?.anio ? String(v.anio) : "",
      color: v?.color ?? "",
      combustible: v?.combustible ?? "",
      carroceria: v?.carroceria ?? "",
    },
    kilometraje: o.kilometraje_ingreso != null ? String(o.kilometraje_ingreso) : "",
    nivel: o.nivel_combustible != null ? String(o.nivel_combustible) : "",
    observaciones: o.observaciones_ingreso ?? "",
    tecnicoId: o.tecnico_id ?? "",
    servicios: [...(o.orden_servicios ?? [])]
      .sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)))
      .map((s) => ({ id: s.servicio_id, descripcion: s.descripcion })),
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header>
        <Link href={`/ordenes/${o.id}`} className="inline-flex min-h-11 items-center gap-1.5 text-[15px] text-tinta-2 hover:text-tinta">
          <ArrowLeft className="size-4" aria-hidden />
          Volver a la orden
        </Link>
        <h1 className="mt-1 text-[26px] leading-tight font-semibold tracking-[-0.025em] md:text-[32px]">Editar {numeroOrden(o.numero)}</h1>
        <p className="mt-1.5 text-[15px] text-tinta-2 md:text-base">
          Corrige lo que haga falta mientras el carro está en el taller. La hora de entrega y las fotos se cambian en la orden.
        </p>
      </header>
      {cerrada ? (
        <p className="rounded-2xl bg-aviso-fondo px-4 py-3 text-[15px] text-aviso">
          {o.anulada ? "Esta orden está anulada" : "El carro ya se entregó"}: la orden ya no se edita.
        </p>
      ) : (
        <FormularioIngreso ahora={new Date().toISOString()} servicios={servicios.map((s) => ({ id: s.id, nombre: s.nombre }))} tecnicos={tecnicos} cita={null} edicion={edicion} />
      )}
    </div>
  );
}
