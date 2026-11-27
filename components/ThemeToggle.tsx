"use client";

import { useSyncExternalStore } from "react";
import { resolvedTheme, saveTheme, serverTheme, subscribeTheme } from "@/lib/theme";

/** Clair ou sombre : le même choix sur tous les sites 3ddeal. */
export default function ThemeToggle() {
  const sombre = useSyncExternalStore(subscribeTheme, resolvedTheme, serverTheme) === "dark";
  return (
    <button
      type="button"
      onClick={() => saveTheme(sombre ? "light" : "dark")}
      aria-pressed={sombre}
      aria-label={sombre ? "Passer en thème clair" : "Passer en thème sombre"}
      title={sombre ? "Thème clair" : "Thème sombre"}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-lg text-zinc-200 hover:border-violet-500"
    >
      {sombre ? "☾" : "☀"}
    </button>
  );
}
