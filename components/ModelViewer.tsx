"use client";

import { useEffect, useState } from "react";

// Le composant web <model-viewer> touche à window : chargé dans le navigateur seulement.
export default function ModelViewer({ src, alt }: { src: string; alt: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    import("@google/model-viewer").then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    return <div className="grid h-full place-items-center text-sm text-zinc-500">Chargement de la visionneuse…</div>;
  }

  return (
    <model-viewer
      src={src}
      alt={alt}
      camera-controls
      auto-rotate
      shadow-intensity="1"
      exposure="1"
      environment-image="neutral"
      touch-action="pan-y"
      style={{ width: "100%", height: "100%", background: "transparent" }}
    />
  );
}
