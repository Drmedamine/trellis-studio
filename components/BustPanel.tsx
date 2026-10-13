"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
// Types seuls : le module (et three avec lui) n'est chargé qu'à l'ouverture du panneau.
import type * as Bust from "@/lib/bust/client";
import NumberField, { type NumberFieldHandle } from "./NumberField";

const FINESSES = [
  { label: "Rapide", voxel: 0.8 },
  { label: "Normal", voxel: 0.55 },
  { label: "Fin", voxel: 0.4 },
] as const;

// Même texte que la visionneuse : les deux constatent la même chose.
const EXPIRED_MESSAGE =
  "Ce modèle n'est plus disponible chez fal.ai (lien expiré) : régénérez-le ou rouvrez le GLB téléchargé.";

/** Au-delà de 5 % d'écart, la finesse annoncée n'est plus celle qu'on obtiendra. */
const COARSER = 1.05;
/** En dessous de 1 % de volume jeté, ce ne sont que des miettes : rien à signaler. */
const REMOVED_NOTICE = 0.01;

type Loaded = { client: typeof Bust; raw: Bust.RawMesh };

type Result = {
  /** Les réglages du calcul : le résultat ne vaut que pour eux. */
  settings: Bust.BustSettings;
  stl: Blob;
  previewUrl: string;
  size: [number, number, number];
  volume: number;
  triangles: number;
  voxel: number;
  removedFraction: number;
};

/**
 * Fait du modèle généré un buste imprimable : coupé à plat, plein, fermé,
 * sur un socle. Tout se calcule dans le navigateur.
 *
 * La hauteur appartient à la page (le STL brut prend la même) : le panneau
 * la reçoit et la renvoie, il ne la garde pas. Son champ est tenu par la
 * page, qui lit la saisie en cours de l'un ou l'autre champ (`commitHeight`).
 */
