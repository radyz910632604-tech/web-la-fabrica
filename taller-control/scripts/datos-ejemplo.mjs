/**
 * Crea datos de ejemplo FICTICIOS: dos talleres y una persona por rol.
 *
 *   npm run datos:ejemplo
 *
 * Solo corre contra el Supabase local (127.0.0.1 / localhost). Para un
 * proyecto de pruebas en la nube hay que pasar --nube-de-pruebas y definir
 * CLAVE_EJEMPLO en .env.local. Nunca lo corras contra la base de producción.
 */
import { createClient } from "@supabase/supabase-js";
import { celularAEmail, normalizarCelular } from "../src/lib/celulares.ts";

const url = process.env.SUPABASE_URL;
const llaveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !llaveServicio) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const esLocal = ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
const nubeDePruebas = process.argv.includes("--nube-de-pruebas");
if (!esLocal && !nubeDePruebas) {
  console.error(`Esta base no es local (${url}). Si es un proyecto de PRUEBAS, agrega --nube-de-pruebas.`);
  process.exit(1);
}

const clave = process.env.CLAVE_EJEMPLO ?? (esLocal ? "taller-ejemplo" : undefined);
if (!clave || clave.length < 8) {
  console.error("Define CLAVE_EJEMPLO (8 caracteres o más) en .env.local para la nube de pruebas.");
  process.exit(1);
}

const db = createClient(url, llaveServicio, { auth: { persistSession: false } });

const TALLERES = ["Taller Norte", "Taller Sur"];

// Personas ficticias. Los números no pertenecen a nadie del taller.
const PERSONAS = [
  { nombre: "Rosa Huamán", celular: "900000001", roles: { "Taller Norte": ["gerencia"], "Taller Sur": ["gerencia"] } },
  { nombre: "Jorge Salas", celular: "900000002", roles: { "Taller Norte": ["administrador"], "Taller Sur": ["administrador"] } },
  { nombre: "Carla Mendoza", celular: "900000003", roles: { "Taller Norte": ["asesor"] } },
  { nombre: "Luis Quispe", celular: "900000004", roles: { "Taller Norte": ["tecnico"] } },
  { nombre: "Pedro Rojas", celular: "900000005", roles: { "Taller Norte": ["almacen"] } },
  { nombre: "Andrea Torres", celular: "900000006", roles: { "Taller Norte": ["vendedor_redes"], "Taller Sur": ["vendedor_redes"] } },
  { nombre: "Milagros Vega", celular: "900000007", roles: { "Taller Norte": ["confirmador"] } },
  { nombre: "Diego Paredes", celular: "900000008", roles: { "Taller Sur": ["asesor"] } },
  { nombre: "Ernesto Lara", celular: "900000010", roles: { "Taller Norte": ["tecnico"] } },
  { nombre: "Sandra Ríos", celular: "900000009", roles: { "Taller Norte": ["recepcion"] } },
];

async function falla(paso, error) {
  if (error) {
    console.error(`Error en "${paso}": ${error.message}`);
    process.exit(1);
  }
}

// 1. Talleres
const empresas = {};
for (const nombre of TALLERES) {
  const { data: existente, error } = await db.from("empresas").select("id").eq("nombre", nombre).maybeSingle();
  await falla(`buscar ${nombre}`, error);
  if (existente) {
    empresas[nombre] = existente.id;
    continue;
  }
  const { data, error: errorCrear } = await db.from("empresas").insert({ nombre }).select("id").single();
  await falla(`crear ${nombre}`, errorCrear);
  empresas[nombre] = data.id;
}

// Datos ficticios del taller para la cabecera de los PDF (solo si están vacíos).
await db.from("empresas").update({ razon_social: "Taller Norte E.I.R.L. (ejemplo)", ruc: "20000000099", direccion: "Av. de Ejemplo 123, Los Olivos, Lima", telefono: "01 000 0000" }).eq("id", empresas["Taller Norte"]).is("ruc", null);
await db.from("empresas").update({ razon_social: "Taller Sur S.A.C. (ejemplo)", ruc: "20000000088", direccion: "Jr. de Ejemplo 456, Surco, Lima", telefono: "01 000 0001" }).eq("id", empresas["Taller Sur"]).is("ruc", null);

// 2. Personas y roles
const { data: lista, error: errorLista } = await db.auth.admin.listUsers({ perPage: 1000 });
await falla("listar usuarios", errorLista);

const ids = {};
for (const persona of PERSONAS) {
  const celular = normalizarCelular(persona.celular);
  const email = celularAEmail(celular);
  let usuario = lista.users.find((u) => u.email === email);

  if (!usuario) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: clave,
      email_confirm: true,
      app_metadata: { nombre: persona.nombre, celular },
    });
    await falla(`crear ${persona.nombre}`, error);
    usuario = data.user;
  }
  ids[persona.nombre] = usuario.id;

  for (const [taller, roles] of Object.entries(persona.roles)) {
    const filas = roles.map((rol) => ({ empresa_id: empresas[taller], perfil_id: usuario.id, rol }));
    const { error } = await db.from("miembros").upsert(filas, {
      onConflict: "empresa_id,perfil_id,rol",
      ignoreDuplicates: true,
    });
    await falla(`roles de ${persona.nombre}`, error);
  }
}

// 3. Meta de ventas del mes actual (hora de Lima)
const [anio, mes] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" })
  .format(new Date())
  .split("-")
  .map(Number);
const metas = [
  { empresa_id: empresas["Taller Norte"], anio, mes, meta_sin_igv: 95000 },
  { empresa_id: empresas["Taller Sur"], anio, mes, meta_sin_igv: 60000 },
];
const { error: errorMetas } = await db.from("metas_ventas").upsert(metas, { onConflict: "empresa_id,anio,mes" });
await falla("metas", errorMetas);


