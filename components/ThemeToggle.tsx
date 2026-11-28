"use client";

import { useSyncExternalStore } from "react";
import { resolvedTheme, saveTheme, serverTheme, subscribeTheme } from "@/lib/theme";
import { tr, useLang } from "@/lib/i18n";

/** Clair ou sombre : le même choix sur tous les sites 3ddeal. */
export default function ThemeToggle() {
  useLang();
  const sombre = useSyncExternalStore(subscribeTheme, resolvedTheme, serverTheme) === "dark";
  return (
    <button
      type="button"
      onClick={() => saveTheme(sombre ? "light" : "dark")}
      aria-pressed={sombre}
      aria-label={sombre ? tr("Passer en thème clair") : tr("Passer en thème sombre")}
      title={sombre ? tr("Thème clair") : tr("Thème sombre")}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700 text-lg text-zinc-200 hover:border-violet-500"
    >
      {sombre ? "☾" : "☀"}
    </button>
  );
}
