"use server";

import { revalidatePath } from "next/cache";
import { desdeTotal } from "@/lib/dinero";
import { simple, validarFila, type Mapa, type TipoImportacion, TIPOS_IMPORTACION } from "@/lib/importar/reglas";
import { esGestor } from "@/lib/roles";
import { obtenerContexto } from "@/lib/sesion";
import { clienteServidor } from "@/lib/supabase/servidor";

/**
 * Importar el Excel anterior del taller. El archivo no se guarda: se lee aquí,
 * se devuelve a la pantalla para revisarlo y vuelve por lotes ya mapeado.
 * Todo se guarda con la sesión de quien importa (la base revisa su permiso) y
 * se vuelve a validar aquí, sin confiar en lo que mande el navegador.
 */

const MAX_FILAS = 5000;
const MAX_COLUMNAS = 40;

export type Hoja = { nombre: string; filas: string[][] };
export type Lectura = { hojas?: Hoja[]; error?: string };

async function puedeImportar() {
  const ctx = await obtenerContexto();
  return esGestor(ctx.roles) ? ctx : null;
}

/** Texto de una celda de exceljs (fechas como AAAA-MM-DD, fórmulas por su resultado). */
function textoCelda(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; text?: string; result?: unknown; hyperlink?: string; error?: string };
    if (o.richText) return o.richText.map((x) => x.text).join("");
    if ("result" in o) return textoCelda(o.result);
    if (o.text !== undefined) return String(o.text);
    return "";
  }
  return String(v).trim();
}

/** CSV con «,» o «;» y comillas. */
function leerCsv(texto: string): string[][] {
  const primera = texto.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primera.match(/;/g)?.length ?? 0) > (primera.match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) {
      if (ch === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') comillas = false;
      else campo += ch;
    } else if (ch === '"') comillas = true;
    else if (ch === sep) {
      fila.push(campo.trim());
      campo = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && texto[i + 1] === "\n") i++;
      fila.push(campo.trim());
      filas.push(fila);
      fila = [];
      campo = "";
      if (filas.length > MAX_FILAS) break;
    } else campo += ch;
  }
  if (campo || fila.length) {
    fila.push(campo.trim());
    filas.push(fila);
  }
  return filas.map((f) => f.slice(0, MAX_COLUMNAS));
}

/** Lee el Excel (.xlsx) o CSV y devuelve sus hojas como texto. */
export async function leerArchivo(form: FormData): Promise<Lectura> {
  if (!(await puedeImportar())) return { error: "Solo gerencia y administración importan datos." };
  const archivo = form.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return { error: "Elige el archivo." };
  if (archivo.size > 5.5 * 1024 * 1024) return { error: "El archivo pesa más de 5 MB. Divídelo en partes (por ejemplo, una hoja por archivo)." };
  const nombre = archivo.name.toLowerCase();
  try {
    if (nombre.endsWith(".csv")) {
      const filas = leerCsv(new TextDecoder("utf-8").decode(await archivo.arrayBuffer()).replace(/^﻿/, ""));
      return { hojas: [{ nombre: archivo.name, filas: filas.slice(0, MAX_FILAS + 1) }] };
    }
    if (!nombre.endsWith(".xlsx")) {
      return { error: nombre.endsWith(".xls") ? "Es un Excel antiguo (.xls). Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)»." : "El archivo debe ser Excel (.xlsx) o CSV." };
    }
    const { Workbook } = await import("exceljs");
    const libro = new Workbook();
    await libro.xlsx.load(await archivo.arrayBuffer());
    const hojas: Hoja[] = [];
    libro.eachSheet((hoja) => {
      const filas: string[][] = [];
      hoja.eachRow({ includeEmpty: false }, (fila) => {
        if (filas.length > MAX_FILAS) return;
        // Se guardan también las filas vacías: así «fila 7» es la fila 7 del Excel.
        while (filas.length < fila.number - 1) filas.push([]);
        const celdas: string[] = [];
        for (let c = 1; c <= Math.min(fila.cellCount, MAX_COLUMNAS); c++) celdas.push(textoCelda(fila.getCell(c).value));
        filas.push(celdas);
      });
      if (filas.length) hojas.push({ nombre: hoja.name, filas });
    });
    if (!hojas.length) return { error: "El archivo no tiene datos." };
    return { hojas };
  } catch {
    return { error: "No se pudo leer el archivo. Ábrelo en Excel y guárdalo de nuevo como .xlsx." };
  }
}

