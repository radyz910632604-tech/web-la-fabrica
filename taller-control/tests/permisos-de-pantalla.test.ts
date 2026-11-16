import { describe, expect, it } from "vitest";
import { accionesPara, gestionPara, seccionesPara } from "@/lib/navegacion";
import { vistaPanel } from "@/lib/panel/vista";
import { esGestor, rolesAsignables, ROLES } from "@/lib/roles";

const claves = (lista: { clave: string }[]) => lista.map((d) => d.clave);
const sinPermisoExtra = { adminVeUtilidad: false };

describe("qué ve cada rol en el panel (especificación, sección 4)", () => {
  it("gerencia ve todo, incluida la utilidad", () => {
    const v = vistaPanel(["gerencia"], sinPermisoExtra);
    expect(v.indicadores).toEqual(["ventas", "compras", "utilidad", "entregados"]);
    expect(v.grafico).toBe(true);
    expect(v.columnas).toEqual({ cliente: true, monto: true });
  });

  it("administración no ve la utilidad, salvo que gerencia lo permita", () => {
    expect(vistaPanel(["administrador"], sinPermisoExtra).indicadores).not.toContain("utilidad");
    expect(vistaPanel(["administrador"], sinPermisoExtra).grafico).toBe(false);
    expect(vistaPanel(["administrador"], { adminVeUtilidad: true }).indicadores).toContain("utilidad");
  });

  it("el asesor ve ventas y cobros pero nunca la utilidad", () => {
    const v = vistaPanel(["asesor"], { adminVeUtilidad: true });
    expect(v.indicadores).not.toContain("utilidad");
    expect(v.grafico).toBe(false);
    expect(v.acciones.registrarPago).toBe(true);
  });

  it("el técnico no ve precios, costos ni clientes", () => {
    const v = vistaPanel(["tecnico"], sinPermisoExtra);
    expect(v.indicadores).not.toContain("ventas");
    expect(v.indicadores).not.toContain("compras");
    expect(v.columnas).toEqual({ cliente: false, monto: false });
    expect(v.destacada).toBe("mis_trabajos");
  });

  it("almacén ve compras pero no ventas", () => {
    const v = vistaPanel(["almacen"], sinPermisoExtra);
    expect(v.indicadores).toContain("compras");
    expect(v.indicadores).not.toContain("ventas");
    expect(v.meta).toBe(false);
    expect(v.columnas.monto).toBe(false);
  });

  it("ventas por redes y confirmación no ven costos", () => {
    for (const rol of ["vendedor_redes", "confirmador"] as const) {
      const v = vistaPanel([rol], sinPermisoExtra);
      expect(v.indicadores).not.toContain("compras");
      expect(v.indicadores).not.toContain("utilidad");
      expect(v.destacada).toBe("citas_hoy");
    }
  });

  it("con dos roles se suma lo que permite cada uno", () => {
    const v = vistaPanel(["tecnico", "asesor"], sinPermisoExtra);
    expect(v.indicadores).toContain("ventas");
    expect(v.columnas.monto).toBe(true);
  });
});

describe("navegación", () => {
  it("cada rol tiene el panel", () => {
    for (const rol of ROLES) expect(claves(seccionesPara([rol]))).toContain("panel");
  });

  it("los reportes son solo de gerencia", () => {
    expect(claves(seccionesPara(["gerencia"]))).toContain("reportes");
    for (const rol of ROLES.filter((r) => r !== "gerencia")) expect(claves(seccionesPara([rol]))).not.toContain("reportes");
  });

  it("el técnico tiene sus trabajos, no la lista de órdenes ni de clientes", () => {
    const s = claves(seccionesPara(["tecnico"]));
    expect(s).toContain("mis-trabajos");
    expect(s).not.toContain("ordenes");
    expect(s).not.toContain("clientes");
    expect(claves(accionesPara(["tecnico"]))).toEqual(["reportar-avance", "subir-fotos"]);
  });

  it("solo gerencia y administración ven personal y configuración", () => {
    expect(claves(gestionPara(["gerencia"]))).toEqual(["usuarios", "whatsapp", "configuracion"]);
    expect(claves(gestionPara(["administrador"]))).toEqual(["usuarios", "whatsapp", "configuracion"]);
    for (const rol of ["asesor", "tecnico", "almacen", "vendedor_redes", "confirmador"] as const) {
      expect(gestionPara([rol])).toEqual([]);
    }
  });
});

