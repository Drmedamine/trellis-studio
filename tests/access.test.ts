import { afterEach, describe, expect, it, vi } from "vitest";
import { accessRequired, accessState, guard, hasAccess } from "@/lib/access";

/** Ce qu'envoie le navigateur : encodeURIComponent(code.trim()). */
function withCode(code: string | null, raw = false) {
  const headers = new Headers();
  if (code !== null) headers.set("x-access-code", raw ? code : encodeURIComponent(code.trim()));
  return new Request("http://localhost/api/status?id=abc", { headers });
}

function env(values: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => vi.unstubAllEnvs());

describe("accessState", () => {
  it("required dès qu'ACCESS_CODE a une valeur, même entourée d'espaces", () => {
    env({ ACCESS_CODE: "  atelier  ", VERCEL_ENV: "production" });
    expect(accessState()).toBe("required");
    expect(accessRequired()).toBe(true);
  });

  it("un ACCESS_CODE fait d'espaces compte comme absent", () => {
    env({ ACCESS_CODE: "   ", VERCEL_ENV: undefined, PUBLIC_ACCESS: undefined });
    expect(accessState()).toBe("open");
    expect(accessRequired()).toBe(false);
  });

  it("en production sans code : bloqué", () => {
    env({ ACCESS_CODE: undefined, VERCEL_ENV: "production", PUBLIC_ACCESS: undefined });
    expect(accessState()).toBe("blocked");
    env({ ACCESS_CODE: " " });
    expect(accessState()).toBe("blocked");
  });

  it("PUBLIC_ACCESS=1 ouvre volontairement la production", () => {
    env({ ACCESS_CODE: undefined, VERCEL_ENV: "production", PUBLIC_ACCESS: "1" });
    expect(accessState()).toBe("open");
    env({ PUBLIC_ACCESS: "true" });
    expect(accessState()).toBe("blocked");
  });

  it("en local (pas de VERCEL_ENV) et en préversion : ouvert", () => {
    env({ ACCESS_CODE: undefined, VERCEL_ENV: undefined, PUBLIC_ACCESS: undefined });
    expect(accessState()).toBe("open");
    env({ VERCEL_ENV: "preview" });
    expect(accessState()).toBe("open");
  });
});

describe("hasAccess", () => {
  it("compare après trim des deux côtés", () => {
    env({ ACCESS_CODE: " atelier\n" });
    expect(hasAccess(withCode("atelier"))).toBe(true);
    expect(hasAccess(withCode("  atelier  "))).toBe(true);
    expect(hasAccess(withCode(" atelier ", true))).toBe(true);
    expect(hasAccess(withCode("Atelier"))).toBe(false);
    expect(hasAccess(withCode(null))).toBe(false);
    expect(hasAccess(withCode(""))).toBe(false);
  });

  it("accepte un code accentué envoyé encodé, quelle que soit sa forme Unicode", () => {
    env({ ACCESS_CODE: "café-crème" });
    expect(hasAccess(withCode("café-crème"))).toBe(true);
    // « é » décomposé (e + accent), comme le tape un Mac.
    expect(hasAccess(withCode("café-crème"))).toBe(true);
    expect(hasAccess(withCode("cafe-creme"))).toBe(false);
  });

  it("un « % » qui ne se décode pas est comparé tel quel", () => {
    env({ ACCESS_CODE: "100%" });
    expect(hasAccess(withCode("100%", true))).toBe(true);
    expect(hasAccess(withCode("100%"))).toBe(true);
  });

  it("n'écarte pas les codes courts", () => {
    env({ ACCESS_CODE: "a" });
    expect(hasAccess(withCode("a"))).toBe(true);
    expect(hasAccess(withCode("b"))).toBe(false);
  });

  it("ouvert : tout passe ; bloqué : rien ne passe", () => {
    env({ ACCESS_CODE: undefined, VERCEL_ENV: undefined, PUBLIC_ACCESS: undefined });
    expect(hasAccess(withCode(null))).toBe(true);
    env({ VERCEL_ENV: "production" });
    expect(hasAccess(withCode("n'importe quoi"))).toBe(false);
  });
});

describe("guard", () => {
  it("503 avec un message clair quand la production n'a pas de code", async () => {
    env({ ACCESS_CODE: undefined, VERCEL_ENV: "production", PUBLIC_ACCESS: undefined });
    const response = guard(withCode("x"));
    expect(response?.status).toBe(503);
    const body = await response!.json();
    expect(body.retryable).toBe(false);
    expect(body.error).toMatch(/^ACCESS_CODE n'est pas configuré/);
  });

  it("401 pour un mauvais code, null pour le bon", async () => {
    env({ ACCESS_CODE: "atelier" });
    const response = guard(withCode("faux"));
    expect(response?.status).toBe(401);
    expect(await response!.json()).toEqual({ error: "Code d'accès invalide.", retryable: false });
    expect(guard(withCode("atelier"))).toBeNull();
  });
});
