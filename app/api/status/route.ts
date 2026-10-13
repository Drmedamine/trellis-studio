import { falClient } from "@/lib/fal";
import { guard } from "@/lib/access";
import { ENDPOINT, type StatusResponse } from "@/lib/options";
import { detailOf, errorResponse, failure, httpStatus, isCreditError, isRetryable, redact, step } from "@/lib/errors";

const REQUEST_ID = /^[0-9a-f-]{8,64}$/i;

export async function GET(request: Request) {
  const denied = guard(request);
  if (denied) return denied;

  const requestId = new URL(request.url).searchParams.get("id") ?? "";
  if (!REQUEST_ID.test(requestId)) return errorResponse("Identifiant invalide.", 400, false);

  try {
    const fal = falClient();
    const status = await step("suivi de la génération", () =>
      fal.queue.status(ENDPOINT, { requestId, logs: true }),
    );
    // Le type de fal ne connaît que trois états ; on lit ce qui arrive vraiment.
    const state: unknown = (status as { status?: unknown }).status;
    const failed = (status as { error?: unknown }).error;

    let body: StatusResponse;
    if (state === "IN_QUEUE") {
      const position = (status as { queue_position?: unknown }).queue_position;
      body = { status: "queued", position: typeof position === "number" ? position : undefined };
    } else if (state === "IN_PROGRESS") {
      body = { status: "running", logs: lastLogs(status) };
    } else if (state === "COMPLETED") {
      body =
        typeof failed === "string" && failed
          ? { status: "error", message: jobFailed(redact(failed).slice(0, 200)) }
          : await readResult(fal, requestId);
    } else if (typeof state === "string" && /fail|error|cancel/i.test(state)) {
      body = { status: "error", message: `fal.ai a interrompu la génération (état « ${state.slice(0, 40)} »).` };
    } else {
      // État inconnu : on continue d'attendre plutôt que d'annoncer un échec
      // qui n'en est peut-être pas un.
      body = { status: "queued" };
    }
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

/**
 * Le travail est fini : si fal répond une erreur en rendant le résultat,
 * c'est la génération elle-même qui a échoué (500, 422…). La relancer ne
 * changerait rien : c'est un échec définitif. Restent à part ce qui ne dit
 * rien du travail : réseau coupé, délai dépassé, file saturée, passerelle en
 * panne (408, 429, 502 à 504), clé ou crédit. Pris pour un échec, ils
 * faisaient oublier au navigateur un modèle payé, récupérable une minute plus tard.
 */
async function readResult(fal: ReturnType<typeof falClient>, requestId: string): Promise<StatusResponse> {
  try {
    const { data } = await step("lecture du résultat", () => fal.queue.result(ENDPOINT, { requestId }));
    const glb = (data as { model_glb?: { url?: unknown; file_size?: unknown } } | undefined)?.model_glb;
    if (typeof glb?.url !== "string" || !/^https:\/\//.test(glb.url)) {
      return { status: "error", message: "fal.ai n'a renvoyé aucun modèle." };
    }
    const fileSize = typeof glb.file_size === "number" ? glb.file_size : undefined;
    return { status: "done", glbUrl: glb.url, fileSize };
  } catch (error) {
    const code = httpStatus(error);
    if (code === undefined || code === 401 || (isRetryable(code) && code !== 500) || isCreditError(error)) throw error;
    return { status: "error", message: jobFailed(detailOf(error)) };
  }
}

function jobFailed(detail: string): string {
  return `La génération a échoué chez fal.ai : ${detail}`;
}

function lastLogs(status: unknown): string[] {
  const logs = (status as { logs?: unknown }).logs;
  if (!Array.isArray(logs)) return [];
  return logs
    .map((l) => (l as { message?: unknown })?.message)
    .filter((m): m is string => typeof m === "string")
    .slice(-5);
}
