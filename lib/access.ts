import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { errorResponse } from "@/lib/errors";

/**
 * - `required` : ACCESS_CODE est défini, il faut le donner ;
 * - `open` : pas de code, et ce n'est pas la production (ou PUBLIC_ACCESS=1) ;
 * - `blocked` : production sans code. Chaque génération est facturée sur le
 *   compte fal : un site public sans code servirait n'importe qui à vos frais.
 */
export type AccessState = "required" | "open" | "blocked";

/** Le code attendu. Une valeur faite d'espaces compte comme absente. */
function expectedCode(): string {
  return (process.env.ACCESS_CODE ?? "").trim().normalize("NFC");
}

export function accessState(): AccessState {
  if (expectedCode()) return "required";
  if (process.env.VERCEL_ENV === "production" && process.env.PUBLIC_ACCESS !== "1") return "blocked";
  return "open";
}

export function accessRequired(): boolean {
  return accessState() === "required";
}

/**
 * Le navigateur envoie encodeURIComponent(code) : un en-tête HTTP ne porte
 * pas « é » tel quel. Un « % » isolé ne se décode pas : on garde alors la
 * valeur brute. NFC des deux côtés, sinon un « é » tapé sur Mac (e + accent)
 * ne vaut pas celui de Vercel.
 */
function givenCode(request: Request): string {
  const raw = request.headers.get("x-access-code") ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {}
  return decoded.trim().normalize("NFC");
}

// Comparés par empreinte : même durée quelle que soit la longueur du code.
function sameCode(a: string, b: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function hasAccess(request: Request): boolean {
  const state = accessState();
  if (state === "blocked") return false;
  if (state === "open") return true;
  return sameCode(givenCode(request), expectedCode());
}

export function forbidden() {
  return errorResponse("Code d'accès invalide.", 401, false);
}

export function notConfigured() {
  return errorResponse(
    "ACCESS_CODE n'est pas configuré sur le serveur : sans code, n'importe qui trouvant l'adresse pourrait générer à vos frais. Ajoutez ACCESS_CODE dans les variables d'environnement de Vercel, puis redéployez (ou PUBLIC_ACCESS=1 pour ouvrir volontairement le site à tous).",
    503,
    false,
  );
}

/** La réponse de refus, ou null si la demande peut passer. */
export function guard(request: Request): Response | null {
  if (accessState() === "blocked") return notConfigured();
  return hasAccess(request) ? null : forbidden();
}
