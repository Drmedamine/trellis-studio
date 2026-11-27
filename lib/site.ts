/** L'adresse publique du site : NEXT_PUBLIC_SITE_URL si elle est donnée, sinon celle de 3ddeal. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://trellis.3ddeal.com").replace(/\/+$/, "");
