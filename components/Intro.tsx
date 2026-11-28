"use client";

import { tr, useLang } from "@/lib/i18n";

/** Ce que fait le site, dans la langue choisie. */
export function Lede() {
  useLang();
  return <p className="mt-1 text-zinc-400">{tr("Une image → un modèle 3D texturé, avec TRELLIS.2 de Microsoft. Export GLB, et STL pour l'impression.")}</p>;
}

/** Le modèle et l'endroit où il tourne. */
export function Credits() {
  useLang();
  const [avant, entre, apres] = tr("Modèle {0} (MIT), exécuté sur {1}. Les images envoyées sont transmises à fal.ai.").split(/\{(?:0|1)\}/);
  return (
    <footer className="mt-12 text-xs text-zinc-500">
      {/* Le pied de page commun aux sites 3ddeal (posé par https://3ddeal.com/nav.js). */}
      <div data-3ddeal-footer="" className="mb-3 border-t border-zinc-800" />
      {avant}
      <a className="underline" href="https://github.com/microsoft/TRELLIS.2" target="_blank" rel="noreferrer">
        TRELLIS.2
      </a>
      {entre}
      <a className="underline" href="https://fal.ai/models/fal-ai/trellis-2" target="_blank" rel="noreferrer">
        fal.ai
      </a>
      {apres}
    </footer>
  );
}
