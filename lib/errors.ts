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
 * Corps de toute erreur des deux routes. `retryable` dit au navigateur s'il
 * peut réessayer seul : une génération coûte de l'argent, il ne doit relancer
 * que ce qui a une chance de passer au second essai.
 */
export type ErrorBody = { error: string; retryable: boolean };

export function errorResponse(message: string, status: number, retryable: boolean) {
  const body: ErrorBody = { error: message, retryable };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export const CREDIT_MESSAGE =
  "Crédit fal.ai épuisé ou compte verrouillé : rechargez sur fal.ai/dashboard/billing.";
export const BUSY_MESSAGE = "fal.ai est saturé, réessayez dans un instant.";

// fal répond 403 (parfois 402) quand le solde est à zéro, avec un détail
// comme « User is locked. Reason: Exhausted balance ».
const CREDIT_DETAIL = /balance|locked|credit|billing|exhausted|payment/i;

/** Le code HTTP de fal, s'il y en a un : une panne réseau n'en a pas. */
export function httpStatus(error: unknown): number | undefined {
  const status = (causeOf(error) as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Oui pour ce qui passe tout seul : réseau coupé, délai dépassé, file
 * saturée, panne chez fal. Non pour ce qu'un nouvel essai répéterait à
 * l'identique : clé, crédit, demande refusée.
 */
export function isRetryable(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 408 || status === 429 || status >= 500;
}

/** Solde épuisé ou compte verrouillé : 402 toujours, 403 seulement si le détail le dit. */
export function isCreditError(error: unknown): boolean {
  const status = httpStatus(error);
  if (status === 402) return true;
  if (status !== 403) return false;
  const cause = causeOf(error);
  const message = cause instanceof Error ? cause.message : "";
  return CREDIT_DETAIL.test(describe(cause)) || CREDIT_DETAIL.test(message);
}

/** Le détail d'une erreur, sans la clé, assez court pour être montré. */
export function detailOf(error: unknown): string {
  return redact(describe(causeOf(error))).slice(0, 200);
}

/**
 * Réponse d'erreur envoyée au navigateur. Le message d'une erreur réseau peut
 * citer l'en-tête d'autorisation, donc la clé : il ne part jamais tel quel.
 */
export function failure(error: unknown) {
  const cause = causeOf(error);
  if (cause instanceof MissingKeyError) {
    return errorResponse(cause.message, 500, false);
  }
  const where = error instanceof StepError ? error.step : "appel à fal.ai";
  const status = httpStatus(error);
  const code = status !== undefined ? ` (code ${status})` : "";
  const detail = detailOf(error);
  console.error(`fal.ai, ${where}${code} : ${detail}`);

  if (isCreditError(error)) return upstream(CREDIT_MESSAGE, false);
  if (status === 401) {
    return upstream(`fal.ai ne reconnaît pas la clé${code}, à l'étape « ${where} ». ${keyHint()}`, false);
  }
  if (status === 403) {
    return upstream(`fal.ai refuse cette action à la clé${code}, à l'étape « ${where} » : ${detail}`, false);
  }
  if (status === 429) return upstream(BUSY_MESSAGE, true);
  if (status === undefined) {
    return upstream(`fal.ai ne répond pas, à l'étape « ${where} » : ${detail}. Réessayez dans un instant.`, true);
  }
  return upstream(`Échec chez fal.ai${code}, à l'étape « ${where} » : ${detail}`, isRetryable(status));
}

/**
 * Échec du lancement. Sans réponse, ou sur une erreur de serveur ou de
 * passerelle, on ne sait pas si fal a mis le travail en file : il est
 * peut-être lancé, donc facturé. Ni le navigateur ni la personne ne doivent
 * relancer à l'aveugle. Le reste (clé, crédit, refus, file saturée) dit
 * clairement que rien n'est parti : `failure` s'en charge.
 */
export function submitFailure(error: unknown) {
  const status = httpStatus(error);
  if (causeOf(error) instanceof MissingKeyError || isCreditError(error) || (status !== undefined && status < 500)) {
    return failure(error);
  }
  const code = status !== undefined ? ` (code ${status})` : "";
  const detail = detailOf(error);
  console.error(`fal.ai, lancement incertain${code} : ${detail}`);
  return upstream(
    `fal.ai n'a pas confirmé le lancement${code} : ${detail}. La génération a peut-être été lancée et facturée : vérifiez fal.ai/dashboard/requests avant de relancer.`,
    false,
  );
}

/**
 * Une clé fal complète s'écrit « identifiant:secret ». L'identifiant seul est
 * ce que montre la liste des clés, et c'est lui qu'on recopie par erreur : le
 * secret ne s'affiche qu'une fois, à la création. On le dit sans rien citer
 * de la clé.
 */
function keyHint(): string {
  if (!falKey().includes(":")) {
    return "FAL_KEY ne contient que l'identifiant de la clé (sans « : »). La clé complète s'écrit identifiant:secret et ne s'affiche qu'une fois, à sa création : créez-en une, copiez toute la valeur montrée, collez-la dans Vercel et redéployez.";
  }
  return "Vérifiez que FAL_KEY dans Vercel est bien la clé en cours (pas une clé supprimée), puis redéployez.";
}

// 502 : l'erreur vient de fal, pas de la demande. C'est `retryable` qui tranche.
function upstream(message: string, retryable: boolean) {
  return errorResponse(message, 502, retryable);
}

function causeOf(error: unknown): unknown {
  return error instanceof StepError ? error.cause : error;
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
  const raw = process.env.FAL_KEY ?? "";
  // La clé entière, telle qu'écrite dans la variable (espaces compris), et
  // chacun de ses morceaux : un message peut ne citer que le secret.
  const secrets = [key, raw, ...key.split(":"), ...raw.split(/\s+/)]
    .filter((s) => s.length >= 8)
    .sort((a, b) => b.length - a.length);
  let out = message;
  for (const secret of secrets) out = out.split(secret).join("[clé masquée]");
  // Tout en-tête d'autorisation cité, quelle que soit la clé.
  return out.replace(/\bKey\s+[^"'\s]+(\s+[^"'\s]+)?/gi, "Key [clé masquée]");
}