// 4. Taller Norte: clientes, carros, órdenes y citas ficticias (solo si está vacío)
const norte = empresas["Taller Norte"];
const { count: yaHay } = await db.from("ordenes_trabajo").select("id", { count: "exact", head: true }).eq("empresa_id", norte);
if (!yaHay) {
  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60_000).toISOString();
  const { data: catalogo } = await db.from("catalogo_servicios").select("id, nombre").eq("empresa_id", norte);
  const servicioId = (nombre) => catalogo.find((c) => c.nombre === nombre)?.id ?? null;
  const luis = ids["Luis Quispe"];
  const ernesto = ids["Ernesto Lara"];

  // [placa, cliente, celular, marca, modelo, año, combustible, caja, servicio, estado, técnico, minutos desde el ingreso]
  const ACTIVAS = [
    ["BKR472", "María Chávez", "911000101", "Toyota", "Corolla", 2017, "gasolina", "automatica", "Mantenimiento de caja automática", "listo", luis, 1500],
    ["F7Q315", "José Ramírez", "911000102", "Hyundai", "Accent", 2019, "gnv", "mecanica", "Conversión a GNV", "en_proceso", luis, 1460],
    ["C3T764", "Carlos Gutiérrez", "911000104", "Nissan", "Sentra", 2016, "gasolina", "cvt", "Diagnóstico de caja automática", "esperando_repuesto", ernesto, 2900],
    ["BDL951", "Ana Flores", "911000105", "Kia", "Rio", 2020, "gasolina", "mecanica", "Carga de aire acondicionado", "en_proceso", luis, 300],
    ["V2P086", "Miguel Castillo", "911000106", "Toyota", "Yaris", 2018, "gnv", "mecanica", "Revisión anual de GNV", "listo", ernesto, 420],
    ["D9K520", "Javier Ruiz", "911000108", "Chevrolet", "Sail", 2015, "gasolina", "mecanica", "Reparación de embrague", "en_taller", ernesto, 245],
    ["BHT317", "Patricia Díaz", "911000109", "Suzuki", "Swift", 2021, "glp", "mecanica", "Revisión de GLP", "en_proceso", luis, 600],
    ["AFW842", "Fernando Ríos", "911000110", "Honda", "Civic", 2014, "gasolina", "automatica", "Mantenimiento de caja automática", "esperando_repuesto", ernesto, 4300],
    ["Z4M193", "Elena Vargas", "911000111", "Volkswagen", "Gol", 2013, "gasolina", "mecanica", "Rectificado de discos", "en_proceso", luis, 1330],
    ["BRC605", "Ricardo Medina", "911000112", "Mazda", "3", 2019, "gasolina", "automatica", "Carga de aire acondicionado", "listo", ernesto, 1395],
    ["AQP728", "Sofía Cárdenas", "911000113", "Toyota", "Etios", 2018, "dual", "mecanica", "Conversión a GNV", "en_proceso", luis, 2800],
    ["T6N457", "Hugo Espinoza", "911000114", "Kia", "Picanto", 2017, "gasolina", "mecanica", "Cambio de aceite y filtro", "en_taller", null, 90],
    ["BMV264", "Verónica Luna", "911000115", "Hyundai", "Elantra", 2016, "gasolina", "automatica", "Cambio de pastillas de freno", "en_proceso", luis, 2900],
    ["H8R931", "Óscar Palacios", "911000116", "Nissan", "Versa", 2015, "gasolina", "mecanica", "Reparación de embrague", "en_taller", ernesto, 3050],
  ];
  const ENTREGADAS_CLIENTES = [
    ["AXM208", "Lucía Fernández", "911000103", "Chevrolet", "Spark", 2019, "Cambio de pastillas de freno"],
    ["ANS639", "Rocío Sánchez", "911000107", "Toyota", "Hilux", 2020, "Cambio de aceite y filtro"],
    ["B5H210", "Daniel Prado", "911000117", "Kia", "Cerato", 2018, "Carga de aire acondicionado"],
    ["C8R552", "Teresa Molina", "911000118", "Hyundai", "Tucson", 2017, "Mantenimiento de caja automática"],
    ["A4X903", "Alberto Núñez", "911000119", "Toyota", "Rav4", 2016, "Revisión anual de GNV"],
    ["F2K118", "Gloria Benítez", "911000120", "Suzuki", "Celerio", 2021, "Cambio de aceite y filtro"],
    ["BJL734", "Mario Cueva", "911000121", "Toyota", "Corolla", 2019, "Reparación de embrague"],
    ["ACD415", "Silvia Ramos", "911000122", "Nissan", "Kicks", 2020, "Cambio de pastillas de freno"],
    ["D6P287", "Enrique Soto", "911000123", "Hyundai", "Creta", 2021, "Conversión a GNV"],
    ["BQN560", "Carmen Ortega", "911000124", "Kia", "Sportage", 2018, "Mantenimiento de caja automática"],
    ["A7T941", "Víctor Lozano", "911000125", "Chevrolet", "Onix", 2020, "Carga de aire acondicionado"],
    ["F9M372", "Julia Paredes", "911000126", "Toyota", "Yaris", 2017, "Rectificado de discos"],
  ];

  async function clienteYCarro(placa, nombre, celular, marca, modelo, anio, combustible = null, transmision = null) {
    const { data: c, error: e1 } = await db.from("clientes").upsert(
      { empresa_id: norte, nombre, celular: normalizarCelular(celular), origen: "otro", acepta_mensajes: true },
      { onConflict: "empresa_id,celular" },
    ).select("id").single();
    await falla(`cliente ${nombre}`, e1);
    const { data: v, error: e2 } = await db.from("vehiculos").upsert(
      { empresa_id: norte, placa, marca, modelo, anio, combustible, transmision, cliente_id: c.id },
      { onConflict: "empresa_id,placa" },
    ).select("id").single();
    await falla(`carro ${placa}`, e2);
    return { clienteId: c.id, vehiculoId: v.id };
  }

  async function orden({ clienteId, vehiculoId, servicio, estado, tecnico, ingreso, cambio, km, entrega = null }) {
    const { data: o, error } = await db.from("ordenes_trabajo").insert({
      empresa_id: norte, cliente_id: clienteId, vehiculo_id: vehiculoId, estado, tecnico_id: tecnico,
      ingresado_en: ingreso, kilometraje_ingreso: km, entrega_prometida: entrega,
    }).select("id").single();
    await falla("orden", error);
    // Fechas reales del pasado (el disparador pone "ahora" al crear).
    const fechas = { estado_cambiado_en: cambio };
    if (estado === "listo") fechas.listo_en = cambio;
    if (estado === "entregado") Object.assign(fechas, { listo_en: cambio, entregado_en: cambio });
    await db.from("ordenes_trabajo").update(fechas).eq("id", o.id);
    await db.from("orden_estados_historial").update({ cambiado_en: ingreso }).eq("orden_id", o.id);
    const { error: e2 } = await db.from("orden_servicios").insert({ empresa_id: norte, orden_id: o.id, descripcion: servicio, servicio_id: servicioId(servicio) });
    await falla("servicio de orden", e2);
    return o.id;
  }

  for (const [i, [placa, nombre, cel, marca, modelo, anio, comb, caja, servicio, estado, tecnico, min]] of ACTIVAS.entries()) {
    const ids2 = await clienteYCarro(placa, nombre, cel, marca, modelo, anio, comb, caja);
    // Hora prometida: una atrasada, una por vencer, otras para más tarde o mañana, alguna por definir.
    const PROMESAS = [-50, 70, 240, 1500, null, 360, -15, 2900];
    const abierta = ["en_taller", "en_proceso", "esperando_repuesto"].includes(estado);
    const promesa = abierta ? PROMESAS[i % PROMESAS.length] : 6 * 60 - min; // las listas: 6 horas después de entrar
    const entrega = promesa === null ? null : hace(-promesa);
    const id = await orden({ ...ids2, servicio, estado, tecnico, ingreso: hace(min), cambio: hace(Math.max(5, Math.round(min / 3) - i)), km: 40000 + i * 7311, entrega });
    if (estado === "esperando_repuesto") {
      await db.from("orden_avances").insert({ empresa_id: norte, orden_id: id, texto: "Se desarmó y se pidió el repuesto al proveedor. Llega mañana.", autor_id: tecnico, creado_en: hace(Math.round(min / 2)) });
    }
    if (estado === "en_proceso" && i % 2 === 0) {
      await db.from("orden_avances").insert({ empresa_id: norte, orden_id: id, texto: "Trabajo en curso, sin novedades.", autor_id: tecnico, creado_en: hace(Math.round(min / 4)) });
    }
  }

  // Entregas de este mes y del anterior (para "Carros entregados").
  const carrosEntregados = [];
  for (const [placa, nombre, cel, marca, modelo, anio] of ENTREGADAS_CLIENTES) carrosEntregados.push(await clienteYCarro(placa, nombre, cel, marca, modelo, anio));
  for (let i = 0; i < 90; i++) {
    const c = carrosEntregados[i % carrosEntregados.length];
    const servicio = ENTREGADAS_CLIENTES[i % ENTREGADAS_CLIENTES.length][6];
    const minutos = 60 + i * 690; // una entrega cada ~11 horas y media hacia atrás
    await orden({ ...c, servicio, estado: "entregado", tecnico: i % 2 ? luis : ernesto, ingreso: hace(minutos + 600), cambio: hace(minutos), km: 30000 + i * 1200 });
  }

  // Citas de hoy (hora de Lima) y de los últimos 30 días.
  const diaLima = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
  const enLima = (dia, hora) => new Date(`${dia}T${hora}:00-05:00`).toISOString();
  const andrea = ids["Andrea Torres"];
  const HOY = [
    ["08:30", "Gabriela Rojas", "911000201", "Cambio de aceite y filtro", "facebook", "Promo aceite noviembre", "agendada"],
    ["09:30", "Raúl Mendoza", "911000202", "Conversión a GNV", "tiktok", "GNV ahorro", "confirmada"],
    ["10:00", "Diana Paz", "911000203", "Carga de aire acondicionado", "instagram", null, "agendada"],
    ["11:30", "Andrés Silva", "911000204", "Diagnóstico de caja automática", "facebook", "Caja automática", "confirmada"],
    ["14:00", "Karina Ortiz", "911000205", "Cambio de pastillas de freno", "facebook", "Promo aceite noviembre", "confirmada"],
    ["15:30", "Pablo Herrera", "911000206", "Revisión de GLP", "tiktok", "GNV ahorro", "agendada"],
    ["17:00", "Lorena Campos", "911000207", "Mantenimiento de caja automática", "instagram", "Caja automática", "agendada"],
  ];
  for (const [hora, nombre, cel, servicio, red, campana, estado] of HOY) {
    await db.from("citas").insert({ empresa_id: norte, nombre_cliente: nombre, celular: normalizarCelular(cel), fecha_hora: enLima(diaLima, hora), servicio, red, campana, vendedor_id: andrea, estado });
  }
  const CAMPANAS = ["Promo aceite noviembre", "GNV ahorro", "Caja automática", null];
  for (let i = 1; i <= 24; i++) {
    const dia = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(dia);
    await db.from("citas").insert({
      empresa_id: norte,
      nombre_cliente: `Cliente de redes ${i}`,
      celular: normalizarCelular(`9113${String(i).padStart(5, "0")}`),
      fecha_hora: enLima(d, i % 2 ? "10:00" : "15:00"),
      servicio: ["Cambio de aceite y filtro", "Conversión a GNV", "Mantenimiento de caja automática"][i % 3],
      red: ["facebook", "tiktok", "instagram"][i % 3],
      campana: CAMPANAS[i % 4],
      vendedor_id: andrea,
      estado: i % 3 === 0 ? "no_llego" : "llego",
    });
  }
  console.log("Taller Norte: 14 carros en el taller, 90 entregas, 7 citas hoy y 24 en los últimos días.");
}

