import {
  Banknote,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  Camera,
  CarFront,
  ChartColumn,
  ClipboardList,
  LayoutGrid,
  Package,
  ReceiptText,
  Receipt,
  Vault,
  Settings,
  UserCog,
  Users,
  Wallet,
  Wrench,
  type LucideProps,
} from "lucide-react";
import type { Icono as NombreIcono } from "@/lib/navegacion";

const ICONOS = {
  panel: LayoutGrid,
  ordenes: ClipboardList,
  citas: CalendarDays,
  clientes: Users,
  reportes: ChartColumn,
  caja: Wallet,
  "caja-dia": Vault,
  comprobante: Receipt,
  compras: ReceiptText,
  "nuevo-ingreso": CarFront,
  pago: Banknote,
  agendar: CalendarPlus,
  avance: Wrench,
  fotos: Camera,
  repuesto: Package,
  confirmar: CalendarCheck,
  usuarios: UserCog,
  configuracion: Settings,
} satisfies Record<NombreIcono, unknown>;

export function Icono({ nombre, ...props }: { nombre: NombreIcono } & LucideProps) {
  const Componente = ICONOS[nombre];
  return <Componente strokeWidth={1.75} aria-hidden {...props} />;
}
