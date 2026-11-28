"use client";

import { PageLang, type Lang } from "@/lib/i18n";

/** La langue d'une page préfixée (/en, /ar), transmise à tout ce qu'elle affiche. */
export default function LangProvider({ lang, children }: { lang: Lang | null; children: React.ReactNode }) {
  return <PageLang value={lang}>{children}</PageLang>;
}
