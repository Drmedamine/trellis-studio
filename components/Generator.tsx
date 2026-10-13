"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  DECIMATIONS,
  DEFAULT_OPTIONS,
  RESOLUTIONS,
  TEXTURE_SIZES,
  type GenerateOptions,
  type StatusResponse,
} from "@/lib/options";
import { prepareImage, thumbnail } from "@/lib/image";
import {
  addToHistory,
  removeFromHistory,
  setAccessCode,
  useAccessCode,
  useHistory,
  type HistoryItem,
} from "@/lib/store";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });
const BustPanel = dynamic(() => import("./BustPanel"), { ssr: false });

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "queued"; position?: number }
  | { kind: "running"; logs: string[] }
  | { kind: "done" }
  | { kind: "error"; message: string };

const POLL_MS = 2500;

export default function Generator({ needsCode, configured }: { needsCode: boolean; configured: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_OPTIONS);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [result, setResult] = useState<HistoryItem | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [heightMm, setHeightMm] = useState(100);
  const [exporting, setExporting] = useState(false);
  const [bustPreview, setBustPreview] = useState<string | null>(null);
  const accessCode = useAccessCode();
  const history = useHistory();
  const cancelled = useRef(false);

  const busy = phase.kind === "uploading" || phase.kind === "queued" || phase.kind === "running";

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => () => {
    cancelled.current = true;
  }, []);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const choose = useCallback((f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setPhase({ kind: "idle" });
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) choose(item.getAsFile() ?? undefined);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [choose]);

  const headers = (): HeadersInit => (accessCode ? { "x-access-code": accessCode } : {});

  async function generate() {
    if (!file || busy) return;
    cancelled.current = false;
    setResult(null);
    setPhase({ kind: "uploading" });
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);

    try {
      const image = await prepareImage(file);
      const thumb = await thumbnail(image);
      const form = new FormData();
      form.set("image", image);
      form.set("resolution", options.resolution);
      form.set("textureSize", options.textureSize);
      form.set("decimationTarget", String(options.decimationTarget));
      form.set("remesh", String(options.remesh));
      if (options.seed !== undefined) form.set("seed", String(options.seed));

      const res = await fetch("/api/generate", { method: "POST", body: form, headers: headers() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Erreur ${res.status}`);
      const requestId: string = body.requestId;

      setPhase({ kind: "queued" });
      while (!cancelled.current) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const s = await fetch(`/api/status?id=${encodeURIComponent(requestId)}`, {
          headers: headers(),
          cache: "no-store",
        });
        const status = (await s.json().catch(() => ({}))) as StatusResponse & { error?: string };
        if (!s.ok) throw new Error(status.error ?? `Erreur ${s.status}`);

        if (status.status === "queued") setPhase({ kind: "queued", position: status.position });
        else if (status.status === "running") setPhase({ kind: "running", logs: status.logs });
        else if (status.status === "error") throw new Error(status.message);
        else {
          const item: HistoryItem = {
            id: requestId,
            glbUrl: status.glbUrl,
            thumb,
            createdAt: Date.now(),
            resolution: options.resolution,
          };
          addToHistory(item);
          setResult(item);
          setPhase({ kind: "done" });
          return;
        }
      }
    } catch (error) {
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function exportStl() {
    if (!result) return;
    setExporting(true);
    try {
      const { glbToStl, downloadBlob } = await import("@/lib/stl");
      downloadBlob(await glbToStl(result.glbUrl, heightMm), `trellis-${result.id.slice(0, 8)}.stl`);
    } catch (error) {
      setPhase({ kind: "error", message: `Export STL impossible : ${error instanceof Error ? error.message : error}` });
    } finally {
      setExporting(false);
    }
  }

  const elapsed = startedAt && busy ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <section className="flex flex-col gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        {!configured && (
          <p className="rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200">
            La variable <code>FAL_KEY</code> n&apos;est pas définie sur le serveur : ajoutez-la dans
            Vercel (Settings → Environment Variables), puis redéployez.
          </p>
        )}

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            choose(e.dataTransfer.files[0]);
          }}
          className={`relative grid aspect-square cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed transition ${
            dragging ? "border-violet-400 bg-violet-950/30" : "border-zinc-700 hover:border-zinc-500"
          }`}
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Image choisie" className="h-full w-full object-contain" />
          ) : (
            <span className="px-6 text-center text-sm text-zinc-400">
              Glissez une image ici, cliquez pour en choisir une, ou collez-la (Ctrl+V).
              <br />
              <span className="text-zinc-500">Un seul objet, fond uni ou transparent : meilleur résultat.</span>
            </span>
          )}
        </label>

        <fieldset className="grid grid-cols-2 gap-3 text-sm" disabled={busy}>
          <Field label="Résolution">
            <select
              value={options.resolution}
              onChange={(e) => setOptions({ ...options, resolution: e.target.value as GenerateOptions["resolution"] })}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}³
                </option>
              ))}
            </select>
          </Field>
          <Field label="Texture">
            <select
              value={options.textureSize}
              onChange={(e) => setOptions({ ...options, textureSize: e.target.value as GenerateOptions["textureSize"] })}
            >
              {TEXTURE_SIZES.map((t) => (
                <option key={t} value={t}>
                  {t} px
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sommets">
            <select
              value={options.decimationTarget}
              onChange={(e) => setOptions({ ...options, decimationTarget: Number(e.target.value) })}
            >
              {DECIMATIONS.map((d) => (
                <option key={d} value={d}>
                  {d / 1000}k
                </option>
              ))}
            </select>
          </Field>
          <Field label="Graine (option)">
            <input
              type="number"
              min={0}
              placeholder="aléatoire"
              value={options.seed ?? ""}
              onChange={(e) =>
                setOptions({ ...options, seed: e.target.value === "" ? undefined : Math.max(0, Math.floor(Number(e.target.value))) })
              }
            />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-zinc-300">
            <input
              type="checkbox"
              checked={options.remesh}
              onChange={(e) => setOptions({ ...options, remesh: e.target.checked })}
            />
            Remaillage propre (conseillé pour l&apos;impression 3D)
          </label>
        </fieldset>

        {needsCode && (
          <Field label="Code d'accès">
            <input
              type="password"
              value={accessCode}
              autoComplete="off"
              onChange={(e) => setAccessCode(e.target.value)}
            />
          </Field>
        )}

        <button
          onClick={generate}
          disabled={!file || busy || !configured}
          className="rounded-xl bg-violet-600 px-4 py-3 font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Génération en cours…" : "Générer le modèle 3D"}
        </button>

        <StatusLine phase={phase} elapsed={elapsed} />
      </section>

      <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950">
        <div className="relative flex-1">
          {result ? (
            <ModelViewer src={bustPreview ?? result.glbUrl} alt={bustPreview ? "Buste imprimable" : "Modèle généré"} />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-sm text-zinc-500">
              {busy ? <Spinner /> : "Le modèle apparaîtra ici."}
            </div>
          )}
        </div>
        {result && (
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 p-4 text-sm">
            <a
              href={result.glbUrl}
              download
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white"
            >
              Télécharger GLB
            </a>
            <span className="ms-auto flex items-center gap-2 text-zinc-400">
              Hauteur
              <input
                type="number"
                min={5}
                max={1000}
                value={heightMm}
                onChange={(e) => setHeightMm(Math.min(1000, Math.max(5, Number(e.target.value) || 100)))}
                className="w-20"
              />
              mm
            </span>
            <button
              onClick={exportStl}
              disabled={exporting}
              className="rounded-lg border border-zinc-600 px-3 py-2 font-medium text-zinc-100 hover:border-zinc-400 disabled:opacity-50"
            >
              {exporting ? "Conversion…" : "Télécharger STL brut"}
            </button>
          </div>
        )}
        {result && (
          <BustPanel key={result.id} glbUrl={result.glbUrl} name={`trellis-${result.id.slice(0, 8)}`} onPreview={setBustPreview} />
        )}
      </section>

      {history.length > 0 && (
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">Vos derniers modèles (dans ce navigateur)</h2>
          <ul className="flex flex-wrap gap-3">
            {history.map((item) => (
              <li key={item.id} className="group relative">
                <button
                  onClick={() => {
                    setResult(item);
                    setPhase({ kind: "done" });
                  }}
                  className={`block h-20 w-20 overflow-hidden rounded-lg border bg-zinc-900 ${
                    result?.id === item.id ? "border-violet-500" : "border-zinc-800 hover:border-zinc-600"
                  }`}
                  title={new Date(item.createdAt).toLocaleString("fr-FR")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.thumb} alt="" className="h-full w-full object-contain" />
                </button>
                <button
                  onClick={() => removeFromHistory(item.id)}
                  aria-label="Retirer de l'historique"
                  className="absolute -end-2 -top-2 hidden h-6 w-6 rounded-full bg-zinc-700 text-xs text-white group-hover:block"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            Les fichiers sont hébergés par fal.ai et peuvent expirer : téléchargez ceux que vous voulez garder.
          </p>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-zinc-400">
      <span className="text-xs uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function StatusLine({ phase, elapsed }: { phase: Phase; elapsed: number }) {
  const time = elapsed ? ` · ${elapsed} s` : "";
  switch (phase.kind) {
    case "idle":
      return null;
    case "uploading":
      return <p className="text-sm text-zinc-300">Envoi de l&apos;image…{time}</p>;
    case "queued":
      return (
        <p className="text-sm text-zinc-300">
          En file d&apos;attente{phase.position !== undefined ? ` (position ${phase.position + 1})` : ""}…{time}
        </p>
      );
    case "running":
      return (
        <div className="text-sm text-zinc-300">
          <p>Génération sur GPU…{time}</p>
          {phase.logs.length > 0 && (
            <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap text-xs text-zinc-500">{phase.logs.join("\n")}</pre>
          )}
        </div>
      );
    case "done":
      return <p className="text-sm text-emerald-400">✓ Modèle prêt.</p>;
    case "error":
      return <p className="text-sm text-red-400">✗ {phase.message}</p>;
  }
}

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-500" />
      <span>Comptez 20 s à 1 min selon la résolution.</span>
    </div>
  );
}
