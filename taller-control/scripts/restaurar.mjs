// Restaura una copia de seguridad hecha por la app (archivo .json.gz que
// gerencia descarga en Configuración → Estado del sistema) en una base VACÍA
// que ya tiene sus tablas.
//
//   npm run restaurar -- respaldo.json.gz            → base en la nube (usa SUPABASE_DB_URL de .env.local)
//   npm run restaurar -- respaldo.json.gz --local    → base local de pruebas (Docker)
//
// Si la copia es de tipo «datos» (sin contraseñas), agrega una contraseña
// temporal para todas las personas:  --clave-temporal=CambiarEsto123
// Guía completa: docs/respaldo.md

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import pg from "pg";

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const local = args.includes("--local");
const claveTemporal = args.find((a) => a.startsWith("--clave-temporal="))?.split("=").slice(1).join("=");
const salir = (m) => {
  console.error(m);
  process.exit(1);
};
if (!archivo) salir("Falta el archivo. Ejemplo: npm run restaurar -- 2026-11-17-0310.json.gz");

const url = local ? "postgresql://postgres:postgres@127.0.0.1:54322/postgres" : process.env.SUPABASE_DB_URL;
if (!url) salir("Falta SUPABASE_DB_URL en .env.local (o usa --local para la base de pruebas).");

let copia;
try {
  copia = JSON.parse(gunzipSync(readFileSync(archivo)).toString("utf8"));
} catch {
  salir("No se pudo leer el archivo: ¿es la copia .json.gz que descargaste de la app?");
}
if (copia.formato !== "taller-control-respaldo" || copia.version !== 1) salir("Ese archivo no es una copia de seguridad de Taller Control.");
if (copia.modo === "datos" && (!claveTemporal || claveTemporal.length < 8)) {
  salir("Esta copia no trae contraseñas. Agrega --clave-temporal=UnaClaveDe8oMas: todas las personas entrarán con ella y luego la cambian.");
}

const destino = new URL(url);
const esLocal = ["localhost", "127.0.0.1"].includes(destino.hostname);
const cliente = new pg.Client({
  host: destino.hostname,
  port: Number(destino.port || 5432),
  user: decodeURIComponent(destino.username),
  password: process.env.SUPABASE_DB_PASSWORD && !local ? process.env.SUPABASE_DB_PASSWORD : decodeURIComponent(destino.password),
  database: destino.pathname.replace(/^\//, "") || "postgres",
  ssl: esLocal ? undefined : { rejectUnauthorized: false },
});
await cliente.connect();

const cuenta = async (t) => Number((await cliente.query(`select count(*)::int as n from ${t}`)).rows[0].n);
try {
  if ((await cuenta("public.empresas")) > 0 || (await cuenta("public.perfiles")) > 0) {
    salir("La base ya tiene talleres o personas. Para no pisar nada, solo se restaura en una base recién creada (sin instalar).");
  }
} catch {
  salir("La base todavía no tiene las tablas. Primero arranca la app con SUPABASE_DB_URL (las crea sola) o pega los pasos de /instalar.");
}

console.log(`Copia del ${new Date(copia.creado_en).toLocaleString("es-PE", { timeZone: "America/Lima" })} (${copia.modo}). Restaurando…`);
let total = 0;
try {
  await cliente.query("begin");
  // Sin reglas automáticas mientras se carga: los datos entran tal como estaban.
  await cliente.query("set local session_replication_role = replica");
  for (const [nombre, filas] of Object.entries(copia.tablas)) {
    const [esquema, tabla] = nombre.split(".");
    if (!/^(public|auth)$/.test(esquema) || !/^[a-z_]+$/.test(tabla)) continue;
    if (!filas.length) continue;
    const { rows: columnas } = await cliente.query(
      "select column_name from information_schema.columns where table_schema = $1 and table_name = $2 and is_generated = 'NEVER' order by ordinal_position",
      [esquema, tabla],
    );
    if (!columnas.length) {
      console.log(`  (se salta ${nombre}: ya no existe en esta versión)`);
      continue;
    }
    const presentes = new Set(filas.flatMap((f) => Object.keys(f)));
    const cols = columnas.map((c) => c.column_name).filter((c) => presentes.has(c)).map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < filas.length; i += 500) {
      await cliente.query(
        `insert into "${esquema}"."${tabla}" (${cols}) overriding system value select ${cols} from jsonb_populate_recordset(null::"${esquema}"."${tabla}", $1::jsonb)`,
        [JSON.stringify(filas.slice(i, i + 500))],
      );
    }
    total += filas.length;
    console.log(`  ${nombre}: ${filas.length}`);
  }
  // Los contadores automáticos siguen después del último número restaurado.
  await cliente.query("select setval(pg_get_serial_sequence('public.auditoria', 'id'), coalesce((select max(id) from public.auditoria), 1))");
  await cliente.query("commit");
} catch (e) {
  await cliente.query("rollback").catch(() => {});
  await cliente.end();
  salir(`No se restauró nada (se deshizo todo). Motivo: ${e.message}`);
}
await cliente.end();
console.log(`Listo: ${total} registros restaurados.`);

if (copia.modo === "datos") {
  // La copia no traía contraseñas: se crean los accesos con la clave temporal.
  const { createClient } = await import("@supabase/supabase-js");
  const urlApi = local ? "http://127.0.0.1:54321" : process.env.SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!urlApi || !llave) salir("Los datos están, pero faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY para crear los accesos.");
  const admin = createClient(urlApi, llave, { auth: { persistSession: false } });
  let creados = 0;
  for (const p of copia.tablas["public.perfiles"] ?? []) {
    const { error } = await admin.auth.admin.createUser({
      id: p.id,
      email: `${String(p.celular).replace(/^\+/, "")}@celular.taller-control.invalid`,
      password: claveTemporal,
      email_confirm: true,
      app_metadata: { nombre: p.nombre, celular: p.celular },
    });
    if (error) console.error(`  No se pudo crear el acceso de ${p.nombre}: ${error.message}`);
    else creados++;
  }
  console.log(`Accesos creados: ${creados}. Todas las personas entran con la clave temporal; cámbiala en Personal y roles.`);
}
console.log("Las fotos y PDF subidos no van en la copia: están en Supabase → Storage.");
