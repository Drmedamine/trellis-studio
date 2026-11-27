import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import ThemeScript from "@/components/ThemeScript";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const DESCRIPTION = "Une photo devient un modèle 3D texturé (TRELLIS.2), puis un buste plein prêt à imprimer : GLB et STL.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Trellis Studio — image vers 3D",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Trellis Studio · 3ddeal",
    title: "Trellis Studio — image vers 3D",
    description: DESCRIPTION,
    locale: "fr_FR",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image", title: "Trellis Studio — image vers 3D", description: DESCRIPTION, images: ["/og.png"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        {/* Le thème choisi sur un site 3ddeal, posé avant la première peinture. */}
        <ThemeScript />
        {children}
        {/* Le bouton « 3ddeal » : passer d'une application a l'autre. */}
        <Script src="https://3ddeal.com/nav.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
