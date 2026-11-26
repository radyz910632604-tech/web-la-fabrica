/**
 * Reduce una foto en el mismo celular antes de subirla: lado mayor de 1600 px
 * y calidad 80 %. Una foto de 4 MB queda en unos 300 KB.
 */
export async function reducirFoto(archivo: File, ladoMaximo = 1600, calidad = 0.8): Promise<File> {
  if (!archivo.type.startsWith("image/")) throw new Error("Solo se aceptan fotos.");
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, ladoMaximo / Math.max(imagen.width, imagen.height));
  const ancho = Math.round(imagen.width * escala);
  const alto = Math.round(imagen.height * escala);
  const lienzo = document.createElement("canvas");
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede preparar la foto.");
  ctx.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();
  const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/jpeg", calidad));
  if (!blob) throw new Error("No se pudo preparar la foto.");
  const nombre = archivo.name.replace(/\.[^.]+$/, "") || "foto";
  return new File([blob], `${nombre}.jpg`, { type: "image/jpeg" });
}

/**
 * Prepara un logo para subirlo: lado mayor de 800 px (de sobra para los PDF) y menos de 1 MB.
 * Si el original es PNG se mantiene PNG (conserva el fondo transparente); si no, JPEG.
 */
export async function prepararLogo(archivo: File): Promise<File> {
  if (!archivo.type.startsWith("image/")) throw new Error("El logo debe ser una imagen (PNG o JPG).");
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error("No se pudo abrir la imagen. Guárdala como PNG o JPG y prueba otra vez.");
  }
  const escala = Math.min(1, 800 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement("canvas");
  lienzo.width = Math.max(1, Math.round(imagen.width * escala));
  lienzo.height = Math.max(1, Math.round(imagen.height * escala));
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("Este navegador no puede preparar la imagen.");
  const png = archivo.type === "image/png";
  if (!png) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  }
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  const aBlob = (tipo: string, calidad?: number) => new Promise<Blob | null>((ok) => lienzo.toBlob(ok, tipo, calidad));
  let blob = await aBlob(png ? "image/png" : "image/jpeg", 0.9);
  // Un PNG muy pesado (foto guardada como PNG) pasa a JPEG.
  if (blob && blob.size > 900 * 1024) blob = await aBlob("image/jpeg", 0.85);
  if (!blob) throw new Error("No se pudo preparar la imagen.");
  const tipo = blob.type || "image/jpeg";
  return new File([blob], tipo === "image/png" ? "logo.png" : "logo.jpg", { type: tipo });
}