describe("roles que se pueden asignar", () => {
  it("gerencia asigna cualquiera; administración, todos menos gerencia; el resto, ninguno", () => {
    expect(rolesAsignables(["gerencia"])).toEqual([...ROLES]);
    expect(rolesAsignables(["administrador"])).not.toContain("gerencia");
    expect(rolesAsignables(["administrador"])).toHaveLength(ROLES.length - 1);
    expect(rolesAsignables(["asesor"])).toEqual([]);
    expect(esGestor(["asesor"])).toBe(false);
  });
});

describe("Entrega 1B: lo construido ya no apunta a «Próximamente»", () => {
  const todos = (rol: Parameters<typeof seccionesPara>[0][number]) => [...seccionesPara([rol]), ...accionesPara([rol])];
  it.each([
    ["ordenes", "/ordenes"],
    ["citas", "/citas"],
    ["clientes", "/clientes"],
    ["nuevo-ingreso", "/ordenes/nueva"],
  ])("%s lleva a %s", (clave, href) => {
    const d = todos("gerencia").find((x) => x.clave === clave) ?? todos("asesor").find((x) => x.clave === clave);
    expect(d?.href.startsWith(href)).toBe(true);
  });
  it("el técnico va a sus trabajos para avances y fotos", () => {
    for (const d of todos("tecnico")) expect(d.href.startsWith("/pronto")).toBe(false);
  });
  it("el dinero ya tiene sus pantallas: caja, compras y reportes", () => {
    expect(accionesPara(["asesor"]).find((d) => d.clave === "registrar-pago")?.href).toBe("/cobros?nuevo=1");
    expect(seccionesPara(["administrador"]).find((d) => d.clave === "caja")?.href).toBe("/caja");
    expect(accionesPara(["almacen"]).map((d) => d.href)).toEqual(["/compras/nueva", "/inventario"]);
    expect(seccionesPara(["gerencia"]).find((d) => d.clave === "reportes")?.href).toBe("/reportes");
  });
  it("ningún rol ve botones que lleven a «Próximamente»", () => {
    for (const rol of ROLES) {
      for (const d of todos(rol)) expect(d.href.startsWith("/pronto")).toBe(false);
    }
  });
  it("el técnico, el vendedor y el confirmador no ven la caja", () => {
    for (const rol of ["tecnico", "vendedor_redes", "confirmador"] as const) expect(todos(rol).some((d) => d.clave === "caja" || d.clave === "registrar-pago")).toBe(false);
  });
});

describe("recepción y caja", () => {
  const todos = [...seccionesPara(["recepcion"]), ...accionesPara(["recepcion"])].map((d) => d.clave);
  it("abre y cierra la caja, cobra y registra comprobantes", () => {
    expect(todos).toEqual(expect.arrayContaining(["panel", "ordenes", "clientes", "caja", "registrar-pago", "caja-del-dia", "registrar-comprobante"]));
  });
  it("no registra ingresos, no compra y no ve reportes", () => {
    for (const clave of ["nuevo-ingreso", "compras", "registrar-compra", "reportes", "usuarios"]) expect(todos).not.toContain(clave);
    expect(gestionPara(["recepcion"])).toEqual([]);
  });
  it("en el panel ve el taller y las ventas, pero no la utilidad ni las compras", () => {
    const v = vistaPanel(["recepcion"], { adminVeUtilidad: true });
    expect(v.destacada).toBe("taller");
    expect(v.indicadores).toEqual(["ventas", "entregados"]);
    expect(v.acciones).toEqual({ nuevoIngreso: false, registrarPago: true });
    expect(v.grafico).toBe(false);
  });
});