// 5. Taller Norte: dinero ficticio (solo si todavía no hay comprobantes)
const { count: hayDinero } = await db.from("comprobantes_venta").select("id", { count: "exact", head: true }).eq("empresa_id", norte);
if (!hayDinero) {
  const TASA = 0.18;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const desglose = (total) => { const sin = r2(total / (1 + TASA)); return { sin, igv: r2(total - sin), total: r2(total) }; };
  const diaLimaDe = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(iso));
  const masMin = (iso, min) => new Date(new Date(iso).getTime() + min * 60_000).toISOString();

  // Precio al cliente (con IGV) y repuestos que se compran (sin IGV) por servicio.
  const PRECIOS = {
    "Cambio de pastillas de freno": [350, [["Pastillas de freno delanteras", 1, 95]]],
    "Cambio de aceite y filtro": [240, [["Aceite 10W-30 galón", 1, 58], ["Filtro de aceite", 1, 14]]],
    "Carga de aire acondicionado": [280, [["Gas refrigerante R134a", 1, 45]]],
    "Mantenimiento de caja automática": [890, [["Aceite ATF litro", 6, 32], ["Filtro de caja automática", 1, 68]]],
    "Revisión anual de GNV": [190, [["Empaquetadura de válvula GNV", 1, 22]]],
    "Conversión a GNV": [3800, [["Kit de conversión GNV 5ta generación", 1, 1850]]],
    "Diagnóstico de caja automática": [150, []],
    "Reparación de embrague": [1350, [["Kit de embrague", 1, 420]]],
    "Revisión de GLP": [200, [["Filtro de GLP", 1, 25]]],
    "Rectificado de discos": [320, []],
  };
  const PROVEEDORES = [
    ["20000000011", "Repuestos del Norte SAC (ejemplo)"],
    ["20000000022", "Lubricantes Lima EIRL (ejemplo)"],
    ["20000000033", "Frenos y Embragues SAC (ejemplo)"],
    ["20000000044", "Gas Vehicular Partes SAC (ejemplo)"],
  ];
  const { data: provs, error: eProv } = await db.from("proveedores").insert(PROVEEDORES.map(([ruc, razon_social]) => ({ empresa_id: norte, ruc, razon_social }))).select("id, ruc");
  await falla("proveedores", eProv);
  const prov = (servicio) => {
    const i = /GNV|GLP/.test(servicio) ? 3 : /aceite|caja/i.test(servicio) ? 1 : /freno|embrague|discos/i.test(servicio) ? 2 : 0;
    return provs.find((p) => p.ruc === PROVEEDORES[i][0]).id;
  };

  // Sueldos (costo mensual) y reglas de comisión.
  const inicio = new Date(Date.UTC(Number(anio), Number(mes) - 2, 1)).toISOString().slice(0, 10);
  const COSTOS = [["Luis Quispe", 2200], ["Ernesto Lara", 2000], ["Carla Mendoza", 2200], ["Pedro Rojas", 1800], ["Andrea Torres", 1500], ["Milagros Vega", 1300]];
  await falla("sueldos", (await db.from("costos_personal").insert(COSTOS.map(([n, c]) => ({ empresa_id: norte, perfil_id: ids[n], costo_mensual: c, vigente_desde: inicio })))).error);
  await falla("comisiones", (await db.from("reglas_comision").insert([
    { empresa_id: norte, nombre: "S/ 20 por cita que llegó y pagó", evento: "cita_llego_y_pago", tipo_monto: "fijo", valor: 20 },
    { empresa_id: norte, nombre: "3 % por trabajo entregado", evento: "trabajo_entregado", tipo_monto: "porcentaje", valor: 3 },
  ])).error);

  const { data: ords, error: eOrd } = await db.from("ordenes_trabajo")
    .select("id, numero, estado, ingresado_en, entregado_en, orden_servicios (descripcion)")
    .eq("empresa_id", norte).eq("anulada", false).order("numero");
  await falla("leer órdenes", eOrd);

  async function compra(proveedorId, fechaIso, items, ordenId) {
    const lineas = items.map(([descripcion, cantidad, precio]) => {
      const sin = r2(cantidad * precio);
      return { descripcion, cantidad, precio_unitario_sin_igv: precio, subtotal_sin_igv: sin, igv: r2(sin * TASA), total: r2(sin * (1 + TASA)) };
    });
    const sin = r2(lineas.reduce((a, l) => a + l.subtotal_sin_igv, 0));
    const igv = r2(lineas.reduce((a, l) => a + l.igv, 0));
    compra.n = (compra.n ?? 3400) + 1;
    const { data: c, error } = await db.from("compras").insert({
      empresa_id: norte, proveedor_id: proveedorId, tipo_comprobante: "factura", serie: "F001", numero: String(compra.n),
      fecha_emision: diaLimaDe(fechaIso), tasa_igv: TASA, subtotal_sin_igv: sin, igv, total: r2(sin + igv),
    }).select("id").single();
    await falla("compra", error);
    await falla("líneas de compra", (await db.from("compra_items").insert(lineas.map((l) => ({
      ...l, empresa_id: norte, compra_id: c.id, destino: ordenId ? "orden" : "stock", orden_id: ordenId ?? null,
    })))).error);
  }

  let boleta = 1200;
  let factura = 310;
  const MEDIOS = ["yape", "efectivo", "tarjeta", "transferencia", "plin", "yape"];
  const entregadas = ords.filter((o) => o.estado === "entregado").sort((a, b) => b.entregado_en.localeCompare(a.entregado_en));
  for (const [i, o] of entregadas.entries()) {
    const servicio = o.orden_servicios[0]?.descripcion;
    const [precio, repuestos] = PRECIOS[servicio] ?? [200, []];
    const total = precio + (i % 4) * 20;
    if (repuestos.length) {
      // El repuesto subió de precio en la compra más reciente de pastillas (para la alerta).
      const items = repuestos.map(([d, c, p]) => [d, c, i === 0 && /Pastillas/.test(d) ? p * 1.12 : p]);
      await compra(prov(servicio), masMin(o.ingresado_en, 90), items, o.id);
    }
    // Las 2 entregas más recientes: una sin comprobante y otra con saldo (para el cierre y las alertas).
    if (i === 1) continue;
    const esFactura = i % 5 === 0;
    const m = desglose(total);
    const detalle = [servicio, ...repuestos.map(([d]) => d)].join(", ");
    await falla("comprobante", (await db.from("comprobantes_venta").insert({
      empresa_id: norte, orden_id: o.id, tipo: esFactura ? "factura" : "boleta", serie: esFactura ? "F001" : "B001",
      numero: String(esFactura ? ++factura : ++boleta), fecha_emision: diaLimaDe(o.entregado_en), tasa_igv: TASA,
      subtotal_sin_igv: m.sin, igv: m.igv, total: m.total, detalle, documento_cliente: esFactura ? "20000000099" : null,
    })).error);
    const pagado = i === 2 ? r2(total * 0.5) : total;
    if (i % 3 === 0 && i !== 2) {
      const adelanto = r2(total * 0.4);
      await db.from("pagos").insert({ empresa_id: norte, orden_id: o.id, monto: adelanto, tipo: "adelanto", medio: "yape", pagado_en: masMin(o.ingresado_en, 120) });
      await db.from("pagos").insert({ empresa_id: norte, orden_id: o.id, monto: r2(total - adelanto), tipo: "saldo", medio: MEDIOS[i % MEDIOS.length], pagado_en: o.entregado_en });
    } else {
      await db.from("pagos").insert({ empresa_id: norte, orden_id: o.id, monto: pagado, tipo: i === 2 ? "adelanto" : "saldo", medio: MEDIOS[i % MEDIOS.length], pagado_en: o.entregado_en });
    }
  }

  // Órdenes en el taller: cotización (aprobada, enviada o adicional pendiente) y algunos adelantos.
  const abiertas = ords.filter((o) => o.estado !== "entregado");
  for (const [i, o] of abiertas.entries()) {
    const servicio = o.orden_servicios[0]?.descripcion;
    const [precio, repuestos] = PRECIOS[servicio] ?? [200, []];
    const items = [
      { tipo: "servicio", descripcion: servicio, cantidad: 1, precio_unitario_total: r2(precio * 0.45) },
      ...repuestos.map(([d, c]) => ({ tipo: "repuesto", descripcion: d, cantidad: c, precio_unitario_total: r2((precio * 0.55) / repuestos.length / c) })),
    ];
    if (!repuestos.length) items[0].precio_unitario_total = precio;
    const lineas = items.map((x) => { const m = desglose(x.cantidad * x.precio_unitario_total); return { ...x, subtotal_sin_igv: m.sin, igv: m.igv, total: m.total }; });
    const suma = (k) => r2(lineas.reduce((a, l) => a + l[k], 0));
    const estado = o.estado === "en_taller" ? "enviada" : "aprobada";
    const { data: cot, error } = await db.from("cotizaciones").insert({
      empresa_id: norte, orden_id: o.id, version: 1, estado, tasa_igv: TASA,
      enviada_en: masMin(o.ingresado_en, 60), respuesta_en: estado === "aprobada" ? masMin(o.ingresado_en, 150) : null,
      aprobada_por_medio: estado === "aprobada" ? ["whatsapp", "presencial", "llamada"][i % 3] : null,
      subtotal_sin_igv: suma("subtotal_sin_igv"), igv: suma("igv"), total: suma("total"),
    }).select("id").single();
    await falla("cotización", error);
    await falla("líneas de cotización", (await db.from("cotizacion_items").insert(lineas.map((l) => ({ ...l, empresa_id: norte, cotizacion_id: cot.id })))).error);
    if (estado === "aprobada" && repuestos.length && o.estado !== "esperando_repuesto") await compra(prov(servicio), masMin(o.ingresado_en, 180), repuestos, o.id);
    if (estado === "aprobada" && i % 2 === 0) {
      await db.from("pagos").insert({ empresa_id: norte, orden_id: o.id, monto: r2(suma("total") * 0.5), tipo: "adelanto", medio: MEDIOS[i % MEDIOS.length], pagado_en: masMin(o.ingresado_en, 160) });
    }
    if (i === 3) {
      // Un adicional encontrado al revisar, cotizado y sin respuesta del cliente (alerta).
      await db.from("orden_servicios").insert({ empresa_id: norte, orden_id: o.id, descripcion: "Cambio de faja de accesorios", es_adicional: true });
      const m = desglose(190);
      const { data: ad } = await db.from("cotizaciones").insert({ empresa_id: norte, orden_id: o.id, version: 2, es_adicional: true, estado: "enviada", tasa_igv: TASA, enviada_en: masMin(o.ingresado_en, 240), subtotal_sin_igv: m.sin, igv: m.igv, total: m.total }).select("id").single();
      await db.from("cotizacion_items").insert({ empresa_id: norte, cotizacion_id: ad.id, tipo: "servicio", descripcion: "Cambio de faja de accesorios", cantidad: 1, precio_unitario_total: 190, subtotal_sin_igv: m.sin, igv: m.igv, total: m.total });
    }
  }

  // Las citas de redes que llegaron quedan unidas a una orden entregada (para las comisiones).
  const { data: llegaron } = await db.from("citas").select("id").eq("empresa_id", norte).eq("estado", "llego").is("orden_id", null).order("fecha_hora", { ascending: false });
  for (const [k, c] of (llegaron ?? []).entries()) {
    const o = entregadas[k * 2 + 2];
    if (o) await db.from("citas").update({ orden_id: o.id }).eq("id", c.id);
  }

  // Stock del almacén sin orden y una boleta de hoy sin orden asignada (alerta).
  await compra(provs.find((p) => p.ruc === PROVEEDORES[1][0]).id, new Date(Date.now() - 2 * 86_400_000).toISOString(), [["Aceite 10W-30 galón", 6, 58], ["Filtro de aire", 4, 21], ["Refrigerante 1 L", 6, 12]]);
  const m = desglose(95);
  await db.from("comprobantes_venta").insert({ empresa_id: norte, tipo: "boleta", serie: "B001", numero: String(++boleta), fecha_emision: diaLimaDe(new Date().toISOString()), tasa_igv: TASA, subtotal_sin_igv: m.sin, igv: m.igv, total: m.total, detalle: "Lavado de motor" });
  console.log("Taller Norte: compras, comprobantes, pagos, cotizaciones, sueldos y comisiones de ejemplo.");
}

