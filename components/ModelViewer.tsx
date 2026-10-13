"use client";

import { useEffect, useRef, useState } from "react";

// Le composant web <model-viewer> touche à window : chargé dans le navigateur seulement.
export default function ModelViewer({
  src,
  alt,
  onError,
}: {
  src: string;
  alt: string;
  /** Le fichier n'a pas pu être chargé (lien expiré, GLB illisible) ; reçoit l'adresse en cause. */
  onError?: (src: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // Les dernières valeurs, lues par l'écouteur : il n'est posé qu'une fois.
  const latest = useRef({ src, onError });
  useEffect(() => {
    latest.current = { src, onError };
  });

  useEffect(() => {
    let alive = true;
    import("@google/model-viewer").then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // React ne relaie pas les évènements d'un élément personnalisé : on écoute
  // l'élément lui-même. Seul l'échec de chargement compte ; une perte du
  // contexte WebGL ne dit rien du fichier.
  useEffect(() => {
    const element = ref.current;
    if (!ready || !element) return;
    const handle = (event: Event) => {
      const type = (event as CustomEvent<{ type?: string }>).detail?.type;
      if (type === "loadfailure") latest.current.onError?.(latest.current.src);
    };
    element.addEventListener("error", handle);
    return () => element.removeEventListener("error", handle);
  }, [ready]);

  if (!ready) {
    return (
      <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">Chargement de la visionneuse…</div>
    );
  }

  // En position absolue : la hauteur vient du cadre, même quand celui-ci n'a
  // qu'une hauteur minimale (sinon « height: 100% » ne se résout pas).
  return (
    <model-viewer
      ref={ref}
      src={src}
      alt={alt}
      camera-controls
      auto-rotate
      shadow-intensity="1"
      exposure="1"
      environment-image="neutral"
      touch-action="pan-y"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", background: "transparent" }}
    />
  );
}
