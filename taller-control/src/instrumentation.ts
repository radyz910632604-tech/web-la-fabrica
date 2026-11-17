/**
 * Se ejecuta una vez cuando arranca el servidor (antes de atender pedidos).
 * Solo en Node: ahí están la conexión a la base y el reloj interno.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { arrancar } = await import("./lib/arranque");
  await arrancar();
}
