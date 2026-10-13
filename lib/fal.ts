import "server-only";
import { ApiError, createFalClient } from "@fal-ai/client";

// Client côté serveur uniquement : la clé ne quitte jamais Vercel.
let client: ReturnType<typeof createFalClient> | null = null;

/**
 * La clé telle que fal l'attend. Une clé ne contient jamais d'espace : collée
 * sur deux lignes dans Vercel, elle gardait un retour à la ligne, et l'en-tête
 * HTTP qui la porte était refusé avant même de partir.
 */
export function falKey(): string {
  return (process.env.FAL_KEY ?? "").replace(/\s+/g, "");
}

/** Une variable faite d'espaces n'est pas une clé : la page le dit dès l'ouverture. */
export function falConfigured(): boolean {
  return falKey() !== "";
}

export function falClient() {
  const key = falKey();
  if (!key) throw new MissingKeyError();
  client ??= createFalClient({ credentials: key });
  return client;
}

/**
 * Met une génération en file chez fal, en un seul essai. Le client de fal
 * renvoie seul un lancement qui a échoué (jusqu'à trois fois, sur 429, 502 à
 * 504 ou une coupure réseau), et rien ne permet de l'en empêcher. Or un
 * envoi arrivé chez fal est facturé, même si sa réponse se perd en route :
 * chaque nouvel essai pouvait payer une génération de plus. Le client sert
 * toujours pour l'image (sans frais), le suivi et le résultat.
 */
export async function submitOnce(endpoint: string, input: Record<string, unknown>): Promise<{ request_id?: unknown }> {
  const key = falKey();
  if (!key) throw new MissingKeyError();
  const response = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {}
  if (!response.ok) {
    // La même erreur que le client de fal : `lib/errors` en lit le code et le détail.
    const message = (body as { message?: unknown } | undefined)?.message;
    throw new ApiError({
      message: typeof message === "string" ? message : `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
      body,
    });
  }
  return body && typeof body === "object" ? (body as { request_id?: unknown }) : {};
}

export class MissingKeyError extends Error {
  constructor() {
    super("FAL_KEY n'est pas configurée sur le serveur : ajoutez-la dans Vercel, puis redéployez.");
  }
}
