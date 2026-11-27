import { redirect } from "next/navigation";

/** El cobro de una orden vive en Caja → Órdenes y cobro (un solo lugar para cobrar). */
export default async function CobrarOrden({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/caja/cobro?orden=${encodeURIComponent(id)}`);
}
