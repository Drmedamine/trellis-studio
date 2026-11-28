"use client";

import { LANG_SCRIPT } from "@/lib/i18n";

/** Pose `lang` et `dir` sur <html> avant la première peinture (même recette que ThemeScript). */
export default function LangScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: LANG_SCRIPT }}
    />
  );
}
