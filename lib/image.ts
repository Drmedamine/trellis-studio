import { MAX_UPLOAD_BYTES } from "./options";

const MAX_SIDE = 1024;

/**
 * Réduit l'image à 1024 px de côté au plus avant l'envoi : TRELLIS.2 n'en
 * demande pas davantage, et Vercel refuse un corps de plus de 4,5 Mo.
 * Un PNG reste un PNG, pour garder un fond transparent.
 */
export async function prepareImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= MAX_UPLOAD_BYTES && file.type !== "image/gif") {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const keepAlpha = file.type === "image/png" || file.type === "image/webp";
  let blob = await toBlob(canvas, keepAlpha ? "image/png" : "image/jpeg", 0.92);
  if (blob.size > MAX_UPLOAD_BYTES) blob = await toBlob(canvas, "image/webp", 0.9);
  const extension = blob.type.split("/")[1];
  return new File([blob], `image.${extension}`, { type: blob.type });
}

/** Petite vignette pour l'historique (gardée dans le navigateur). */
export async function thumbnail(file: File, side = 96): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = side / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.7);
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion impossible."))), type, quality),
  );
}
