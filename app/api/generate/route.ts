import { falClient, submitOnce } from "@/lib/fal";
import { errorResponse, failure, isCreditError, step, StepError, submitFailure } from "@/lib/errors";
import { guard } from "@/lib/access";
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
const SEED = /^\d{1,9}$/;

export async function POST(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

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

  // Une graine ignorée en silence donnerait, à vos frais, un autre résultat
  // que celui qu'on croit reproduire : mieux vaut refuser.
  const seedRaw = form.get("seed");
  const seedText = typeof seedRaw === "string" ? seedRaw.trim() : "";
  if (seedText && !SEED.test(seedText)) return bad("Graine invalide : un entier de 0 à 999 999 999.");
  const seed = seedText ? Number(seedText) : undefined;

  let imageUrl: string;
  try {
    imageUrl = await uploadImage(falClient(), image);
  } catch (error) {
    // Rien n'est lancé : l'envoi de l'image ne coûte rien, il peut se refaire.
    return failure(error);
  }

  let submitted: { request_id?: unknown };
  try {
    submitted = await step("lancement du modèle", () =>
      submitOnce(ENDPOINT, {
        image_url: imageUrl,
        resolution,
        texture_size: textureSize,
        decimation_target: decimationTarget,
        remesh,
        ...(seed !== undefined ? { seed } : {}),
      }),
    );
  } catch (error) {
    return submitFailure(error);
  }
  // Sans identifiant, le suivi est impossible ; relancer risquerait de payer deux fois.
  const requestId = submitted.request_id;
  if (typeof requestId !== "string" || !requestId) {
    return errorResponse("fal.ai n'a pas renvoyé d'identifiant de génération.", 502, false);
  }
  return Response.json({ requestId });
}

/**
 * L'image passe par le stockage de fal. Une clé dont les droits ne couvrent
 * pas le stockage y est refusée alors qu'elle peut lancer le modèle : l'image
 * part alors dans la demande elle-même, encodée en data URI. Sauf si c'est le
 * crédit qui manque : le lancement échouerait pareil, avec un message moins clair.
 */
async function uploadImage(fal: ReturnType<typeof falClient>, image: File): Promise<string> {
  try {
    return await fal.storage.upload(image);
  } catch (error) {
    const status = (error as { status?: unknown })?.status;
    if ((status !== 401 && status !== 403) || isCreditError(error)) {
      throw new StepError("envoi de l'image", error);
    }
    const base64 = Buffer.from(await image.arrayBuffer()).toString("base64");
    return `data:${image.type};base64,${base64}`;
  }
}

function pick(value: FormDataEntryValue | null, allowed: readonly string[], fallback: string) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function bad(message: string) {
  return errorResponse(message, 400, false);
}
