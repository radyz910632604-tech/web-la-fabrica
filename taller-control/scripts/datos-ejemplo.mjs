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

console.log("Listo. Personas de ejemplo (celular · rol):");
for (const p of PERSONAS) {
  const roles = [...new Set(Object.values(p.roles).flat())].join(", ");
  console.log(`  ${p.celular}  ${p.nombre.padEnd(15)} ${roles}`);
}
console.log(esLocal ? `Contraseña de todas: ${clave}` : "Contraseña: la de CLAVE_EJEMPLO.");
