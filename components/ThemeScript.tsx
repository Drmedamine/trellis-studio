"use client";

import { THEME_SCRIPT } from "@/lib/theme";

/** Pose le thème choisi sur <html> avant la première peinture : pas d'éclair clair dans une page sombre (ni l'inverse). */
export default function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}
