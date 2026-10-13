import { MAX_UPLOAD_BYTES } from "./options";

const MAX_SIDE = 1024;

// Les seuls formats que /api/generate accepte tels quels.
const SENT_AS_IS = ["image/png", "image/jpeg", "image/webp"];
// Formats qui peuvent porter un fond transparent : ils repartent en PNG pour le garder.
const WITH_ALPHA = ["image/png", "image/webp", "image/gif", "image/avif"];
// Du plus fin au plus léger : on s'arrête au premier qui passe sous la limite.
const JPEG_QUALITIES = [0.92, 0.85, 0.75, 0.6, 0.45];

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

/**
 * Cadrage carré d'une photo. Le centre est donné en fraction de la largeur
 * et de la hauteur, pas en pixels : il vaut pour l'aperçu comme pour l'image
 * envoyée, quelle que soit leur taille.
 */
export type Crop = {
  /** 1 = le plus grand carré qui tient dans la photo ; 3 = un carré trois fois plus petit. */
  zoom: number;
  cx: number;
  cy: number;
};

/**
 * Le plus grand carré, collé en haut : sur une photo en hauteur, c'est la
 * tête et les épaules qu'on garde, pas le milieu du buste.
 */
export const DEFAULT_CROP: Crop = { zoom: 1, cx: 0.5, cy: 0 };

/** Le carré découpé dans une image `width × height`, en pixels, toujours dans l'image. */
export function cropRect(width: number, height: number, crop: Crop): { sx: number; sy: number; side: number } {
  const side = Math.min(width, height) / clampZoom(crop.zoom);
  const cx = Number.isFinite(crop.cx) ? crop.cx : 0.5;
  const cy = Number.isFinite(crop.cy) ? crop.cy : 0.5;
  return {
    sx: clamp(cx * width - side / 2, 0, width - side),
    sy: clamp(cy * height - side / 2, 0, height - side),
    side,
  };
}

/**
 * Le même cadrage, son centre ramené là où on le voit : le carré bute sur le
 * bord de l'image, le centre demandé peut être au-delà. Zoomer ou faire
 * glisser repart de ce qu'on voit, pas d'un centre sorti de l'image.
 */
export function normalizeCrop(width: number, height: number, crop: Crop): Crop {
  const { sx, sy, side } = cropRect(width, height, crop);
  return { zoom: clampZoom(crop.zoom), cx: (sx + side / 2) / width, cy: (sy + side / 2) / height };
}

/**
 * Prépare l'image envoyée : recadrée si un cadrage est donné, réduite à
 * 1024 px de côté au plus (TRELLIS.2 n'en demande pas davantage, et Vercel
 * refuse un corps de plus de 4,5 Mo), et toujours en PNG, JPEG ou WebP.
 * Un fond transparent reste transparent tant que le PNG tient sous la limite.
 */
export async function prepareImage(file: File, crop?: Crop | null): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Typiquement une photo HEIC d'iPhone glissée depuis un ordinateur : peu de navigateurs la lisent.
    throw new Error(
      "Cette photo ne peut pas être lue par le navigateur (format HEIC d'iPhone ?). Enregistrez-la en JPEG, puis réessayez.",
    );
  }

  const rect = crop ? cropRect(bitmap.width, bitmap.height, crop) : null;
  const sx = rect?.sx ?? 0;
  const sy = rect?.sy ?? 0;
  const sw = rect?.side ?? bitmap.width;
  const sh = rect?.side ?? bitmap.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  // Un cadrage passe forcément par le canvas, même si l'image est déjà petite.
  if (!crop && scale === 1 && file.size <= MAX_UPLOAD_BYTES && SENT_AS_IS.includes(file.type)) {
    bitmap.close();
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  canvas.getContext("2d")!.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob: Blob | null = null;
  if (WITH_ALPHA.includes(file.type)) {
    const png = await toBlob(canvas, "image/png");
    if (png.size <= MAX_UPLOAD_BYTES) blob = png;
  }
  // JPEG plutôt que WebP : Safari ne sait pas écrire de WebP et rendrait un PNG, tout aussi lourd.
  if (!blob) {
    const flat = onWhite(canvas);
    for (const quality of JPEG_QUALITIES) {
      blob = await toBlob(flat, "image/jpeg", quality);
      if (blob.size <= MAX_UPLOAD_BYTES) break;
    }
  }
  if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error("Image trop lourde, même compressée.");
  const extension = blob.type === "image/png" ? "png" : "jpg";
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

/**
 * Le JPEG n'a pas de transparence : posée telle quelle, elle deviendrait
 * noire. Sur du blanc, le détourage de TRELLIS.2 retrouve le sujet.
 */
function onWhite(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

function clampZoom(zoom: number): number {
  return Number.isFinite(zoom) ? clamp(zoom, MIN_ZOOM, MAX_ZOOM) : MIN_ZOOM;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Conversion impossible."))), type, quality),
  );
}
