import { describe, expect, it } from "vitest";
import { aDocumento, aFecha, aNumero, detectarColumnas, faltanObligatorios, filaDeTitulos, validarFila } from "@/lib/importar/reglas";

describe("importar: convertir celdas", () => {
  it("montos como los escribe la gente", () => {
    expect(aNumero("S/ 1,234.50")).toBe(1234.5);
    expect(aNumero("1.234,50")).toBe(1234.5);
    expect(aNumero("85 000")).toBe(85000);
    expect(aNumero("85mil")).toBe(85000);
    expect(aNumero("150")).toBe(150);
    expect(aNumero("12,5")).toBe(12.5);
    expect(aNumero("1,200")).toBe(1200);
    expect(aNumero("abc")).toBeNull();
    expect(aNumero("")).toBeNull();
  });
  it("fechas de Excel, dd/mm/aaaa y AAAA-MM-DD", () => {
    expect(aFecha("15/11/2026")).toBe("2026-11-15");
    expect(aFecha("5-3-25")).toBe("2025-03-05");
    expect(aFecha("2026-01-31T00:00:00.000Z")).toBe("2026-01-31");
    expect(aFecha("46341")).toBe("2026-11-15"); // número de serie de Excel
    expect(aFecha("31/02/2026")).toBeNull();
    expect(aFecha("mañana")).toBeNull();
  });
  it("DNI, RUC y el cero que Excel le quita al DNI", () => {
    expect(aDocumento("40123456")).toEqual({ tipo: "dni", numero: "40123456" });
    expect(aDocumento("4012345")).toEqual({ tipo: "dni", numero: "04012345" });
    expect(aDocumento("20123456789")).toEqual({ tipo: "ruc", numero: "20123456789" });
    expect(aDocumento("123")).toBeNull();
  });
});

describe("importar: reconocer columnas", () => {
  const filas = [
    ["REPORTE DE CLIENTES 2025", "", "", ""],
    ["", "", "", ""],
    ["N°", "Cliente", "Teléfono", "DNI/RUC", "Placa", "Marca", "Modelo", "Año", "KM"],
    ["1", "Juan Pérez", "987 654 321", "40123456", "abc-123", "Toyota", "Yaris", "2018", "85,000"],
  ];
  it("encuentra la fila de títulos aunque haya un encabezado arriba", () => {
    expect(filaDeTitulos(filas, "clientes")).toBe(2);
  });
  it("asigna cada columna a su dato", () => {
    const m = detectarColumnas(filas[2], "clientes");
    expect(m).toMatchObject({ nombre: 1, celular: 2, documento: 3, placa: 4, marca: 5, modelo: 6, anio: 7, kilometraje: 8 });
    expect(faltanObligatorios("clientes", m)).toEqual([]);
  });
  it("convierte la fila en datos para guardar", () => {
    const m = detectarColumnas(filas[2], "clientes");
    const v = validarFila("clientes", filas[3], m, 4);
    expect(v.ok).toBe(true);
    expect(v.datos).toMatchObject({ placa: "ABC123", celular: "+51987654321", nombre: "Juan Pérez", documento: { tipo: "dni", numero: "40123456" }, anio: 2018, kilometraje: 85000 });
  });
  it("sin celular válido guarda solo el carro, y avisa", () => {
    const m = detectarColumnas(filas[2], "clientes");
    const v = validarFila("clientes", ["2", "Ana Ruiz", "12345", "", "B7K-789", "Kia", "Rio", "", ""], m, 5);
    expect(v.ok).toBe(true);
    expect(v.datos.celular).toBeUndefined();
    expect(v.avisos.join(" ")).toContain("se guarda solo el carro");
  });
  it("una fila sin placa ni celular no se importa", () => {
    const m = detectarColumnas(filas[2], "clientes");
    expect(validarFila("clientes", ["3", "Sin datos", "", "", "", "", "", "", ""], m, 6).ok).toBe(false);
  });
});

describe("importar: inventario y gastos", () => {
  it("inventario: el costo con IGV se guarda sin IGV", () => {
    const m = detectarColumnas(["Código", "Descripción", "Stock", "Costo", "Precio venta", "Unidad"], "inventario");
    const v = validarFila("inventario", ["fil ace-01", "Filtro de aceite", "12", "S/ 23.60", "35.40", "und"], m, 2);
    expect(v.ok).toBe(true);
    expect(v.datos).toMatchObject({ codigo: "FIL-ACE-01", nombre: "Filtro de aceite", stock: 12, costo_sin_igv: 20, precio_sin_igv: 30, unidad: "unidad" });
  });
  it("gastos: reconoce la categoría por el concepto", () => {
    const m = detectarColumnas(["Fecha", "Concepto", "Monto", "Forma de pago"], "gastos");
    const v = validarFila("gastos", ["05/11/2026", "Pago de luz Luz del Sur", "S/ 320.00", "Yape"], m, 2);
    expect(v.ok).toBe(true);
    expect(v.datos).toMatchObject({ fecha: "2026-11-05", categoria: "luz", monto: 320, medio: "yape" });
    expect(validarFila("gastos", ["", "Algo", "10", ""], m, 3).errores).toContain("Sin fecha");
  });
});
