import type { Metadata } from "next";
import { HomePage } from "@/components/HomePage";
import { LANGUAGE_ALTERNATES } from "@/lib/site";

const TITLE = "Trellis Studio — من صورة إلى مجسم ثلاثي الأبعاد";
const DESCRIPTION = "تتحوّل صورة إلى مجسم ثلاثي الأبعاد بملمس (TRELLIS.2)، ثم إلى تمثال نصفي مصمت جاهز للطباعة: GLB وSTL.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/ar", languages: LANGUAGE_ALTERNATES },
  openGraph: {
    type: "website",
    url: "/ar",
    siteName: "Trellis Studio · 3ddeal",
    title: TITLE,
    description: DESCRIPTION,
    locale: "ar_MA",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.png"] },
};

/** La page en arabe, rendue telle quelle pour les moteurs. */
export default function Page() {
  return <HomePage lang="ar" />;
}
