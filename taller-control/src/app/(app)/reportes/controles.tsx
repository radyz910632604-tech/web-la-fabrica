"use client";

import { useRouter } from "next/navigation";
import { Selector } from "@/components/ui/campo";

export function ElegirMes({ mes, meses, ambito }: { mes: string; meses: { valor: string; nombre: string }[]; ambito: string }) {
  const router = useRouter();
  return (
    <Selector aria-label="Mes" value={mes} onChange={(e) => router.push(`/reportes?mes=${e.target.value}${ambito ? `&ambito=${ambito}` : ""}`)} className="h-12 w-auto min-w-44">
      {meses.map((m) => (
        <option key={m.valor} value={m.valor}>
          {m.nombre}
        </option>
      ))}
    </Selector>
  );
}
