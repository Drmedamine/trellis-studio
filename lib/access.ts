import "server-only";
import { timingSafeEqual } from "node:crypto";

// Chaque génération est facturée sur votre compte fal : si ACCESS_CODE est
// défini, seules les personnes qui le connaissent peuvent générer.
export function accessRequired(): boolean {
  return Boolean(process.env.ACCESS_CODE);
}

export function hasAccess(request: Request): boolean {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true;
  const given = request.headers.get("x-access-code") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function forbidden() {
  return Response.json({ error: "Code d'accès invalide." }, { status: 401 });
}
