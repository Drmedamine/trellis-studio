import type { Metadata } from "next";
import { HomePage } from "@/components/HomePage";
import { LANGUAGE_ALTERNATES } from "@/lib/site";

const TITLE = "Trellis Studio — image to 3D";
const DESCRIPTION = "A photo becomes a textured 3D model (TRELLIS.2), then a solid bust ready to print: GLB and STL.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/en", languages: LANGUAGE_ALTERNATES },
  openGraph: {
    type: "website",
    url: "/en",
    siteName: "Trellis Studio · 3ddeal",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

/** La page en anglais, rendue telle quelle pour les moteurs. */
export default function Page() {
  return <HomePage lang="en" />;
}
