import "server-only";
import { clienteAdmin } from "@/lib/supabase/admin";

/**
 * Corte de medianoche de las cajas. El reloj de la app lo llama cada 5 minutos; solo trabaja
 * cuando toca: si quedó una caja abierta de un día anterior, o si el día anterior tuvo cajas
 * y todavía no tiene su Caja Maestra. Así, aunque el servidor esté apagado a las 00:00,
 * el corte se hace apenas vuelve.
 *
 * - Cierra lo olvidado con el saldo del sistema (cierre automático, arqueo pendiente).
 * - Arma la Caja Maestra del día anterior (Recepción + Almacén).
 * - Avisa a gerencia en el celular si hubo cierres automáticos.
 */
export async function corteSiToca(ahora = new Date()): Promise<{ empresas: number; cerradas: number } | null> {
  const admin = clienteAdmin();
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(ahora);
  const ayer = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(ahora.getTime() - 86_400_000));

  const [{ data: olvidadas }, { data: deAyer }, { data: maestras }] = await Promise.all([
    admin.from("cajas").select("empresa_id").eq("estado", "abierta").lt("fecha", hoy),
    admin.from("cajas").select("empresa_id").eq("fecha", ayer),
    admin.from("caja_maestra_diaria").select("empresa_id").eq("fecha", ayer),
  ]);
  const yaTienen = new Set((maestras ?? []).map((m) => m.empresa_id));
  const empresas = new Set([...(olvidadas ?? []).map((c) => c.empresa_id), ...(deAyer ?? []).map((c) => c.empresa_id).filter((e) => !yaTienen.has(e))]);
  if (!empresas.size) return null;

  let cerradas = 0;
  for (const empresa of empresas) {
    const { data, error } = await admin.rpc("corte_medianoche", { p_empresa: empresa, p_hoy: hoy });
    if (error) {
      console.error("[caja] El corte de medianoche falló:", error.message);
      continue;
    }
    const n = Number((data as { cerradas?: number } | null)?.cerradas ?? 0);
    cerradas += n;
    if (n > 0) await avisarGerencia(empresa, n, hoy).catch(() => {});
  }
  return { empresas: empresas.size, cerradas };
}

async function avisarGerencia(empresa: string, cerradas: number, hoy: string) {
  const admin = clienteAdmin();
  const { data } = await admin.from("miembros").select("perfil_id").eq("empresa_id", empresa).in("rol", ["gerencia", "administrador"]).eq("activo", true);
  const vistos = new Set<string>();
  const filas = (data ?? [])
    .filter((m) => !vistos.has(m.perfil_id) && vistos.add(m.perfil_id))
    .map((m) => ({
      empresa_id: empresa,
      tipo: "caja_cierre_automatico",
      destino: "personal",
      perfil_id: m.perfil_id,
      canal: "push",
      titulo: cerradas === 1 ? "Una caja se cerró sola a las 00:00" : `${cerradas} cajas se cerraron solas a las 00:00`,
      texto: "Nadie la cerró antes de medianoche: quedó con el saldo del sistema. Cuenta el efectivo y registra el arqueo en la Caja Maestra.",
      enlace: "/caja/maestra",
      clave_unica: `caja-00h:${empresa}:${hoy}:${m.perfil_id}`,
    }));
  if (filas.length) await admin.from("avisos").upsert(filas, { onConflict: "clave_unica", ignoreDuplicates: true });
}
