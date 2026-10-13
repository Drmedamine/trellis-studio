import "server-only";
import { MissingKeyError } from "@/lib/fal";

export function failure(error: unknown) {
  if (error instanceof MissingKeyError) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  console.error(error);
  const message = error instanceof Error ? error.message : "Erreur inconnue.";
  return Response.json({ error: `Échec chez fal.ai : ${message}` }, { status: 502 });
}
