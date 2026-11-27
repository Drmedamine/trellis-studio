import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Le plan du site pour les moteurs : une seule page, l'outil. Le portail (3ddeal.com/sitemap.xml) le reprend. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/`, changeFrequency: "monthly", priority: 1 }];
}
