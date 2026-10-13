import type { NextRequest } from "next/server";
import { falClient } from "@/lib/fal";
import { forbidden, hasAccess } from "@/lib/access";
import { ENDPOINT, type StatusResponse } from "@/lib/options";
import { failure, step } from "@/lib/errors";

const REQUEST_ID = /^[0-9a-f-]{8,64}$/i;

export async function GET(request: NextRequest) {
  if (!hasAccess(request)) return forbidden();

  const requestId = request.nextUrl.searchParams.get("id") ?? "";
  if (!REQUEST_ID.test(requestId)) {
    return Response.json({ error: "Identifiant invalide." }, { status: 400 });
  }

  try {
    const fal = falClient();
    const status = await step("suivi de la génération", () =>
      fal.queue.status(ENDPOINT, { requestId, logs: true }),
    );

    let body: StatusResponse;
    if (status.status === "IN_QUEUE") {
      body = { status: "queued", position: status.queue_position };
    } else if (status.status === "IN_PROGRESS") {
      body = { status: "running", logs: (status.logs ?? []).map((l) => l.message).slice(-5) };
    } else {
      const { data } = await step("lecture du résultat", () => fal.queue.result(ENDPOINT, { requestId }));
      const glb = data?.model_glb;
      body = glb?.url
        ? { status: "done", glbUrl: glb.url, fileSize: glb.file_size ?? undefined }
        : { status: "error", message: "fal.ai n'a renvoyé aucun modèle." };
    }
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
