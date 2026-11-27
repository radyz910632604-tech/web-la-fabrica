import { describe, expect, it } from "vitest";
import { estadoPago } from "@/lib/dinero";

describe("estado de pago de la orden", () => {
  it("sin precio todavía", () => expect(estadoPago({ aCobrar: 0, pagado: 0 })).toBe("sin_precio"));
  it("adelanto sin precio: parcial", () => expect(estadoPago({ aCobrar: 0, pagado: 50 })).toBe("parcial"));
  it("S/ 500 sin pagos: pendiente", () => expect(estadoPago({ aCobrar: 500, pagado: 0 })).toBe("pendiente"));
  it("S/ 500 con S/ 200: parcial", () => expect(estadoPago({ aCobrar: 500, pagado: 200 })).toBe("parcial"));
  it("S/ 500 con 200 + 200 + 100: pagada", () => expect(estadoPago({ aCobrar: 500, pagado: 200 + 200 + 100 })).toBe("pagada"));
  it("pagó de más: a favor", () => expect(estadoPago({ aCobrar: 500, pagado: 520 })).toBe("a_favor"));
  it("céntimos de redondeo no lo dejan pendiente", () => expect(estadoPago({ aCobrar: 380.1, pagado: 380.1 })).toBe("pagada"));
});