// 6. Caja de recepción y una nota de crédito (solo si todavía no hay cajas).
// Se hace con la sesión de la recepcionista, como en la app.
const { count: hayCajas } = await db.from("cajas").select("id", { count: "exact", head: true }).eq("empresa_id", norte);
if (!hayCajas && process.env.SUPABASE_ANON_KEY) {
  const sandra = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: eLogin } = await sandra.auth.signInWithPassword({ email: celularAEmail(normalizarCelular("900000009")), password: clave });
  await falla("entrar como recepción", eLogin);
  const { data: abiertasConCot } = await db.from("cotizaciones").select("orden_id, total, ordenes_trabajo!inner (estado)").eq("empresa_id", norte).eq("estado", "aprobada").neq("ordenes_trabajo.estado", "entregado").limit(6);
  const ordenesCaja = (abiertasConCot ?? []).map((c) => c.orden_id);
  const pagar = async (orden, monto, tipo, medio) => falla("pago en caja", (await sandra.from("pagos").insert({ empresa_id: norte, orden_id: orden, monto, tipo, medio })).error);

  // Caja anterior: abierta, dos abonos, cerrada con S/ 2 de faltante.
  const { data: c1, error: e1 } = await sandra.from("cajas").insert({ empresa_id: norte, monto_inicial: 150 }).select("id").single();
  await falla("abrir caja", e1);
  if (ordenesCaja[0]) await pagar(ordenesCaja[0], 100, "abono", "efectivo");
  if (ordenesCaja[1]) await pagar(ordenesCaja[1], 80, "abono", "yape");
  await falla("gasto", (await sandra.from("movimientos_caja").insert({ empresa_id: norte, caja_id: c1.id, tipo: "egreso", concepto: "Agua y útiles de limpieza", monto: 18 })).error);
  await falla("cerrar caja", (await sandra.rpc("cerrar_caja", { p_caja: c1.id, p_contado: 230, p_observaciones: "Faltó S/ 2 de sencillo." })).error);

  // Caja de ahora: abierta con sencillo, abonos, un saldo y un gasto.
  const { data: c2, error: e2 } = await sandra.from("cajas").insert({ empresa_id: norte, monto_inicial: 200 }).select("id").single();
  await falla("abrir caja de hoy", e2);
  if (ordenesCaja[2]) await pagar(ordenesCaja[2], 150, "abono", "efectivo");
  if (ordenesCaja[3]) await pagar(ordenesCaja[3], 120, "abono", "plin");
  if (ordenesCaja[4]) await pagar(ordenesCaja[4], 60, "abono", "tarjeta");
  await falla("gasto de hoy", (await sandra.from("movimientos_caja").insert({ empresa_id: norte, caja_id: c2.id, tipo: "egreso", concepto: "Movilidad para recoger repuesto", monto: 15 })).error);

  // Nota de crédito por un descuento en una boleta ya pagada: queda saldo a favor.
  const { data: boleta } = await db.from("comprobantes_venta").select("id, total, orden_id").eq("empresa_id", norte).eq("tipo", "boleta").not("orden_id", "is", null).order("fecha_emision", { ascending: false }).range(3, 3).single();
  if (boleta) {
    const total = 30, sin = Math.round((total / 1.18) * 100) / 100;
    await falla("nota de crédito", (await sandra.from("notas_credito").insert({
      empresa_id: norte, comprobante_id: boleta.id, serie: "BC01", numero: "21", fecha_emision: new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date()),
      motivo_codigo: "04", motivo: "Descuento por demora en la entrega", tasa_igv: 0.18, subtotal_sin_igv: sin, igv: Math.round((total - sin) * 100) / 100, total,
    })).error);
  }
  await sandra.auth.signOut();
  console.log("Taller Norte: una caja cerrada (con arqueo), una caja abierta con abonos y una nota de crédito.");
}

