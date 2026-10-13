import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@fal-ai/client";

// Un faux client fal : les routes sont appelées pour de vrai, rien ne part chez fal.
const fal = vi.hoisted(() => ({
  storage: { upload: vi.fn() },
  queue: { status: vi.fn(), result: vi.fn() },
}));
const falClient = vi.hoisted(() => vi.fn());
// Le lancement part par un fetch direct (un seul essai) : c'est lui qu'on intercepte.
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/fal", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fal")>()),
  falClient,
}));

import { POST } from "@/app/api/generate/route";
import { GET } from "@/app/api/status/route";
import { MissingKeyError } from "@/lib/fal";
import { CREDIT_MESSAGE } from "@/lib/errors";

const ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

function image(type = "image/png") {
  return new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], "photo.png", { type });
}

function generate(fields: Record<string, string | File>, code?: string) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  const headers = code === undefined ? undefined : { "x-access-code": encodeURIComponent(code) };
  return POST(new Request("http://localhost/api/generate", { method: "POST", body: form, headers }));
}

function status(id = ID, code?: string) {
  const headers = code === undefined ? undefined : { "x-access-code": encodeURIComponent(code) };
  return GET(new Request(`http://localhost/api/status?id=${encodeURIComponent(id)}`, { headers }));
}

async function json(response: Response) {
  return { status: response.status, body: await response.json() };
}

function apiError(code: number, detail: string) {
  return new ApiError({ message: detail, status: code, body: { detail } });
}

/** Ce que la route a envoyé à la file de fal, au dernier lancement. */
function submitted() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, input: JSON.parse(String(init.body)) };
}

function falAnswers(code: number, detail: string) {
  fetchMock.mockImplementation(async () => Response.json({ detail }, { status: code }));
}

