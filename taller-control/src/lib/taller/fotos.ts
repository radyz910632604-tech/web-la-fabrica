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
