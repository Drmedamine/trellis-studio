import { falClient } from "@/lib/fal";
import { failure } from "@/lib/errors";
import { forbidden, hasAccess } from "@/lib/access";
import {
  DECIMATIONS,
  ENDPOINT,
  MAX_UPLOAD_BYTES,
  RESOLUTIONS,
  TEXTURE_SIZES,
  type Resolution,
  type TextureSize,
} from "@/lib/options";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export async function POST(request: Request) {
  if (!hasAccess(request)) return forbidden();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Requête invalide.");
  }

  const image = form.get("image");
  if (!(image instanceof File)) return bad("Aucune image reçue.");
  if (!IMAGE_TYPES.includes(image.type)) return bad("Format accepté : PNG, JPEG ou WebP.");
  if (image.size > MAX_UPLOAD_BYTES) return bad("Image trop lourde (4 Mo au plus).");

  const resolution = pick(form.get("resolution"), RESOLUTIONS, "1024") as Resolution;
  const textureSize = pick(form.get("textureSize"), TEXTURE_SIZES, "2048") as TextureSize;
  const decimation = Number(form.get("decimationTarget"));
  const decimationTarget = (DECIMATIONS as readonly number[]).includes(decimation)
    ? decimation
    : 200_000;
  const remesh = form.get("remesh") !== "false";
  const seedRaw = form.get("seed");
  const seed =
    typeof seedRaw === "string" && /^\d{1,9}$/.test(seedRaw) ? Number(seedRaw) : undefined;

  try {
    const fal = falClient();
    const imageUrl = await fal.storage.upload(image);
    const { request_id } = await fal.queue.submit(ENDPOINT, {
      input: {
        image_url: imageUrl,
        resolution,
        texture_size: textureSize,
        decimation_target: decimationTarget,
        remesh,
        ...(seed !== undefined ? { seed } : {}),
      },
    });
    return Response.json({ requestId: request_id });
  } catch (error) {
    return failure(error);
  }
}

function pick(value: FormDataEntryValue | null, allowed: readonly string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function bad(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