beforeEach(() => {
  vi.stubEnv("FAL_KEY", "identifiant-de-test:secret-de-test-0123456789");
  vi.stubEnv("ACCESS_CODE", undefined);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("PUBLIC_ACCESS", undefined);
  falClient.mockReturnValue(fal);
  fal.storage.upload.mockResolvedValue("https://v3.fal.media/files/photo.png");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => Response.json({ request_id: ID }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("POST /api/generate", () => {
  it("refuse un format d'image non pris en charge (400, définitif)", async () => {
    const { status: code, body } = await json(await generate({ image: image("image/gif") }));
    expect(code).toBe(400);
    expect(body).toEqual({ error: "Format accepté : PNG, JPEG ou WebP.", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuse un mauvais code d'accès (401)", async () => {
    vi.stubEnv("ACCESS_CODE", "atelier");
    const { status: code, body } = await json(await generate({ image: image() }, "faux"));
    expect(code).toBe(401);
    expect(body.retryable).toBe(false);
    expect(fal.storage.upload).not.toHaveBeenCalled();
  });

  it("accepte un code accentué, envoyé encodé", async () => {
    vi.stubEnv("ACCESS_CODE", "Mûrier");
    expect((await generate({ image: image() }, "Mûrier")).status).toBe(200);
  });

  it("refuse tout en production sans ACCESS_CODE (503), sans appeler fal", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const { status: code, body } = await json(await generate({ image: image() }));
    expect(code).toBe(503);
    expect(body.retryable).toBe(false);
    expect(body.error).toMatch(/^ACCESS_CODE n'est pas configuré/);
    expect(falClient).not.toHaveBeenCalled();
  });

  it("lance la génération et rend le requestId", async () => {
    const { status: code, body } = await json(
      await generate({
        image: image(),
        resolution: "1536",
        textureSize: "4096",
        decimationTarget: "50000",
        remesh: "false",
        seed: "0",
      }),
    );
    expect(code).toBe(200);
    expect(body).toEqual({ requestId: ID });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, input } = submitted();
    expect(url).toBe("https://queue.fal.run/fal-ai/trellis-2");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Key identifiant-de-test:secret-de-test-0123456789",
    );
    expect(input).toEqual({
      image_url: "https://v3.fal.media/files/photo.png",
      resolution: "1536",
      texture_size: "4096",
      decimation_target: 50_000,
      remesh: false,
      seed: 0,
    });
  });

  it("graine : 0 à 999 999 999 acceptés, le reste refusé", async () => {
    await generate({ image: image(), seed: "999999999" });
    expect(submitted().input.seed).toBe(999_999_999);
    await generate({ image: image(), seed: "" });
    expect(submitted().input).not.toHaveProperty("seed");
    for (const seed of ["1000000000", "-1", "1.5", "abc"]) {
      expect((await generate({ image: image(), seed })).status).toBe(400);
    }
  });

  it("crédit épuisé au stockage : pas de repli en data URI", async () => {
    fal.storage.upload.mockRejectedValue(apiError(403, "User is locked. Reason: Exhausted balance"));
    const { status: code, body } = await json(await generate({ image: image() }));
    expect(code).toBe(502);
    expect(body).toEqual({ error: CREDIT_MESSAGE, retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stockage refusé à la clé : l'image part en data URI", async () => {
    fal.storage.upload.mockRejectedValue(apiError(403, "Insufficient permissions for storage"));
    expect((await generate({ image: image() })).status).toBe(200);
    expect(submitted().input.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it("file saturée (429) : rien n'est parti, erreur à réessayer", async () => {
    falAnswers(429, "Too Many Requests");
    expect((await json(await generate({ image: image() }))).body.retryable).toBe(true);
  });

  it("crédit épuisé au lancement : message de crédit", async () => {
    falAnswers(403, "User is locked. Reason: Exhausted balance");
    expect((await json(await generate({ image: image() }))).body).toEqual({ error: CREDIT_MESSAGE, retryable: false });
  });

  it("lancement sans réponse ou en panne de passerelle : un seul essai, et pas de relance à l'aveugle", async () => {
    // Le travail a peut-être été mis en file, donc facturé : ni nouvel essai
    // automatique, ni « réessayez » qui ferait payer une deuxième fois.
    for (const answer of [
      () => fetchMock.mockRejectedValue(new TypeError("fetch failed")),
      () => falAnswers(502, "Bad Gateway"),
      () => falAnswers(503, "Service Unavailable"),
      () => falAnswers(504, "Gateway Timeout"),
    ]) {
      fetchMock.mockReset();
      answer();
      const { status: code, body } = await json(await generate({ image: image() }));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(code).toBe(502);
      expect(body.retryable).toBe(false);
      expect(body.error).toMatch(/peut-être été lancée et facturée/);
      expect(body.error).toContain("fal.ai/dashboard/requests");
      expect(body.error).not.toContain("secret-de-test");
    }
  });

  it("FAL_KEY absente : 500, définitif", async () => {
    falClient.mockImplementation(() => {
      throw new MissingKeyError();
    });
    const { status: code, body } = await json(await generate({ image: image() }));
    expect(code).toBe(500);
    expect(body.retryable).toBe(false);
  });
});

describe("GET /api/status", () => {
  it("refuse un identifiant invalide (400)", async () => {
    const { status: code, body } = await json(await status("../../etc"));
    expect(code).toBe(400);
    expect(body.retryable).toBe(false);
  });

  it("refuse un mauvais code d'accès (401)", async () => {
    vi.stubEnv("ACCESS_CODE", "atelier");
    expect((await status(ID, "faux")).status).toBe(401);
    fal.queue.status.mockResolvedValue({ status: "IN_QUEUE", queue_position: 0 });
    expect((await status(ID, "atelier")).status).toBe(200);
  });

  it("en file d'attente → queued, avec la position", async () => {
    fal.queue.status.mockResolvedValue({ status: "IN_QUEUE", queue_position: 3 });
    const response = await status();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "queued", position: 3 });
  });

  it("en cours → running, avec les cinq derniers journaux", async () => {
    const logs = Array.from({ length: 7 }, (_, i) => ({ message: `étape ${i}` }));
    fal.queue.status.mockResolvedValue({ status: "IN_PROGRESS", logs });
    expect(await (await status()).json()).toEqual({
      status: "running",
      logs: ["étape 2", "étape 3", "étape 4", "étape 5", "étape 6"],
    });
  });

  it("terminé → done, avec l'URL du GLB", async () => {
    fal.queue.status.mockResolvedValue({ status: "COMPLETED", logs: [] });
    fal.queue.result.mockResolvedValue({
      data: { model_glb: { url: "https://v3.fal.media/files/model.glb", file_size: 1234 } },
      requestId: ID,
    });
    expect(await (await status()).json()).toEqual({
      status: "done",
      glbUrl: "https://v3.fal.media/files/model.glb",
      fileSize: 1234,
    });
  });

  it("terminé sans modèle → error", async () => {
    fal.queue.status.mockResolvedValue({ status: "COMPLETED", logs: [] });
    fal.queue.result.mockResolvedValue({ data: {}, requestId: ID });
    const { status: code, body } = await json(await status());
    expect(code).toBe(200);
    expect(body.status).toBe("error");
  });

  it("travail échoué chez fal → 200 status error, même avec un 5xx", async () => {
    fal.queue.status.mockResolvedValue({ status: "COMPLETED", logs: [] });
    fal.queue.result.mockRejectedValue(apiError(500, "CUDA out of memory"));
    const { status: code, body } = await json(await status());
    expect(code).toBe(200);
    expect(body.status).toBe("error");
    expect(body.message).toContain("CUDA out of memory");

    fal.queue.result.mockRejectedValue(apiError(422, "Could not detect any object"));
    expect((await json(await status())).body.status).toBe("error");
  });

  it("terminé avec une erreur annoncée dans l'état → error, sans lire le résultat", async () => {
    fal.queue.status.mockResolvedValue({ status: "COMPLETED", logs: [], error: "Internal error" });
    const { body } = await json(await status());
    expect(body).toEqual({ status: "error", message: "La génération a échoué chez fal.ai : Internal error" });
    expect(fal.queue.result).not.toHaveBeenCalled();
  });

  it("réseau coupé en lisant le résultat : erreur à réessayer, pas un échec", async () => {
    fal.queue.status.mockResolvedValue({ status: "COMPLETED", logs: [] });
    fal.queue.result.mockRejectedValue(new TypeError("fetch failed"));
    const { status: code, body } = await json(await status());
    expect(code).toBe(502);
    expect(body.retryable).toBe(true);
  });

  it("passerelle en panne en lisant le résultat (408, 429, 502 à 504) : à réessayer, le modèle payé n'est pas perdu", async () => {
    fal.queue.status.mockResolvedValue({ status: "COMPLETED", logs: [] });
    for (const code of [408, 429, 502, 503, 504]) {
      fal.queue.result.mockRejectedValue(apiError(code, "Service Unavailable"));
      const { status: http, body } = await json(await status());
      expect(http).toBe(502);
      expect(body.retryable).toBe(true);
      expect(body).not.toHaveProperty("status");
    }
  });

  it("suivi en panne chez fal (5xx) : à réessayer ; 404 : définitif", async () => {
    fal.queue.status.mockRejectedValue(apiError(503, "Service Unavailable"));
    expect((await json(await status())).body).toMatchObject({ retryable: true });
    fal.queue.status.mockRejectedValue(apiError(404, "Request not found"));
    expect((await json(await status())).body).toMatchObject({ retryable: false });
  });

  it("crédit épuisé au suivi : message de crédit", async () => {
    fal.queue.status.mockRejectedValue(apiError(403, "User is locked. Reason: Exhausted balance"));
    expect((await json(await status())).body).toEqual({ error: CREDIT_MESSAGE, retryable: false });
  });

  it("état inconnu : annulé → error ; autre → on continue d'attendre", async () => {
    fal.queue.status.mockResolvedValue({ status: "CANCELLED" });
    expect((await json(await status())).body.status).toBe("error");
    fal.queue.status.mockResolvedValue({ status: "SOMETHING_NEW" });
    expect((await json(await status())).body).toEqual({ status: "queued" });
  });
});
