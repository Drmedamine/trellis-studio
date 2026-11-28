"use client";

import { useRouter } from "next/navigation";
import { LANGS, pathOf, saveLang, tr, useLang, type Lang } from "@/lib/i18n";

const NAMES: Record<Lang, string> = { fr: "FR", en: "EN", ar: "عربي" };

/** Français, anglais ou arabe : le même choix sur tous les sites 3ddeal, et l'adresse de la langue. */
export default function LangSwitch() {
  const lang = useLang();
  const router = useRouter();
  return (
    <div role="group" aria-label={tr("Langue")} className="inline-flex overflow-hidden rounded-full border border-zinc-700 text-sm">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          onClick={() => {
            // Le choix vaut pour tous les sites, et la page passe à l'adresse de sa langue (/, /en, /ar).
            saveLang(l);
            router.push(pathOf(l));
          }}
          className={`h-10 min-w-11 px-3 ${lang === l ? "bg-zinc-800 text-zinc-50" : "text-zinc-400 hover:text-zinc-100"}`}
        >
          {NAMES[l]}
        </button>
      ))}
    </div>
  );
}