export type FilaEnviada = { numero: number; celdas: string[] };
export type ResultadoLote = { creados: number; actualizados: number; sinCambios: number; errores: { fila: number; motivo: string }[]; avisos: { fila: number; motivo: string }[]; error?: string };

/** Guarda un lote de filas (hasta 300). */
export async function importarLote(tipo: TipoImportacion, filas: FilaEnviada[], mapa: Mapa, opciones: { costosConIgv?: boolean; hoy?: string } = {}): Promise<ResultadoLote> {
  const vacio: ResultadoLote = { creados: 0, actualizados: 0, sinCambios: 0, errores: [], avisos: [] };
  const ctx = await puedeImportar();
  if (!ctx) return { ...vacio, error: "Solo gerencia y administración importan datos." };
  if (!(tipo in TIPOS_IMPORTACION) || !Array.isArray(filas) || filas.length > 300) return { ...vacio, error: "Lote no válido." };
  const r = { ...vacio, errores: [] as ResultadoLote["errores"], avisos: [] as ResultadoLote["avisos"] };
  const validas = [];
  for (const f of filas) {
    const v = validarFila(tipo, (f.celdas ?? []).slice(0, MAX_COLUMNAS).map(String), mapa, f.numero, { ...opciones, hoy: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()) });
    if (!v.ok) {
      if (!v.errores.includes("Fila vacía")) r.errores.push({ fila: f.numero, motivo: v.errores.join("; ") });
      continue;
    }
    for (const a of v.avisos) r.avisos.push({ fila: f.numero, motivo: a });
    validas.push(v);
  }
  const supabase = await clienteServidor();
  const empresa = ctx.taller.id;

  if (tipo === "clientes") {
    const celulares = [...new Set(validas.map((v) => v.datos.celular).filter(Boolean))] as string[];
    const placas = [...new Set(validas.map((v) => v.datos.placa).filter(Boolean))] as string[];
    const [{ data: cls }, { data: vhs }] = await Promise.all([
      celulares.length ? supabase.from("clientes").select("id, celular, tipo_documento").eq("empresa_id", empresa).in("celular", celulares) : Promise.resolve({ data: [] }),
      placas.length ? supabase.from("vehiculos").select("id, placa, cliente_id, marca, modelo, anio, color, combustible, transmision, kilometraje_actual").eq("empresa_id", empresa).in("placa", placas) : Promise.resolve({ data: [] }),
    ]);
    const clientes = new Map((cls ?? []).map((c) => [c.celular as string, c as { id: string; celular: string; tipo_documento: string }]));
    type Vh = { id: string; placa: string; cliente_id: string | null } & Record<string, unknown>;
    const vehiculos = new Map((vhs ?? []).map((v) => [v.placa as string, v as Vh]));
    for (const v of validas) {
      const d = v.datos as Record<string, never> & { celular?: string; nombre?: string; placa?: string; documento?: { tipo: string; numero: string }; notas?: string; kilometraje?: number };
      let clienteId: string | null = null;
      if (d.celular) {
        const c = clientes.get(d.celular);
        if (c) {
          clienteId = c.id;
          if (d.documento && c.tipo_documento === "ninguno") await supabase.from("clientes").update({ tipo_documento: d.documento.tipo, numero_documento: d.documento.numero }).eq("id", c.id);
        } else {
          const { data, error } = await supabase
            .from("clientes")
            .insert({ empresa_id: empresa, nombre: d.nombre, celular: d.celular, tipo_documento: d.documento?.tipo ?? "ninguno", numero_documento: d.documento?.numero ?? null, origen: "recurrente", notas: d.notas ?? null })
            .select("id")
            .single();
          if (error || !data) {
            r.errores.push({ fila: v.fila, motivo: "No se pudo crear el cliente" });
            continue;
          }
          clienteId = data.id;
          clientes.set(d.celular, { id: data.id, celular: d.celular, tipo_documento: d.documento?.tipo ?? "ninguno" });
          r.creados++;
        }
      }
      if (d.placa) {
        const carro: Record<string, unknown> = { marca: d.marca, modelo: d.modelo, anio: d.anio, color: d.color, combustible: d.combustible, transmision: d.transmision, kilometraje_actual: d.kilometraje };
        const existe = vehiculos.get(d.placa);
        if (existe) {
          // Solo se completa lo que faltaba: lo que ya estaba en el sistema no se pisa.
          const cambios = Object.fromEntries(Object.entries(carro).filter(([k, val]) => val !== undefined && (existe[k] === null || existe[k] === undefined)));
          if (clienteId && !existe.cliente_id) cambios.cliente_id = clienteId;
          if (Object.keys(cambios).length) {
            const { error } = await supabase.from("vehiculos").update(cambios).eq("id", existe.id);
            if (error) r.errores.push({ fila: v.fila, motivo: `No se pudo actualizar la placa ${d.placa}` });
            else {
              r.actualizados++;
              Object.assign(existe, cambios);
            }
          } else r.sinCambios++;
        } else {
          const nuevo = Object.fromEntries(Object.entries(carro).filter(([, val]) => val !== undefined));
          const { data, error } = await supabase.from("vehiculos").insert({ empresa_id: empresa, placa: d.placa, cliente_id: clienteId, ...nuevo }).select("id").single();
          if (error || !data) r.errores.push({ fila: v.fila, motivo: `No se pudo crear la placa ${d.placa}` });
          else {
            vehiculos.set(d.placa, { id: data.id, placa: d.placa, cliente_id: clienteId, ...nuevo });
            r.creados++;
          }
        }
      }
    }
  }

  if (tipo === "inventario") {
    const { data: todos } = await supabase.from("repuestos").select("id, codigo, nombre, marca, stock_minimo, precio_venta_sin_igv").eq("empresa_id", empresa);
    type Rep = { id: string; codigo: string; nombre: string; marca: string | null; stock_minimo: number; precio_venta_sin_igv: number | null };
    const porCodigo = new Map(((todos ?? []) as Rep[]).map((x) => [x.codigo, x]));
    const porNombre = new Map(((todos ?? []) as Rep[]).map((x) => [simple(x.nombre), x]));
    const codigoNuevo = (nombre: string) => {
      const base = simple(nombre).split(" ").filter((w) => w.length > 2).slice(0, 3).map((w) => w.slice(0, 4).toUpperCase()).join("-") || "REP";
      let i = 1;
      let c = base.slice(0, 24);
      while (porCodigo.has(c)) c = `${base.slice(0, 24)}-${++i}`;
      return c;
    };
    for (const v of validas) {
      const d = v.datos as { codigo?: string; nombre: string; marca?: string; unidad: string; stock: number; stock_minimo?: number; costo_sin_igv?: number; precio_sin_igv?: number };
      const existe = (d.codigo && porCodigo.get(d.codigo)) || (!d.codigo && porNombre.get(simple(d.nombre)));
      if (existe) {
        const cambios: Record<string, unknown> = {};
        if (d.marca && !existe.marca) cambios.marca = d.marca;
        if (d.stock_minimo !== undefined && Number(existe.stock_minimo) === 0) cambios.stock_minimo = d.stock_minimo;
        if (d.precio_sin_igv !== undefined && existe.precio_venta_sin_igv === null) cambios.precio_venta_sin_igv = d.precio_sin_igv;
        if (Object.keys(cambios).length) {
          await supabase.from("repuestos").update(cambios).eq("id", existe.id);
          r.actualizados++;
        } else r.sinCambios++;
        if (d.stock > 0) r.avisos.push({ fila: v.fila, motivo: `«${existe.codigo}» ya existía: su stock no se cambió (ajústalo en Inventario si hace falta)` });
        continue;
      }
      const codigo = d.codigo ?? codigoNuevo(d.nombre);
      const { data, error } = await supabase
        .from("repuestos")
        .insert({ empresa_id: empresa, codigo, nombre: d.nombre, marca: d.marca ?? null, unidad: d.unidad, stock_minimo: d.stock_minimo ?? 0, precio_venta_sin_igv: d.precio_sin_igv ?? null })
        .select("id")
        .single();
      if (error || !data) {
        r.errores.push({ fila: v.fila, motivo: error?.code === "23505" ? `El código ${codigo} ya existe` : "No se pudo crear el repuesto" });
        continue;
      }
      const nuevo = { id: data.id, codigo, nombre: d.nombre, marca: d.marca ?? null, stock_minimo: d.stock_minimo ?? 0, precio_venta_sin_igv: d.precio_sin_igv ?? null };
      porCodigo.set(codigo, nuevo);
      porNombre.set(simple(d.nombre), nuevo);
      r.creados++;
      // El stock inicial entra por el kardex, con su costo (así queda el costo promedio).
      if (d.stock > 0) {
        const { error: eMov } = await supabase.from("movimientos_inventario").insert({
          empresa_id: empresa, repuesto_id: data.id, tipo: "ajuste", cantidad: d.stock, costo_unitario_sin_igv: d.costo_sin_igv ?? 0, nota: "Inventario inicial importado del Excel",
        });
        if (eMov) r.avisos.push({ fila: v.fila, motivo: `Se creó «${codigo}», pero no se pudo cargar su stock` });
      }
    }
  }

  if (tipo === "gastos") {
    const fechas = validas.map((v) => v.datos.fecha as string).sort();
    const { data: previos } = fechas.length
      ? await supabase.from("gastos").select("fecha, descripcion, monto").eq("empresa_id", empresa).neq("estado", "anulado").gte("fecha", fechas[0]).lte("fecha", fechas.at(-1)!)
      : { data: [] };
    const ya = new Set((previos ?? []).map((g) => `${g.fecha}|${simple(g.descripcion)}|${Number(g.monto)}`));
    for (const v of validas) {
      const d = v.datos as { fecha: string; descripcion: string; monto: number; categoria: string; medio?: string; comprobante?: string };
      const clave = `${d.fecha}|${simple(d.descripcion)}|${d.monto}`;
      if (ya.has(clave)) {
        r.sinCambios++;
        continue;
      }
      const { error } = await supabase.from("gastos").insert({ empresa_id: empresa, fecha: d.fecha, categoria: d.categoria, descripcion: d.descripcion, monto: d.monto, medio: d.medio ?? null, comprobante: d.comprobante ?? null });
      if (error) r.errores.push({ fila: v.fila, motivo: "No se pudo guardar el gasto" });
      else {
        ya.add(clave);
        r.creados++;
      }
    }
  }

  if (tipo === "historial") {
    // Primero el carro (y su dueño, si viene con celular); después la visita, ya entregada y con su fecha.
    const placas = [...new Set(validas.map((v) => v.datos.placa as string))];
    const celulares = [...new Set(validas.map((v) => v.datos.celular).filter(Boolean))] as string[];
    const [{ data: vhs }, { data: cls }] = await Promise.all([
      supabase.from("vehiculos").select("id, placa, cliente_id").eq("empresa_id", empresa).in("placa", placas),
      celulares.length ? supabase.from("clientes").select("id, celular").eq("empresa_id", empresa).in("celular", celulares) : Promise.resolve({ data: [] }),
    ]);
    const vehiculos = new Map((vhs ?? []).map((v) => [v.placa as string, v as { id: string; placa: string; cliente_id: string | null }]));
    const clientes = new Map((cls ?? []).map((c) => [c.celular as string, c.id as string]));
    for (const v of validas) {
      const d = v.datos as { placa: string; fecha: string; servicios: string[]; kilometraje?: number; monto?: number; notas?: string; celular?: string; nombre?: string; marca?: string; modelo?: string };
      let clienteId = d.celular ? (clientes.get(d.celular) ?? null) : null;
      if (d.celular && !clienteId) {
        const { data } = await supabase.from("clientes").insert({ empresa_id: empresa, nombre: d.nombre, celular: d.celular, origen: "recurrente" }).select("id").single();
        if (data) {
          clienteId = data.id;
          clientes.set(d.celular, data.id);
        }
      }
      let carro = vehiculos.get(d.placa);
      if (!carro) {
        const { data, error } = await supabase.from("vehiculos").insert({ empresa_id: empresa, placa: d.placa, cliente_id: clienteId, marca: d.marca ?? null, modelo: d.modelo ?? null }).select("id").single();
        if (error || !data) {
          r.errores.push({ fila: v.fila, motivo: `No se pudo crear la placa ${d.placa}` });
          continue;
        }
        carro = { id: data.id, placa: d.placa, cliente_id: clienteId };
        vehiculos.set(d.placa, carro);
      } else if (!carro.cliente_id && clienteId) {
        await supabase.from("vehiculos").update({ cliente_id: clienteId }).eq("id", carro.id);
        carro.cliente_id = clienteId;
      }
      if (!carro.cliente_id) {
        r.errores.push({ fila: v.fila, motivo: `El carro ${d.placa.replace(/^([A-Z0-9]{3})(\d{3})$/, "$1-$2")} no tiene dueño con celular. Pon su celular en la columna Celular o impórtalo primero en «Clientes y sus carros».` });
        continue;
      }
      const notas = [d.notas, d.monto ? `Cobrado según el Excel: S/ ${d.monto.toFixed(2)}` : null].filter(Boolean).join(" · ") || null;
      const { data: id, error } = await supabase.rpc("importar_orden_historica", { p_empresa: empresa, p_vehiculo: carro.id, p_fecha: d.fecha, p_servicios: d.servicios, p_kilometraje: d.kilometraje ?? null, p_notas: notas });
      if (error) r.errores.push({ fila: v.fila, motivo: error.message || "No se pudo guardar la visita" });
      else if (id) r.creados++;
      else r.sinCambios++;
    }
  }

  if (tipo === "ventas") {
    const { data: cfg } = await supabase.from("configuracion_empresa").select("tasa_igv").eq("empresa_id", empresa).maybeSingle();
    const tasa = Number(cfg?.tasa_igv ?? 0.18);
    const fechas = validas.map((v) => v.datos.fecha as string).sort();
    const { data: previas } = fechas.length
      ? await supabase.from("comprobantes_venta").select("tipo, serie, numero, fecha_emision, total, detalle").eq("empresa_id", empresa).neq("estado", "anulado").gte("fecha_emision", fechas[0]).lte("fecha_emision", fechas.at(-1)!)
      : { data: [] };
    const ya = new Set((previas ?? []).map((c) => `${c.tipo}|${c.serie}|${c.numero}`));
    // Sin número, una venta se reconoce por su fecha, su total y su detalle (cliente y concepto).
    const yaSinNumero = new Set((previas ?? []).filter((c) => c.serie === "XLS").map((c) => `${c.fecha_emision}|${Number(c.total)}|${simple(c.detalle)}`));
    const { data: ultimo } = await supabase.from("comprobantes_venta").select("numero").eq("empresa_id", empresa).eq("serie", "XLS").order("creado_en", { ascending: false }).limit(1).maybeSingle();
    let siguiente = Number(ultimo?.numero ?? 0);
    const placas = [...new Set(validas.map((v) => v.datos.placa).filter(Boolean))] as string[];
    const { data: vhs } = placas.length ? await supabase.from("vehiculos").select("id, placa").eq("empresa_id", empresa).in("placa", placas) : { data: [] };
    const carro = new Map((vhs ?? []).map((x) => [x.placa as string, x.id as string]));
    for (const v of validas) {
      const d = v.datos as { fecha: string; total: number; tipo: "boleta" | "factura"; serie?: string; numero?: string; documento?: { numero: string }; placa?: string; detalle?: string; nombre?: string };
      // Sin serie y número: se guarda con la serie «XLS» (venta traída del Excel), sin repetir la misma venta.
      const detalle = [d.nombre ? `Cliente: ${d.nombre}` : null, d.detalle, "Importado del Excel"].filter(Boolean).join(" · ").slice(0, 2000);
      if (!d.serie) {
        if (yaSinNumero.has(`${d.fecha}|${d.total}|${simple(detalle)}`)) {
          r.sinCambios++;
          continue;
        }
      } else if (ya.has(`${d.tipo}|${d.serie}|${d.numero}`)) {
        r.sinCambios++;
        continue;
      }
      // Si en esa fecha el carro tuvo una orden (por ejemplo, del historial importado), la venta queda en esa orden.
      let ordenId: string | null = null;
      const vehiculo = d.placa ? carro.get(d.placa) : undefined;
      if (vehiculo) {
        const desde = new Date(`${d.fecha}T00:00:00-05:00`).toISOString();
        const hasta = new Date(new Date(`${d.fecha}T00:00:00-05:00`).getTime() + 86_400_000).toISOString();
        const { data: o } = await supabase.from("ordenes_trabajo").select("id").eq("vehiculo_id", vehiculo).eq("anulada", false).gte("ingresado_en", desde).lt("ingresado_en", hasta).limit(1).maybeSingle();
        ordenId = o?.id ?? null;
      }
      const serie = d.serie ?? "XLS";
      const numero = d.numero ?? String(++siguiente);
      const m = desdeTotal(d.total, tasa);
      const { error } = await supabase.from("comprobantes_venta").insert({
        empresa_id: empresa, orden_id: ordenId, tipo: d.tipo, serie, numero, fecha_emision: d.fecha, documento_cliente: d.documento?.numero ?? null,
        tasa_igv: tasa, subtotal_sin_igv: m.sinIgv, igv: m.igv, total: m.total, detalle, origen_datos: "importado",
      });
      if (error) r.errores.push({ fila: v.fila, motivo: error.code === "23505" ? `${d.tipo} ${serie}-${numero} ya existe` : "No se pudo guardar la venta" });
      else {
        r.creados++;
        ya.add(`${d.tipo}|${serie}|${numero}`);
        if (serie === "XLS") yaSinNumero.add(`${d.fecha}|${d.total}|${simple(detalle)}`);
      }
    }
  }

  if (tipo === "compras") {
    const { data: cfg } = await supabase.from("configuracion_empresa").select("tasa_igv").eq("empresa_id", empresa).maybeSingle();
    const tasa = Number(cfg?.tasa_igv ?? 0.18);
    const { data: provs } = await supabase.from("proveedores").select("id, ruc, razon_social").eq("empresa_id", empresa);
    const porRuc = new Map((provs ?? []).filter((p) => p.ruc).map((p) => [p.ruc as string, p.id as string]));
    const porNombre = new Map((provs ?? []).map((p) => [simple(p.razon_social), p.id as string]));
    const fechas = validas.map((v) => v.datos.fecha as string).sort();
    const { data: previas } = fechas.length
      ? await supabase.from("compras").select("proveedor_id, serie, numero, fecha_emision, total").eq("empresa_id", empresa).neq("estado", "anulado").gte("fecha_emision", fechas[0]).lte("fecha_emision", fechas.at(-1)!)
      : { data: [] };
    const ya = new Set((previas ?? []).map((c) => (c.serie ? `${c.proveedor_id}|${c.serie}|${c.numero}` : `${c.proveedor_id}|${c.fecha_emision}|${Number(c.total)}`)));
    for (const v of validas) {
      const d = v.datos as { fecha: string; total: number; proveedor: string; ruc?: string; tipo: string; serie?: string; numero?: string; detalle?: string };
      const provId = (d.ruc && porRuc.get(d.ruc)) || porNombre.get(simple(d.proveedor)) || null;
      if (provId && ya.has(d.serie ? `${provId}|${d.serie}|${d.numero}` : `${provId}|${d.fecha}|${d.total}`)) {
        r.sinCambios++;
        continue;
      }
      // Con factura se separa el IGV; boletas, tickets y sin comprobante van sin IGV. No cambian el stock.
      const t = d.tipo === "factura" ? tasa : 0;
      const m = desdeTotal(d.total, t);
      const { data: compra, error } = await supabase.rpc("registrar_compra", {
        p_empresa: empresa,
        p_proveedor: provId ? { id: provId } : { ruc: d.ruc ?? null, razon_social: d.proveedor },
        p_compra: { tipo: d.tipo, serie: d.serie ?? null, numero: d.numero ?? null, fecha: d.fecha, moneda: "PEN", tipo_cambio: 1, tasa_igv: t, sin_igv: m.sinIgv, igv: m.igv, total: m.total, origen: "importado", archivo: null },
        p_items: [{ descripcion: (d.detalle ?? "Compra importada del Excel").slice(0, 200), cantidad: 1, precio_sin_igv: m.sinIgv, sin_igv: m.sinIgv, igv: m.igv, total: m.total, orden: null, repuesto: null }],
      });
      if (error || !compra) {
        r.errores.push({ fila: v.fila, motivo: error?.code === "23505" ? "Esa compra ya está registrada" : "No se pudo guardar la compra" });
        continue;
      }
      r.creados++;
      if (!provId) {
        const { data: c } = await supabase.from("compras").select("proveedor_id").eq("id", compra).single();
        if (c) {
          porNombre.set(simple(d.proveedor), c.proveedor_id);
          if (d.ruc) porRuc.set(d.ruc, c.proveedor_id);
        }
      }
      const p = provId ?? porNombre.get(simple(d.proveedor));
      ya.add(d.serie ? `${p}|${d.serie}|${d.numero}` : `${p}|${d.fecha}|${d.total}`);
    }
  }

  revalidatePath("/", "layout");
  return r;
}
