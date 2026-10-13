import { Suspense } from "react";
import { connection } from "next/server";
import Generator from "@/components/Generator";
import { accessState, type AccessState } from "@/lib/access";
import { falConfigured } from "@/lib/fal";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trellis Studio</h1>
        <p className="mt-1 text-zinc-400">
          Une image → un modèle 3D texturé, avec TRELLIS.2 de Microsoft. Export GLB, et STL pour l&apos;impression.
        </p>
      </header>
      <Suspense fallback={<div className="h-[520px] animate-pulse rounded-2xl bg-zinc-900" />}>
        <GeneratorWithConfig />
      </Suspense>
      <footer className="mt-12 text-xs text-zinc-500">
        Modèle{" "}
        <a className="underline" href="https://github.com/microsoft/TRELLIS.2" target="_blank" rel="noreferrer">
          TRELLIS.2
        </a>{" "}
        (MIT), exécuté sur{" "}
        <a className="underline" href="https://fal.ai/models/fal-ai/trellis-2" target="_blank" rel="noreferrer">
          fal.ai
        </a>
        . Les images envoyées sont transmises à fal.ai.
      </footer>
    </main>
  );
}

// Lu à la requête : changer FAL_KEY ou ACCESS_CODE dans Vercel ne demande pas de reconstruire.
async function GeneratorWithConfig() {
  await connection();
  const state = accessState();
  // needsCode reste envoyé à côté d'accessState : il en est tiré, les deux ne
  // peuvent pas se contredire.
  const props: { accessState: AccessState; needsCode: boolean; configured: boolean } = {
    accessState: state,
    needsCode: state === "required",
    configured: falConfigured(),
  };
  return <Generator {...props} />;
}