// 7. Inventario de Taller Norte (solo si todavía no hay repuestos).
// Se hace con la sesión de almacén: una compra con sus líneas al inventario,
// salidas a órdenes abiertas y un ajuste por merma.
const { count: hayRepuestos } = await db.from("repuestos").select("id", { count: "exact", head: true }).eq("empresa_id", norte);
if (!hayRepuestos && process.env.SUPABASE_ANON_KEY) {
  const pedro = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error: eLogin } = await pedro.auth.signInWithPassword({ email: celularAEmail(normalizarCelular("900000005")), password: clave });
  await falla("entrar como almacén", eLogin);
  // [código, nombre, marca, unidad, mínimo, costo sin IGV, precio al cliente con IGV, cantidad comprada]
  const CATALOGO = [
    ["FIL-ACE-TY01", "Filtro de aceite Toyota", "Toyota", "unidad", 5, 18, 35, 20],
    ["FIL-ACE-HY02", "Filtro de aceite Hyundai y Kia", "Mobis", "unidad", 5, 16, 32, 15],
    ["FIL-AIR-TY01", "Filtro de aire Toyota Yaris", "Toyota", "unidad", 3, 28, 55, 6],
    ["ACE-5W30-GL", "Aceite sintético 5W-30", "Castrol", "galon", 4, 95, 165, 12],
    ["ACE-10W40-GL", "Aceite semisintético 10W-40", "Mobil", "galon", 4, 68, 120, 10],
    ["ATF-DIII-LT", "Aceite de transmisión ATF Dexron III", "Valvoline", "litro", 8, 22, 42, 24],
    ["CVT-NS3-LT", "Fluido CVT NS-3", "Nissan", "litro", 6, 48, 85, 8],
    ["PAST-DEL-YR", "Pastillas de freno delanteras Yaris", "Bosch", "juego", 2, 85, 160, 4],
    ["LIQ-FRE-DOT4", "Líquido de frenos DOT 4 (500 ml)", "Bosch", "unidad", 4, 18, 35, 10],
    ["REF-ROJO-GL", "Refrigerante rojo", "Prestone", "galon", 3, 32, 60, 6],
    ["BUJ-IRI-NGK", "Bujía iridium", "NGK", "unidad", 8, 32, 65, 16],
    ["GAS-R134A-KG", "Gas refrigerante R-134a", "Dupont", "kilo", 3, 38, 90, 4],
    ["FIL-GNV-01", "Filtro de GNV fase gaseosa", "Landi Renzo", "unidad", 4, 25, 60, 8],
    ["RED-GLP-TOM", "Kit reductor GLP", "Tomasetto", "kit", 1, 420, 780, 1],
  ];
  const ids = {};
  for (const [codigo, nombre, marca, unidad, minimo, , precio] of CATALOGO) {
    const { data, error } = await pedro.from("repuestos").insert({ empresa_id: norte, codigo, nombre, marca, unidad, stock_minimo: minimo, precio_venta_sin_igv: Math.round((precio / 1.18) * 10000) / 10000 }).select("id").single();
    await falla("repuesto " + codigo, error);
    ids[codigo] = data.id;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const lineas = CATALOGO.map(([codigo, nombre, , , , costo, , cant]) => ({ descripcion: nombre, cantidad: cant, precio_sin_igv: costo, sin_igv: r2(costo * cant), igv: r2(costo * cant * 0.18), total: r2(costo * cant * 1.18), repuesto: ids[codigo] }));
  const sin = r2(lineas.reduce((a, l) => a + l.sin_igv, 0)), igv = r2(lineas.reduce((a, l) => a + l.igv, 0));
  const hace20 = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date(Date.now() - 20 * 86400000));
  await falla("compra al inventario", (await pedro.rpc("registrar_compra", {
    p_empresa: norte,
    p_proveedor: { ruc: "20000000055", razon_social: "Distribuidora de Lubricantes (ejemplo) SAC" },
    p_compra: { tipo: "factura", serie: "F001", numero: "3301", fecha: hace20, moneda: "PEN", tipo_cambio: 1, tasa_igv: 0.18, sin_igv: sin, igv, total: r2(sin + igv), origen: "manual" },
    p_items: lineas,
  })).error);
  // Salidas a las órdenes abiertas
  const { data: abiertas } = await db.from("ordenes_trabajo").select("id").eq("empresa_id", norte).in("estado", ["en_taller", "en_proceso", "esperando_repuesto", "listo"]).order("creado_en").limit(6);
  const salidas = [["FIL-ACE-TY01", 1], ["ACE-5W30-GL", 1], ["FIL-ACE-HY02", 1], ["ACE-10W40-GL", 1], ["CVT-NS3-LT", 4], ["PAST-DEL-YR", 1], ["GAS-R134A-KG", 2], ["BUJ-IRI-NGK", 4], ["ACE-5W30-GL", 1], ["FIL-ACE-TY01", 1]];
  for (const [k, [codigo, cant]] of salidas.entries()) {
    const orden = abiertas?.[k % (abiertas.length || 1)]?.id;
    if (!orden) break;
    await falla("salida " + codigo, (await pedro.from("movimientos_inventario").insert({ empresa_id: norte, repuesto_id: ids[codigo], tipo: "salida", cantidad: -cant, orden_id: orden })).error);
  }
  await falla("ajuste", (await pedro.from("movimientos_inventario").insert({ empresa_id: norte, repuesto_id: ids["LIQ-FRE-DOT4"], tipo: "ajuste", cantidad: -1, nota: "Envase roto en el almacén" })).error);
  await falla("salida del kit", (await pedro.from("movimientos_inventario").insert({ empresa_id: norte, repuesto_id: ids["RED-GLP-TOM"], tipo: "salida", cantidad: -1, orden_id: abiertas?.[0]?.id })).error);
  await pedro.auth.signOut();
  console.log(`Taller Norte: ${CATALOGO.length} repuestos en inventario, una compra, ${salidas.length + 1} salidas y un ajuste.`);
}

