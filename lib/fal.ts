import "server-only";
import { createFalClient } from "@fal-ai/client";

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

export function falClient() {
  const key = falKey();
  if (!key) throw new MissingKeyError();
  client ??= createFalClient({ credentials: key });
  return client;
}

export class MissingKeyError extends Error {
  constructor() {
    super("FAL_KEY n'est pas configurée sur le serveur.");
  }
}