export default function BustPanel({
  glbUrl,
  name,
  onPreview,
  heightMm,
  heightMin,
  heightMax,
  onHeightChange,
  heightField,
  commitHeight,
}: {
  glbUrl: string;
  name: string;
  onPreview: (url: string | null) => void;
  /** Hauteur totale voulue, socle compris, en mm. */
  heightMm: number;
  heightMin: number;
  heightMax: number;
  onHeightChange: (mm: number) => void;
  heightField: RefObject<NumberFieldHandle | null>;
  /** La hauteur à employer, saisie en cours comprise, dans ce champ ou celui du STL brut. */
  commitHeight: () => number;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cut, setCut] = useState(0.3);
  const [base, setBase] = useState(true);
  const [voxel, setVoxel] = useState<number>(FINESSES[1].voxel);
  const [busy, setBusy] = useState<{ fraction: number; step: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showBust, setShowBust] = useState(true);
  // Relance la lecture du modèle : une panne passagère de fal ne doit pas obliger à recharger.
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    let alive = true;
    import("@/lib/bust/client")
      .then(async (client) => {
        const raw = await client.loadRawMesh(glbUrl);
        if (alive) setLoaded({ client, raw });
      })
      .catch((e) => alive && setLoadError(loadMessage(e, glbUrl)));
    return () => {
      alive = false;
    };
  }, [glbUrl, attempt]);

  // Un résultat ne vaut que pour les réglages qui l'ont produit. Le comparer
  // plutôt que l'effacer à chaque changement : la hauteur peut changer depuis
  // le STL brut, ou pendant un calcul, et revenir aux mêmes réglages le retrouve.
  const shown =
    result &&
    result.settings.heightMm === heightMm &&
    result.settings.cut === cut &&
    result.settings.base === base &&
    result.settings.voxel === voxel
      ? result
      : null;

  // La finesse réellement employée, connue avant de lancer quoi que ce soit.
  const planned = useMemo(() => {
    if (!loaded) return null;
    try {
      return loaded.client.plannedBustVoxel(loaded.raw, { heightMm, cut, base, voxel });
    } catch {
      return null;
    }
  }, [loaded, heightMm, cut, base, voxel]);
  const coarser = planned !== null && planned > voxel * COARSER;

  // L'aperçu suit le choix « buste / original » ; il est rendu en partant.
  useEffect(() => {
    onPreview(shown && showBust ? shown.previewUrl : null);
  }, [shown, showBust, onPreview]);
  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.previewUrl);
  }, [result]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onPreview(null);
    };
  }, [onPreview]);

  async function prepare() {
    if (!loaded || busy) return;
    // Une hauteur en cours de saisie compte, ici ou dans le champ du STL brut.
    const settings: Bust.BustSettings = { heightMm: commitHeight(), cut, base, voxel };
    setError(null);
    setResult(null);
    setBusy({ fraction: 0, step: "Préparation" });
    try {
      const { makeBust, toStl, toPreviewGlb } = loaded.client;
      const out = await makeBust(loaded.raw, settings, (fraction, step) => setBusy({ fraction, step }));
      setBusy({ fraction: 0.98, step: "Aperçu" });
      const previewUrl = await toPreviewGlb(out.positions, out.indices);
      // Panneau fermé pendant le calcul : personne ne rendrait l'aperçu.
      if (!mounted.current) {
        URL.revokeObjectURL(previewUrl);
        return;
      }
      setResult({
        settings,
        stl: toStl(out.positions, out.indices),
        previewUrl,
        size: out.size,
        volume: out.volume,
        triangles: out.indices.length / 3,
        voxel: out.voxel,
        removedFraction: out.removedFraction,
      });
      setShowBust(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function download() {
    if (!shown) return;
    const url = URL.createObjectURL(shown.stl);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-buste-${Math.round(shown.settings.heightMm)}mm.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="border-t border-zinc-800 p-4 text-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <h2 className="font-medium text-zinc-100">Buste imprimable</h2>
        <span className="text-xs text-zinc-500">Plein, fermé, posé sur un socle — calculé dans votre navigateur.</span>
      </div>

      {loadError ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-red-400">✗ {loadError}</p>
          {!glbUrl.startsWith("blob:") && (
            <button
              onClick={() => {
                setLoadError(null);
                setAttempt((n) => n + 1);
              }}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-zinc-200 hover:border-zinc-500"
            >
              Réessayer
            </button>
          )}
        </div>
      ) : !loaded ? (
        <p className="text-zinc-500">Lecture du modèle…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Silhouette raw={loaded.raw} cut={cut} />
          <div className="flex min-w-0 flex-col gap-3">
            <label className="flex flex-col gap-1 text-zinc-400">
              <span className="text-xs uppercase tracking-wide">
                Coupe : {Math.round(cut * 100)} % du bas retirés
              </span>
              <input
                type="range"
                min={0}
                max={0.9}
                step={0.01}
                value={cut}
                disabled={!!busy}
                onChange={(e) => setCut(Number(e.target.value))}
                className="accent-violet-500"
              />
              <span className="text-xs text-zinc-500">
                Placez la ligne sous le menton ou au cou : tout ce qui est en dessous (vêtements en feuilles) part.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-zinc-300">
              <label className="flex items-center gap-2" title="Socle compris. Le STL brut prend la même hauteur.">
                Hauteur
                <NumberField
                  ref={heightField}
                  value={heightMm}
                  min={heightMin}
                  max={heightMax}
                  onCommit={onHeightChange}
                  disabled={!!busy}
                  aria-label="Hauteur totale du buste, socle compris, en millimètres"
                  className="w-20"
                />
                mm
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={base}
                  disabled={!!busy}
                  onChange={(e) => setBase(e.target.checked)}
                />
                Socle
              </label>
              <label className="flex items-center gap-2">
                Finesse
                <select value={voxel} disabled={!!busy} onChange={(e) => setVoxel(Number(e.target.value))}>
                  {FINESSES.map((f) => (
                    <option key={f.voxel} value={f.voxel}>
                      {f.label} ({mm(f.voxel)} mm)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {coarser && !shown && (
              <p className="text-xs text-amber-300">
                ⚠ Finesse réelle ≈ {mm(planned)} mm : modèle trop grand pour cette finesse, réduisez la hauteur.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={prepare}
                disabled={!!busy}
                className="rounded-lg bg-violet-600 px-3 py-2 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {busy ? "Calcul…" : shown ? "Recalculer" : "Préparer le buste"}
              </button>
              {shown && (
                <>
                  <button
                    onClick={download}
                    className="rounded-lg bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white"
                  >
                    Télécharger le STL du buste
                  </button>
                  <label className="flex items-center gap-2 text-zinc-400">
                    <input type="checkbox" checked={showBust} onChange={(e) => setShowBust(e.target.checked)} />
                    Voir le buste
                  </label>
                </>
              )}
            </div>

            {busy && (
              <div className="flex items-center gap-3 text-zinc-400">
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-800">
                  <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.round(busy.fraction * 100)}%` }} />
                </div>
                <span className="text-xs">{busy.step}</span>
              </div>
            )}
            {error && <p className="text-red-400">✗ {error}</p>}
            {shown && !busy && (
              <>
                <p className="text-xs text-emerald-400">
                  ✓ Volume fermé, prêt pour le slicer : {shown.size.map((v) => Math.round(v)).join(" × ")} mm,{" "}
                  {(shown.volume / 1000).toFixed(0)} cm³ en plein, {Math.round(shown.triangles / 1000)}k triangles,
                  finesse {mm(shown.voxel)} mm
                  {shown.voxel > shown.settings.voxel * COARSER && " (grossie : modèle trop grand pour la finesse choisie)"}.
                </p>
                {shown.removedFraction > REMOVED_NOTICE && (
                  <p className="text-xs text-amber-300">
                    ⚠ {percent(shown.removedFraction)} du volume détaché a été retiré (débris ou accessoire) : vérifiez
                    l&apos;aperçu.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Ce que l'échec de lecture veut dire pour qui a lancé la génération. */
function loadMessage(error: unknown, url: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (url.startsWith("blob:")) return `Ce fichier GLB n'a pas pu être lu (${message}).`;
  // Le chargeur de three dit « fetch for "…" responded with 404: Not Found ».
  // Seul un refus net veut dire « expiré » : une panne passagère pousserait à
  // payer une nouvelle génération pour un modèle toujours là.
  const status = Number(/responded with (\d{3})\b/.exec(message)?.[1]);
  if (status === 403 || status === 404 || status === 410) return EXPIRED_MESSAGE;
  if (status === 429 || status >= 500) {
    return "fal.ai ne sert pas le fichier pour l'instant : réessayez dans un moment (le lien n'est pas forcément expiré).";
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Le modèle n'a pas pu être téléchargé depuis fal.ai : réseau coupé, ou lien expiré.";
  }
  return `Lecture du modèle impossible : ${message}`;
}

function mm(value: number | null): string {
  return (value ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

function percent(fraction: number): string {
  const value = fraction * 100;
  // Espace insécable avant « % », comme on l'écrit en français.
  return `${value.toLocaleString("fr-FR", { maximumFractionDigits: value < 10 ? 1 : 0 })} %`;
}

/** Vue de face du modèle, avec la ligne de coupe. */
function Silhouette({ raw, cut }: { raw: Bust.RawMesh; cut: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height, m = 8;
    const [x0, , z0] = raw.min;
    const [x1, , z1] = raw.max;
    const k = Math.min((W - 2 * m) / (x1 - x0), (H - 2 * m) / (z1 - z0));
    const ox = (W - k * (x1 - x0)) / 2, oy = (H - k * (z1 - z0)) / 2;
    const cutY = H - oy - cut * (z1 - z0) * k;

    ctx.clearRect(0, 0, W, H);
    const p = raw.positions;
    const idx = raw.indices;
    const stride = Math.max(1, Math.floor(idx.length / 40000));
    for (let t = 0; t < idx.length; t += stride) {
      const i = idx[t] * 3;
      const px = ox + (p[i] - x0) * k;
      const py = H - oy - (p[i + 2] - z0) * k;
      ctx.fillStyle = py > cutY ? "rgba(113,113,122,0.35)" : "rgba(196,181,253,0.55)";
      ctx.fillRect(px, py, 1.2, 1.2);
    }
    ctx.strokeStyle = "#a78bfa";
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, cutY);
    ctx.lineTo(W, cutY);
    ctx.stroke();
  }, [raw, cut]);

  return (
    <canvas
      ref={ref}
      width={320}
      height={320}
      className="aspect-square w-full max-w-[160px] rounded-lg bg-zinc-950"
      aria-label="Silhouette du modèle et ligne de coupe"
    />
  );
}
