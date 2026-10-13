import "server-only";
import { createFalClient } from "@fal-ai/client";

// Client côté serveur uniquement : la clé ne quitte jamais Vercel.
let client: ReturnType<typeof createFalClient> | null = null;

export function falClient() {
  const key = process.env.FAL_KEY;
  if (!key) throw new MissingKeyError();
  client ??= createFalClient({ credentials: key });
  return client;
}

export class MissingKeyError extends Error {
  constructor() {
    super("FAL_KEY n'est pas configurée sur le serveur.");
  }
}
