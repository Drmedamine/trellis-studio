import "server-only";
import { falKey, MissingKeyError } from "@/lib/fal";

/** Une erreur de fal, avec l'étape où elle est survenue. */
export class StepError extends Error {
  constructor(
    readonly step: string,
    readonly cause: unknown,
  ) {
    super(step);
  }
}

export async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof StepError ? error : new StepError(name, error);
  }
}

/**
 * Réponse d'erreur envoyée au navigateur. Le message d'une erreur réseau peut
 * citer l'en-tête d'autorisation, donc la clé : il ne part jamais tel quel.
 */
export function failure(error: unknown) {
  if (error instanceof MissingKeyError) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const where = error instanceof StepError ? error.step : "appel à fal.ai";
  const cause = error instanceof StepError ? error.cause : error;
  const status = (cause as { status?: unknown })?.status;
  const code = typeof status === "number" ? ` (code ${status})` : "";
  const detail = redact(describe(cause)).slice(0, 200);
  console.error(`fal.ai, ${where}${code} : ${detail}`);

  if (status === 401) {
    return reply(`fal.ai ne reconnaît pas la clé${code}, à l'étape « ${where} ». Vérifiez que FAL_KEY dans Vercel est bien la clé en cours (pas une clé supprimée), puis redéployez.`);
  }
  if (status === 403) {
    return reply(`fal.ai refuse cette action à la clé${code}, à l'étape « ${where} » : ${detail}`);
  }
  if (status === 402) {
    return reply("Crédit fal.ai épuisé : rechargez votre compte sur fal.ai.");
  }
  return reply(`Échec chez fal.ai${code}, à l'étape « ${where} » : ${detail}`);
}

function reply(message: string) {
  return Response.json({ error: message }, { status: 502 });
}

/** Le message utile : celui du corps de la réponse de fal quand il y en a un. */
function describe(error: unknown): string {
  const body = (error as { body?: unknown })?.body;
  if (body && typeof body === "object") {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (typeof detail === "string") return detail;
    if (typeof message === "string") return message;
    if (detail !== undefined) return JSON.stringify(detail);
  }
  return error instanceof Error ? error.message : String(error);
}

export function redact(message: string): string {
  const key = falKey();
  let out = message;
  // La clé entière, et aussi telle qu'écrite dans la variable (espaces compris).
  for (const secret of [key, process.env.FAL_KEY ?? ""]) {
    if (secret.length >= 8) out = out.split(secret).join("[clé masquée]");
  }
  // Tout en-tête d'autorisation cité, quelle que soit la clé.
  return out.replace(/\bKey\s+[^"'\s]+(\s+[^"'\s]+)?/gi, "Key [clé masquée]");
}
