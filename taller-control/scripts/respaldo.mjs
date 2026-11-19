// Respaldo de la base de datos: estructura y datos en archivos .sql con la fecha.
//
//   npm run respaldo            → base local (Docker)
//   npm run respaldo -- --nube  → proyecto de Supabase en la nube (usa SUPABASE_DB_URL de .env.local)
//
// Los archivos quedan en la carpeta respaldos/ (no se suben al repositorio).
// Cómo restaurar: docs/respaldo.md. Las fotos se respaldan aparte (también en esa guía).

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const nube = process.argv.includes("--nube");
const dbUrl = process.env.SUPABASE_DB_URL;
if (nube && !dbUrl) {
  console.error("Falta SUPABASE_DB_URL en .env.local (Supabase → Project Settings → Database → Connection string).");
  process.exit(1);
}

const fecha = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
const hora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(":", "");
const carpeta = join("respaldos", `${fecha}-${hora}${nube ? "-nube" : "-local"}`);
mkdirSync(carpeta, { recursive: true });

const destino = nube ? [`--db-url=${dbUrl}`] : ["--local"];
const pasos = [
  ["estructura", ["--schema=public,privado", "-f", join(carpeta, "1-estructura.sql")]],
  ["usuarios", ["--data-only", "--schema=auth", "-f", join(carpeta, "2-usuarios.sql")]],
  ["datos", ["--data-only", "--use-copy", "--schema=public", "-f", join(carpeta, "3-datos.sql")]],
];

for (const [nombre, args] of pasos) {
  process.stdout.write(`Respaldando ${nombre}… `);
  // shell: true para que npx funcione igual en Windows.
  const r = spawnSync("npx", ["supabase", "db", "dump", ...destino, ...args], { stdio: ["ignore", "ignore", "pipe"], shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`no se pudo.\n${r.stderr?.toString().slice(-800)}`);
    process.exit(1);
  }
  console.log("listo");
}
console.log(`\nRespaldo guardado en ${carpeta}. Guárdalo también fuera de esta computadora (Drive, USB).`);
