import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/** Tout se lit, sauf l'API (la génération, qui demande un code d'accès). */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }], sitemap: `${SITE_URL}/sitemap.xml` };
}
