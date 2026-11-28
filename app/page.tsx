import { Suspense } from "react";
import { connection } from "next/server";
import Generator from "@/components/Generator";
import ThemeToggle from "@/components/ThemeToggle";
import LangSwitch from "@/components/LangSwitch";
import { Credits, Lede } from "@/components/Intro";
import { accessState, type AccessState } from "@/lib/access";
import { falConfigured } from "@/lib/fal";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Trellis Studio</h1>
          <Lede />
        </div>
        {/* Clair ou sombre, et les autres applications 3ddeal (https://3ddeal.com/nav.js). */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <LangSwitch />
          <ThemeToggle />
          <span data-3ddeal-nav="" />
        </div>
      </header>
      <Suspense fallback={<div className="h-[520px] animate-pulse rounded-2xl bg-zinc-900" />}>
        <GeneratorWithConfig />
      </Suspense>
      <Credits />
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
