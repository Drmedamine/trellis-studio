import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@fal-ai/client";
import { MissingKeyError } from "@/lib/fal";
import { CREDIT_MESSAGE, failure, isCreditError, isRetryable, redact, step, StepError, submitFailure } from "@/lib/errors";

// Une fausse clé, au format de fal : identifiant:secret.
const ID = "0b1e2c3d-4f5a-6b7c-8d9e-0f1a2b3c4d5e";
const SECRET = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const KEY = `${ID}:${SECRET}`;

function apiError(status: number, detail?: string) {
  return new ApiError({
    message: detail ?? `HTTP ${status}`,
    status,
    body: detail === undefined ? undefined : { detail },
  });
}

async function json(response: Response) {
  return { status: response.status, body: (await response.json()) as { error: string; retryable: boolean } };
}

let logged: string[];

beforeEach(() => {
  logged = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("redact", () => {
  it("masque la clé citée en clair, entière ou en morceaux", () => {
    vi.stubEnv("FAL_KEY", KEY);
    const out = redact(`refusée : ${KEY} ; secret seul ${SECRET}`);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ID);
    expect(out).toContain("[clé masquée]");
  });

  it("masque la clé telle qu'écrite dans la variable, retour à la ligne compris", () => {
    vi.stubEnv("FAL_KEY", `${ID}:\n${SECRET}\n`);
    const out = redact(`valeur brute ${ID}:\n${SECRET} et collée ${KEY}`);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ID);
  });

  it("masque tout en-tête « Key … », même d'une autre clé", () => {
    vi.stubEnv("FAL_KEY", KEY);
    const out = redact('Invalid header value "Authorization: Key autre-id:autre-secret"');
    expect(out).not.toContain("autre-secret");
    expect(out).toContain("Key [clé masquée]");
  });
});

describe("failure", () => {
  it("401 : signale une FAL_KEY réduite à l'identifiant, sans la citer", async () => {
    vi.stubEnv("FAL_KEY", ID);
    const { status, body } = await json(failure(new StepError("envoi de l'image", apiError(401, `No user found for Key ${ID}`))));
    expect(status).toBe(502);
    expect(body.retryable).toBe(false);
    expect(body.error).toContain("ne contient que l'identifiant");
    expect(body.error).toContain("envoi de l'image");
    expect(body.error).not.toContain(ID);
    expect(logged.join("\n")).not.toContain(ID);
  });

  it("401 avec une clé complète : conseille de vérifier la clé en cours", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    const { body } = await json(failure(apiError(401, "Unauthorized")));
    expect(body.error).not.toContain("ne contient que l'identifiant");
    expect(body.error).toContain("clé en cours");
    expect(body.retryable).toBe(false);
  });

  it("403 « Exhausted balance » : message de crédit, définitif", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    const error = new StepError("lancement du modèle", apiError(403, "User is locked. Reason: Exhausted balance"));
    expect(isCreditError(error)).toBe(true);
    const { body } = await json(failure(error));
    expect(body).toEqual({ error: CREDIT_MESSAGE, retryable: false });
    expect(CREDIT_MESSAGE).toBe(
      "Crédit fal.ai épuisé ou compte verrouillé : rechargez sur fal.ai/dashboard/billing.",
    );
  });

  it("402 : message de crédit ; 403 sans rapport : refus de la clé", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    expect((await json(failure(apiError(402, "Payment Required")))).body.error).toBe(CREDIT_MESSAGE);
    const other = await json(failure(apiError(403, "Not allowed to use this endpoint")));
    expect(isCreditError(apiError(403, "Not allowed to use this endpoint"))).toBe(false);
    expect(other.body.error).toContain("refuse cette action");
    expect(other.body.retryable).toBe(false);
  });

  it("429 : fal saturé, on peut réessayer", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    const { body } = await json(failure(apiError(429, "Too Many Requests")));
    expect(body).toEqual({ error: "fal.ai est saturé, réessayez dans un instant.", retryable: true });
  });

  it("réseau coupé et 5xx : on peut réessayer ; 4xx : non", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    const network = await step("envoi de l'image", () => Promise.reject(new TypeError("fetch failed"))).catch((e) => e);
    expect((await json(failure(network))).body.retryable).toBe(true);
    for (const status of [500, 502, 503, 504]) {
      expect((await json(failure(apiError(status, "boom")))).body.retryable).toBe(true);
    }
    for (const status of [400, 401, 402, 403, 404, 422]) {
      expect((await json(failure(apiError(status, "non")))).body.retryable).toBe(false);
    }
    expect(isRetryable(undefined)).toBe(true);
    expect(isRetryable(408)).toBe(true);
  });

  it("clé absente : 500, définitif, même relevée pendant une étape", async () => {
    for (const error of [new MissingKeyError(), new StepError("lancement du modèle", new MissingKeyError())]) {
      const { status, body } = await json(failure(error));
      expect(status).toBe(500);
      expect(body.retryable).toBe(false);
      expect(body.error).toContain("FAL_KEY");
    }
  });

  it("le détail d'une erreur ne cite jamais la clé", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    const { body } = await json(failure(apiError(500, `upstream said ${KEY}`)));
    expect(body.error).not.toContain(SECRET);
    expect(logged.join("\n")).not.toContain(SECRET);
  });
});

describe("submitFailure", () => {
  const launch = (cause: unknown) => new StepError("lancement du modèle", cause);

  it("sans réponse ou en 5xx : peut-être lancé, donc ni relance ni « réessayez »", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    for (const cause of [new TypeError("fetch failed"), apiError(500, "boom"), apiError(502), apiError(503), apiError(504)]) {
      const { status, body } = await json(submitFailure(launch(cause)));
      expect(status).toBe(502);
      expect(body.retryable).toBe(false);
      expect(body.error).toContain("fal.ai/dashboard/requests");
      expect(body.error).not.toMatch(/réessayez dans un instant/i);
    }
  });

  it("refus net (429, clé, crédit) : rien n'est parti, même réponse que failure", async () => {
    vi.stubEnv("FAL_KEY", KEY);
    expect((await json(submitFailure(launch(apiError(429, "Too Many Requests"))))).body.retryable).toBe(true);
    expect((await json(submitFailure(launch(apiError(403, "Exhausted balance"))))).body.error).toBe(CREDIT_MESSAGE);
    expect((await json(submitFailure(launch(new MissingKeyError())))).status).toBe(500);
  });
});
