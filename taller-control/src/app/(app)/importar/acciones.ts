"use server";

import { revalidatePath } from "next/cache";
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
export async function importarLote(tipo: TipoImportacion, filas: FilaEnviada[], mapa: Mapa, opciones: { costosConIgv?: boolean } = {}): Promise<ResultadoLote> {
  const vacio: ResultadoLote = { creados: 0, actualizados: 0, sinCambios: 0, errores: [], avisos: [] };
  const ctx = await puedeImportar();
  if (!ctx) return { ...vacio, error: "Solo gerencia y administración importan datos." };
  if (!(tipo in TIPOS_IMPORTACION) || !Array.isArray(filas) || filas.length > 300) return { ...vacio, error: "Lote no válido." };
  const r = { ...vacio, errores: [] as ResultadoLote["errores"], avisos: [] as ResultadoLote["avisos"] };
  const validas = [];
  for (const f of filas) {
    const v = validarFila(tipo, (f.celdas ?? []).slice(0, MAX_COLUMNAS).map(String), mapa, f.numero, opciones);
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

  revalidatePath("/", "layout");
  return r;
}