// 8. Encuestas, recordatorios y mensajes de WhatsApp de ejemplo (solo si no hay encuestas).
const { count: hayEncuestas } = await db.from("encuestas").select("id", { count: "exact", head: true }).eq("empresa_id", norte);
if (!hayEncuestas) {
  const { data: entregadas } = await db
    .from("ordenes_trabajo")
    .select("id, cliente_id, vehiculo_id, entregado_en, kilometraje_ingreso, orden_servicios (descripcion, servicio_id)")
    .eq("empresa_id", norte)
    .eq("estado", "entregado")
    .order("entregado_en", { ascending: false })
    .limit(40);
  const { data: catalogo } = await db.from("catalogo_servicios").select("id, nombre, meses_recordatorio, km_recordatorio").eq("empresa_id", norte);
  const porId = new Map((catalogo ?? []).map((c) => [c.id, c]));
  const COMENTARIOS = [null, null, "Muy amables y rápidos.", null, "Me explicaron todo con fotos.", null, null, "Tardaron un día más de lo dicho.", null, null];
  const encuestas = [];
  const recordatorios = [];
  for (const [i, o] of (entregadas ?? []).entries()) {
    const respondio = i % 3 !== 2;
    const puntaje = [5, 5, 4, 5, 3, 5, 4, 2, 5, 4][i % 10];
    encuestas.push({ empresa_id: norte, orden_id: o.id, cliente_id: o.cliente_id, puntaje: respondio ? puntaje : null, comentario: respondio ? COMENTARIOS[i % 10] : null, respondida_en: respondio ? new Date(new Date(o.entregado_en).getTime() + 5 * 3600_000).toISOString() : null });
    for (const sv of o.orden_servicios ?? []) {
      const c = porId.get(sv.servicio_id);
      if (!c?.meses_recordatorio) continue;
      // Para el ejemplo, algunos ya vencen (como si la entrega hubiera sido hace meses).
      const base = new Date(o.entregado_en);
      const objetivo = new Date(base.getTime() + (i % 4 === 0 ? -5 : c.meses_recordatorio * 30) * 86400_000);
      recordatorios.push({ empresa_id: norte, vehiculo_id: o.vehiculo_id, cliente_id: o.cliente_id, orden_id: o.id, servicio: c.nombre, fecha_objetivo: objetivo.toISOString().slice(0, 10), km_objetivo: c.km_recordatorio && o.kilometraje_ingreso ? o.kilometraje_ingreso + c.km_recordatorio : null });
    }
  }
  await falla("encuestas", (await db.from("encuestas").insert(encuestas)).error);
  if (recordatorios.length) await falla("recordatorios", (await db.from("recordatorios_mantenimiento").upsert(recordatorios, { onConflict: "orden_id,servicio", ignoreDuplicates: true })).error);
  // Mensajes de WhatsApp ficticios para ver la auditoría.
  const { data: luis } = await db.from("perfiles").select("id").eq("celular", normalizarCelular("900000004")).single();
  const { data: carla } = await db.from("perfiles").select("id").eq("celular", normalizarCelular("900000003")).single();
  const ahora = Date.now();
  const mensajes = [
    { perfil_id: carla.id, celular: "+51900000003", tipo: "texto", texto: "ayuda", intencion: "ayuda", resultado: "respondido", respuesta: "Hola, Carla. Puedes escribir, mandar un audio o una foto…" },
    { perfil_id: luis.id, celular: "+51900000004", tipo: "audio", transcripcion: "La placa B7K789 ya está lista, se cambió el embrague", intencion: "avance", resultado: "borrador", respuesta: "*Avance* B7K-789\n«se cambió el embrague»\nNuevo estado: Listo para entregar\n\n¿Lo guardo?" },
    { perfil_id: luis.id, celular: "+51900000004", tipo: "boton", texto: "Confirmar", intencion: "avance", resultado: "confirmado", respuesta: "✅ Avance guardado · estado: listo." },
    { perfil_id: null, celular: "+51911111111", tipo: "texto", texto: "hola, precio de cambio de aceite?", resultado: "sin_acceso", respuesta: "Este número no está registrado en el sistema del taller…" },
  ].map((m, k) => ({ ...m, empresa_id: m.perfil_id ? norte : null, wa_id: `wamid.ejemplo.${ahora}.${k}`, creado_en: new Date(ahora - (4 - k) * 600_000).toISOString(), procesado_en: new Date(ahora - (4 - k) * 600_000 + 3000).toISOString() }));
  await falla("mensajes de WhatsApp", (await db.from("mensajes_whatsapp").insert(mensajes)).error);
  console.log(`Taller Norte: ${encuestas.length} encuestas, ${recordatorios.length} recordatorios de mantenimiento y ${mensajes.length} mensajes de WhatsApp de ejemplo.`);
}

console.log("Listo. Personas de ejemplo (celular · rol):");
for (const p of PERSONAS) {
  const roles = [...new Set(Object.values(p.roles).flat())].join(", ");
  console.log(`  ${p.celular}  ${p.nombre.padEnd(15)} ${roles}`);
}
console.log(esLocal ? `Contraseña de todas: ${clave}` : "Contraseña: la de CLAVE_EJEMPLO.");
