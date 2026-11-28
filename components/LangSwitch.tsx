"use client";

import { LANGS, saveLang, tr, useLang, type Lang } from "@/lib/i18n";

const NAMES: Record<Lang, string> = { fr: "FR", en: "EN", ar: "عربي" };

/** Français, anglais ou arabe : le même choix sur tous les sites 3ddeal. */
export default function LangSwitch() {
  const lang = useLang();
  return (
    <div role="group" aria-label={tr("Langue")} className="inline-flex overflow-hidden rounded-full border border-zinc-700 text-sm">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => saveLang(l)}
          className={`h-10 min-w-11 px-3 ${lang === l ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}
        >
          {NAMES[l]}
        </button>
      ))}
    </div>
  );
}
