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

  async function orden({ clienteId, vehiculoId, servicio, estado, tecnico, ingreso, cambio, km }) {
    const { data: o, error } = await db.from("ordenes_trabajo").insert({
      empresa_id: norte, cliente_id: clienteId, vehiculo_id: vehiculoId, estado, tecnico_id: tecnico,
      ingresado_en: ingreso, kilometraje_ingreso: km,
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
    const id = await orden({ ...ids2, servicio, estado, tecnico, ingreso: hace(min), cambio: hace(Math.max(5, Math.round(min / 3) - i)), km: 40000 + i * 7311 });
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
  for (let i = 0; i < 46; i++) {
    const c = carrosEntregados[i % carrosEntregados.length];
    const servicio = ENTREGADAS_CLIENTES[i % ENTREGADAS_CLIENTES.length][6];
    const minutos = 60 + i * 1380; // una entrega cada ~23 horas hacia atrás
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
  console.log("Taller Norte: 14 carros en el taller, 46 entregas, 7 citas hoy y 24 en los últimos días.");
}

console.log("Listo. Personas de ejemplo (celular · rol):");
for (const p of PERSONAS) {
  const roles = [...new Set(Object.values(p.roles).flat())].join(", ");
  console.log(`  ${p.celular}  ${p.nombre.padEnd(15)} ${roles}`);
}
console.log(esLocal ? `Contraseña de todas: ${clave}` : "Contraseña: la de CLAVE_EJEMPLO.");
