import "server-only";
import { falKey, MissingKeyError } from "@/lib/fal";

/**
 * Réponse d'erreur envoyée au navigateur. Le message d'une erreur réseau peut
 * citer l'en-tête d'autorisation, donc la clé : il ne part jamais tel quel.
 */
export function failure(error: unknown) {
  if (error instanceof MissingKeyError) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  const message = redact(error instanceof Error ? error.message : String(error));
  console.error(`fal.ai : ${message}`);

  const status = (error as { status?: unknown })?.status;
  if (status === 401 || status === 403) {
    return reply("Clé fal.ai refusée : vérifiez FAL_KEY dans Vercel, puis redéployez.");
  }
  if (status === 402) {
    return reply("Crédit fal.ai épuisé : rechargez votre compte sur fal.ai.");
  }
  if (status === 422) {
    return reply("fal.ai a refusé les paramètres ou l'image envoyée.");
  }
  return reply(`Échec chez fal.ai : ${message.slice(0, 200)}`);
}

function reply(message: string) {
  return Response.json({ error: message }, { status: 502 });
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
