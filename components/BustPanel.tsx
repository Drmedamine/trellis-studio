"use client";

import { useEffect, useRef, useState } from "react";
import type { RawMesh } from "@/lib/bust/client";

const FINESSES = [
  { label: "Rapide", voxel: 0.8 },
  { label: "Normal", voxel: 0.55 },
  { label: "Fin", voxel: 0.4 },
] as const;

type Result = { stl: Blob; previewUrl: string; size: [number, number, number]; volume: number; triangles: number };

/**
 * Fait du modèle généré un buste imprimable : coupé à plat, plein, fermé,
 * sur un socle. Tout se calcule dans le navigateur.
 */
export default function BustPanel({
  glbUrl,
  name,
  onPreview,
}: {
  glbUrl: string;
  name: string;
  onPreview: (url: string | null) => void;
}) {
  const [raw, setRaw] = useState<RawMesh | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cut, setCut] = useState(0.3);
  const [heightMm, setHeightMm] = useState(100);
  const [base, setBase] = useState(true);
  const [voxel, setVoxel] = useState<number>(FINESSES[1].voxel);
  const [busy, setBusy] = useState<{ fraction: number; step: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [showBust, setShowBust] = useState(true);

  useEffect(() => {
    let alive = true;
    import("@/lib/bust/client")
      .then(({ loadRawMesh }) => loadRawMesh(glbUrl))
      .then((m) => alive && setRaw(m))
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [glbUrl]);

  // L'aperçu suit le choix « buste / original » ; il est rendu en partant.
  useEffect(() => {
    onPreview(result && showBust ? result.previewUrl : null);
  }, [result, showBust, onPreview]);
  useEffect(() => {
    if (!result) return;
    return () => URL.revokeObjectURL(result.previewUrl);
  }, [result]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const settingsChanged = () => setResult(null);

  async function prepare() {
    if (!raw || busy) return;
    setError(null);
    setResult(null);
    setBusy({ fraction: 0, step: "Préparation" });
    try {
      const { makeBust, toStl, toPreviewGlb } = await import("@/lib/bust/client");
      const out = await makeBust(raw, { heightMm, cut, base, voxel }, (fraction, step) => setBusy({ fraction, step }));
      setBusy({ fraction: 0.98, step: "Aperçu" });
      const previewUrl = await toPreviewGlb(out.positions, out.indices);
      setResult({
        stl: toStl(out.positions, out.indices),
        previewUrl,
        size: out.size,
        volume: out.volume,
        triangles: out.indices.length / 3,
      });
      setShowBust(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(result.stl);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-buste-${Math.round(heightMm)}mm.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="border-t border-zinc-800 p-4 text-sm">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-medium text-zinc-100">Buste imprimable</h2>
        <span className="text-xs text-zinc-500">Plein, fermé, posé sur un socle — calculé dans votre navigateur.</span>
      </div>

      {loadError ? (
        <p className="text-red-400">✗ Lecture du modèle impossible : {loadError}</p>
      ) : !raw ? (
        <p className="text-zinc-500">Lecture du modèle…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Silhouette raw={raw} cut={cut} />
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-zinc-400">
              <span className="text-xs uppercase tracking-wide">
                Coupe : {Math.round(cut * 100)} % du bas retirés
              </span>
              <input
                type="range"
                min={0}
                max={0.7}
                step={0.01}
                value={cut}
                disabled={!!busy}
                onChange={(e) => {
                  setCut(Number(e.target.value));
                  settingsChanged();
                }}
                className="accent-violet-500"
              />
              <span className="text-xs text-zinc-500">
                Placez la ligne sous le menton ou au cou : tout ce qui est en dessous (vêtements en feuilles) part.
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-zinc-300">
              <label className="flex items-center gap-2">
                Hauteur
                <input
                  type="number"
                  min={20}
                  max={400}
                  value={heightMm}
                  disabled={!!busy}
                  onChange={(e) => {
                    setHeightMm(Math.min(400, Math.max(20, Number(e.target.value) || 100)));
                    settingsChanged();
                  }}
                  className="w-20"
                />
                mm
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={base}
                  disabled={!!busy}
                  onChange={(e) => {
                    setBase(e.target.checked);
                    settingsChanged();
                  }}
                />
                Socle
              </label>
              <label className="flex items-center gap-2">
                Finesse
                <select
                  value={voxel}
                  disabled={!!busy}
                  onChange={(e) => {
                    setVoxel(Number(e.target.value));
                    settingsChanged();
                  }}
                >
                  {FINESSES.map((f) => (
                    <option key={f.voxel} value={f.voxel}>
                      {f.label} ({f.voxel} mm)
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={prepare}
                disabled={!!busy}
                className="rounded-lg bg-violet-600 px-3 py-2 font-medium text-white hover:bg-violet-500 disabled:opacity-50"
              >
                {busy ? "Calcul…" : result ? "Recalculer" : "Préparer le buste"}
              </button>
              {result && (
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
            {result && !busy && (
              <p className="text-xs text-emerald-400">
                ✓ Volume fermé, prêt pour le slicer : {result.size.map((v) => Math.round(v)).join(" × ")} mm,{" "}
                {(result.volume / 1000).toFixed(0)} cm³ en plein, {Math.round(result.triangles / 1000)}k triangles.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Vue de face du modèle, avec la ligne de coupe. */
function Silhouette({ raw, cut }: { raw: RawMesh; cut: number }) {
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
