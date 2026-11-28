import type { MetadataRoute } from "next";

import { LANGUAGE_ALTERNATES, SITE_URL } from "@/lib/site";

/** Le plan du site pour les moteurs : l'outil dans ses trois langues, chacune annonçant les autres. Le portail
 *  (3ddeal.com/sitemap.xml) le reprend. */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = Object.fromEntries(
    Object.entries(LANGUAGE_ALTERNATES).filter(([k]) => k !== "x-default").map(([k, path]) => [k, `${SITE_URL}${path === "/" ? "/" : path}`]),
  );
  return ["/", "/en", "/ar"].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: "monthly" as const,
    priority: path === "/" ? 1 : 0.9,
    alternates: { languages },
  }));
}
