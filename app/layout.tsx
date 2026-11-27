import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import ThemeScript from "@/components/ThemeScript";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trellis Studio — image vers 3D",
  description: "Générez un modèle 3D texturé à partir d'une image avec TRELLIS.2.",
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
