"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import {
  DECIMATIONS,
  DEFAULT_OPTIONS,
  RESOLUTIONS,
  TEXTURE_SIZES,
  type GenerateOptions,
  type StatusResponse,
} from "@/lib/options";
// Type seul : lib/access est réservé au serveur, rien n'en part dans la page.
import type { AccessState } from "@/lib/access";
import {
  cropRect,
  DEFAULT_CROP,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeCrop,
  prepareImage,
  thumbnail,
  type Crop,
} from "@/lib/image";
import NumberField, { type NumberFieldHandle } from "./NumberField";
import {
  accessHeaders,
  addPendingJob,
  addToHistory,
  isSeed,
  MAX_SEED,
  pendingJobs,
  removeFromHistory,
  removePendingJob,
  setAccessCode,
  settingsOf,
  useAccessCode,
  useHistory,
  usePendingJobs,
  type HistoryItem,
  type PendingJob,
  type SentOptions,
} from "@/lib/store";

const ModelViewer = dynamic(() => import("./ModelViewer"), { ssr: false });
const BustPanel = dynamic(() => import("./BustPanel"), { ssr: false });

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "queued"; position?: number }
  | { kind: "running"; logs: string[] }
  | { kind: "done" }
  | { kind: "error"; message: string }
  // Le suivi a lâché ou a été arrêté, pas forcément la génération : elle peut encore aboutir.
  | { kind: "stalled"; message: string };

/** Le modèle affiché : de l'historique, juste généré, ou un GLB ouvert depuis l'appareil. */
type Shown = HistoryItem & { fileName?: string };

const POLL_MS = 2500;
const RETRY_MAX_MS = 15_000;
const MAX_FAILURES = 8;
// Un appel qui ne revient pas (téléphone en veille, réseau mobile) compte comme un échec passager.
const FETCH_TIMEOUT_MS = 20_000;
const RESUME_WITHIN_MS = 24 * 60 * 60 * 1000;
// Une génération dure de 20 s à quelques minutes. Au-delà, chaque réponse « en
// attente » remettant les échecs à zéro, le suivi tournerait sans fin.
const FOLLOW_MAX_MIN = 30;

const EXPIRED_MESSAGE =
  "Ce modèle n'est plus disponible chez fal.ai (lien expiré) : régénérez-le ou rouvrez le GLB téléchargé.";
// model-viewer garde l'échec en mémoire : la même adresse ne se recharge qu'avec la page.
const UNREACHABLE_MESSAGE =
  "Le modèle n'a pas pu être chargé (réseau coupé ou fal.ai indisponible) : rechargez la page pour réessayer.";

// Une seule hauteur pour la page : le STL brut et le buste prennent la même.
// Sous 20 mm, le socle de 4 mm mange le buste ; au-delà de 400 mm, aucune imprimante courante ne suit.
const HEIGHT_MIN = 20;
const HEIGHT_MAX = 400;

export default function Generator({ accessState, configured }: { accessState: AccessState; configured: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [options, setOptions] = useState<GenerateOptions>(DEFAULT_OPTIONS);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [hiccup, setHiccup] = useState<{ attempt: number; message: string } | null>(null);
  const [result, setResult] = useState<Shown | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [heightMm, setHeightMm] = useState(100);
  // Deux champs pour une seule hauteur : celui du STL brut et celui du buste.
  const heightField = useRef<NumberFieldHandle>(null);
  const bustHeightField = useRef<NumberFieldHandle>(null);
  // Le cadrage appartient à sa photo : une nouvelle photo repart du cadrage par défaut.
  const [framing, setFraming] = useState<{ src: string; crop: Crop | null } | null>(null);
  const [photoSize, setPhotoSize] = useState<(PhotoSize & { src: string }) | null>(null);
  const crop = framing && framing.src === preview ? framing.crop : DEFAULT_CROP;
  const photo = photoSize && photoSize.src === preview ? photoSize : null;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [bustPreview, setBustPreview] = useState<string | null>(null);
  // Échec de la visionneuse, une fois classé : lien expiré ou simple panne.
  const [failedLoad, setFailedLoad] = useState<{ src: string; expired: boolean } | null>(null);
  const accessCode = useAccessCode();
  const history = useHistory();
  const pending = usePendingJobs();
  const isLocalHost = useIsLocalHost();

  // Jeton du travail en cours (envoi ou suivi) : un travail dont le jeton
  // n'est plus le dernier se tait, il ne touche plus à l'état.
  const jobRef = useRef(0);
  // Lus dans les gestionnaires, où l'état rendu peut être en retard d'un rendu.
  const activeRef = useRef(false);
  const wakeRef = useRef<(() => void) | null>(null);
  // Suivis refusés par le serveur (code, clé) ou arrêtés à la main : pas de
  // reprise automatique, elle répéterait le refus, ou relancerait ce qu'on
  // vient d'arrêter, à chaque retour sur l'onglet.
  const refusedRef = useRef(new Set<string>());
  // La génération suivie en ce moment, pour pouvoir l'arrêter.
  const followedRef = useRef<string | null>(null);

  const busy = phase.kind === "uploading" || phase.kind === "queued" || phase.kind === "running";
  const blocked = accessState === "blocked";

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(
    () => () => {
      jobRef.current++;
      activeRef.current = false;
      wakeRef.current?.();
    },
    [],
  );

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // Un GLB ouvert depuis l'appareil vit dans une adresse blob: à rendre en partant.
  const localUrl = result?.glbUrl.startsWith("blob:") ? result.glbUrl : null;
  useEffect(() => {
    if (!localUrl) return;
    return () => URL.revokeObjectURL(localUrl);
  }, [localUrl]);

  /**
   * Suit une génération jusqu'au bout. L'entrée « en attente » n'est retirée
   * que si le modèle est récupéré ou si la génération a échoué chez fal.ai :
   * tout autre arrêt la garde, et le suivi pourra reprendre sans payer.
   */
  const follow = useCallback(async (job: PendingJob, firstDelay: number) => {
    const token = ++jobRef.current;
    const alive = () => jobRef.current === token;
    activeRef.current = true;
    followedRef.current = job.requestId;
    setStartedAt(job.startedAt);
    setNow(Date.now());
    setHiccup(null);
    setPhase((p) => (p.kind === "queued" || p.kind === "running" ? p : { kind: "queued" }));

    const outcome = await poll(job.requestId, firstDelay, {
      alive,
      sleep: (ms) => nap(ms, wakeRef),
      onStatus: (s) => {
        setHiccup(null);
        setPhase(s.status === "queued" ? { kind: "queued", position: s.position } : { kind: "running", logs: s.logs });
      },
      onRetry: (attempt, message) => setHiccup({ attempt, message }),
    });
    if (outcome.kind === "stale" || !alive()) return;

    activeRef.current = false;
    setHiccup(null);
    switch (outcome.kind) {
      case "done": {
        const item: HistoryItem = {
          id: job.requestId,
          glbUrl: outcome.glbUrl,
          thumb: job.thumb,
          createdAt: Date.now(),
          ...job.options,
        };
        addToHistory(item);
        removePendingJob(job.requestId);
        setResult(item);
        setPhase({ kind: "done" });
        break;
      }
      case "failed":
        removePendingJob(job.requestId);
        setPhase({ kind: "error", message: outcome.message });
        break;
      case "refused":
        refusedRef.current.add(job.requestId);
        setPhase({ kind: "error", message: outcome.message });
        break;
      case "stalled":
        setPhase({ kind: "stalled", message: outcome.message });
        break;
    }
  }, []);

  // Au chargement et à chaque retour sur l'onglet : une génération payée de
  // moins de 24 h reprend seule. Si un suivi attend son prochain essai, il
  // repart tout de suite (un téléphone sorti de veille a souvent retrouvé le réseau).
  const autoResume = useCallback(() => {
    if (activeRef.current) {
      wakeRef.current?.();
      return;
    }
    // Le serveur refuserait le suivi : inutile de l'interroger à chaque retour sur l'onglet.
    if (blocked || !configured) return;
    const at = Date.now();
    const job = pendingJobs().find(
      (j) => at - j.startedAt < RESUME_WITHIN_MS && !refusedRef.current.has(j.requestId),
    );
    if (job) void follow(job, 0);
  }, [blocked, configured, follow]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") autoResume();
    };
    // Différé d'un tour : la reprise met l'état à jour, ce qu'un effet ne doit pas faire en direct.
    const t = setTimeout(onVisibility, 0);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [autoResume]);

  function resume(job: PendingJob) {
    if (activeRef.current) return;
    refusedRef.current.delete(job.requestId);
    void follow(job, 0);
  }

  /** Arrête le suivi sans rien oublier : l'entrée reste, « Reprendre » ou « Oublier » redeviennent possibles. */
  function stopFollowing() {
    if (!activeRef.current || phase.kind === "uploading") return;
    jobRef.current++;
    activeRef.current = false;
    wakeRef.current?.();
    if (followedRef.current) refusedRef.current.add(followedRef.current);
    setHiccup(null);
    setPhase({ kind: "stalled", message: "Suivi arrêté." });
  }

  function forget(job: PendingJob) {
    if (
      !window.confirm(
        "Oublier cette génération ? Si elle a abouti chez fal.ai, son modèle ne sera pas récupéré ici (elle a déjà été payée).",
      )
    )
      return;
    removePendingJob(job.requestId);
    if (!activeRef.current) setPhase({ kind: "idle" });
  }

  const openGlb = useCallback((f: File) => {
    const item: Shown = {
      id: `local-${Date.now().toString(36)}`,
      glbUrl: URL.createObjectURL(f),
      thumb: "",
      createdAt: Date.now(),
      fileName: f.name,
    };
    setResult(item);
    setBustPreview(null);
    if (!activeRef.current) setPhase({ kind: "idle" });
  }, []);

  // Pendant un envoi ou un suivi, la phase appartient au travail en cours :
  // une nouvelle photo ne change que la photo.
  const choose = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      if (isGlb(f)) {
        openGlb(f);
        return;
      }
      if (!f.type.startsWith("image/")) {
        if (!activeRef.current) {
          setPhase({ kind: "error", message: "Format non pris en charge : une image (PNG, JPEG, WebP) ou un modèle .glb." });
        }
        return;
      }
      setFile(f);
      setPreview(URL.createObjectURL(f));
      if (!activeRef.current) setPhase({ kind: "idle" });
    },
    [openGlb],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      if (item) choose(item.getAsFile() ?? undefined);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [choose]);

  async function generate() {
    if (!file || busy || activeRef.current || blocked) return;
    if (
      pendingJobs().length > 0 &&
      !window.confirm(
        "Une génération déjà payée n'a pas encore été récupérée : « Reprendre le suivi » la récupère sans frais.\n\nEn lancer une nouvelle coûte une génération de plus. Continuer ?",
      )
    )
      return;

    const token = ++jobRef.current;
    const alive = () => jobRef.current === token;
    activeRef.current = true;
    // La graine est tirée ici quand le champ est vide : elle part toujours,
    // et le résultat se refait à l'identique.
    const sent: SentOptions = { ...options, seed: options.seed ?? randomSeed() };
    setResult(null);
    setHiccup(null);
    setPhase({ kind: "uploading" });
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);

    try {
      const image = await prepareImage(file, crop);
      const thumb = await thumbnail(image);
      const form = new FormData();
      form.set("image", image);
      form.set("resolution", sent.resolution);
      form.set("textureSize", sent.textureSize);
      form.set("decimationTarget", String(sent.decimationTarget));
      form.set("remesh", String(sent.remesh));
      form.set("seed", String(sent.seed));

      // Jamais relancé tout seul : un envoi arrivé à fal est facturé, même si la réponse se perd.
      const answer = await call("/api/generate", { method: "POST", body: form, headers: accessHeaders() });
      if (!answer.ok) throw new Error(answer.message);
      const requestId = (answer.body as { requestId?: unknown } | undefined)?.requestId;
      if (typeof requestId !== "string" || !requestId) throw new Error("Réponse inattendue du serveur.");

      // Gardée avant toute autre chose : c'est ce qui permet de la retrouver
      // si la page se ferme maintenant.
      const job: PendingJob = { requestId, thumb, options: sent, startedAt: t0 };
      addPendingJob(job);
      if (!alive()) return;
      void follow(job, POLL_MS);
    } catch (error) {
      if (!alive()) return;
      activeRef.current = false;
      setPhase({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * La hauteur à employer, saisie en cours comprise, dans l'un ou l'autre
   * champ : sur téléphone, toucher un bouton ne quitte pas toujours le champ,
   * et celui qu'on vient de remplir n'est pas forcément à côté du bouton.
   */
  const commitHeight = useCallback((): number => {
    let height = heightMm;
    for (const field of [heightField.current, bustHeightField.current]) {
      if (field?.pending()) height = field.commit();
    }
    return height;
  }, [heightMm]);

  async function exportStl() {
    if (!result) return;
    const height = commitHeight();
    setExporting(true);
    setExportError(null);
    try {
      const { glbToStl, downloadBlob } = await import("@/lib/stl");
      downloadBlob(await glbToStl(result.glbUrl, height), `${baseName(result)}.stl`);
    } catch (error) {
      // À part de la phase : un échec d'export ne doit pas interrompre un suivi en cours.
      setExportError(`Export STL impossible : ${error instanceof Error ? error.message : error}`);
    } finally {
      setExporting(false);
    }
  }

  function dropHistoryEntry(item: Shown) {
    if (
      !window.confirm(
        "Retirer ce modèle de l'historique ? Son lien sera oublié ici. Si vous n'avez pas téléchargé le GLB, il faudra payer une nouvelle génération.",
      )
    )
      return;
    removeFromHistory(item.id);
    setResult(null);
  }

  /**
   * model-viewer ne dit pas pourquoi un chargement échoue (le code HTTP se
   * perd en route) : on le demande à l'adresse elle-même. Seul un refus net
   * (403, 404, 410) veut dire « expiré » ; le reste peut revenir tout seul, et
   * proposer de le retirer ou de le régénérer ferait perdre un modèle payé.
   */
  const onViewerError = useCallback((src: string) => {
    if (src.startsWith("blob:")) {
      setFailedLoad({ src, expired: false });
      return;
    }
    void (async () => {
      let expired = false;
      try {
        const res = await fetch(src, { headers: { Range: "bytes=0-0" }, cache: "no-store" });
        expired = res.status === 403 || res.status === 404 || res.status === 410;
        void res.body?.cancel();
      } catch {}
      setFailedLoad({ src, expired });
    })();
  }, []);

  const elapsed = startedAt && busy ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const settings = result ? settingsOf(result) : null;
  const settingsInForm = settings !== null && sameOptions(options, settings);
  const local = result?.id.startsWith("local-") ?? false;
  const broken = result !== null && !bustPreview && failedLoad?.src === result.glbUrl ? failedLoad : null;
  const waiting = !busy ? pending[0] : undefined;
  const following = phase.kind === "queued" || phase.kind === "running";

  // Un seul est rendu à la fois : dans le cadre vide, ou derrière « Changer de photo ».
  const fileInput = (
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp,.glb,model/gltf-binary"
      className="sr-only"
      onChange={(e) => {
        choose(e.target.files?.[0]);
        // Rouvrir le même fichier doit redéclencher le choix.
        e.target.value = "";
      }}
    />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <section className="flex flex-col gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        {!configured && (
          <p className="rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200">
            La variable <code>FAL_KEY</code> n&apos;est pas définie sur le serveur : ajoutez-la dans
            Vercel (Settings → Environment Variables), puis redéployez.
          </p>
        )}
        {blocked && (
          <p className="rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200">
            Génération désactivée : la variable <code>ACCESS_CODE</code> n&apos;est pas définie sur le serveur.
            Sans elle, n&apos;importe qui trouvant l&apos;adresse pourrait générer à vos frais. Ajoutez-la dans
            Vercel (Settings → Environment Variables), puis redéployez.
          </p>
        )}
        {accessState === "open" && !isLocalHost && (
          <p className="rounded-lg border border-amber-700 bg-amber-950/50 p-3 text-sm text-amber-200">
            Site ouvert à tous : sans <code>ACCESS_CODE</code>, chaque visiteur peut générer à vos frais.
            Ajoutez-la dans Vercel (Settings → Environment Variables), puis redéployez — sauf si c&apos;est
            voulu (<code>PUBLIC_ACCESS=1</code>).
          </p>
        )}

        <div className="flex flex-col gap-2">
          {/* Une photo choisie se cadre en la faisant glisser : le cadre n'ouvre donc plus le sélecteur de fichier. */}
          <div
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
            className={`relative aspect-square overflow-hidden rounded-xl border-2 transition ${
              dragging
                ? "border-dashed border-violet-400 bg-violet-950/30"
                : preview
                  ? "border-zinc-700 bg-zinc-950"
                  : "border-dashed border-zinc-700 hover:border-zinc-500"
            }`}
          >
            {preview ? (
              <FramedPhoto
                key={preview}
                src={preview}
                crop={crop}
                size={photo}
                onSize={(size) => setPhotoSize({ src: preview, ...size })}
                onCrop={(next) => setFraming({ src: preview, crop: next })}
              />
            ) : (
              <label className="absolute inset-0 grid cursor-pointer place-items-center rounded-xl focus-within:ring-2 focus-within:ring-violet-500">
                {fileInput}
                <span className="px-5 text-center text-sm text-zinc-400">
                  Glissez une photo ici, cliquez pour en choisir une, ou collez-la (Ctrl+V).
                  <br />
                  <span className="mt-2 inline-block text-zinc-500">
                    Pour un buste : une seule personne, visage de face, tête et épaules dans l&apos;image, lumière
                    douce sans ombre dure, fond uni ou détouré.
                  </span>
                  <br />
                  <span className="mt-2 inline-block text-zinc-500">
                    Un fichier .glb déjà téléchargé se rouvre ici aussi, sans payer.
                  </span>
                </span>
              </label>
            )}
          </div>
          {preview && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-zinc-400">
              {crop && (
                <label className="flex min-w-44 flex-1 items-center gap-2">
                  Zoom
                  <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={0.05}
                    value={crop.zoom}
                    onChange={(e) => {
                      // Le zoom se fait autour de ce qu'on voit, pas d'un centre resté hors de l'image.
                      const from = photo ? normalizeCrop(photo.w, photo.h, crop) : crop;
                      setFraming({ src: preview, crop: { ...from, zoom: Number(e.target.value) } });
                    }}
                    className="min-w-0 flex-1 accent-violet-500"
                  />
                  <span className="w-9 text-end tabular-nums text-zinc-300">{crop.zoom.toFixed(1).replace(".", ",")}×</span>
                </label>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFraming({ src: preview, crop: crop ? null : DEFAULT_CROP })}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-200 hover:border-zinc-500"
                >
                  {crop ? "Photo entière" : "Recadrer en carré"}
                </button>
                <label className="cursor-pointer rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-200 focus-within:ring-2 focus-within:ring-violet-500 hover:border-zinc-500">
                  {fileInput}
                  Changer de photo
                </label>
              </div>
              <p className="w-full text-xs text-zinc-500">
                {crop
                  ? "Seul le carré est envoyé : faites glisser la photo pour la placer, zoomez pour ne garder que la tête et les épaules."
                  : "La photo entière est envoyée."}
              </p>
            </div>
          )}
        </div>

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
              max={MAX_SEED}
              step={1}
              placeholder="aléatoire"
              value={options.seed ?? ""}
              onChange={(e) => setOptions({ ...options, seed: parseSeed(e.target.value) })}
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

        {accessState === "required" && (
          <Field label="Code d'accès">
            <input
              type="password"
              value={accessCode}
              autoComplete="off"
              onChange={(e) => setAccessCode(e.target.value)}
            />
          </Field>
        )}

        {waiting && (
          <div className="flex gap-3 rounded-lg border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-100">
            {waiting.thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={waiting.thumb} alt="" className="h-12 w-12 shrink-0 rounded bg-zinc-950 object-contain" />
            )}
            <div className="flex flex-col gap-2">
              <p>
                Génération lancée {launchedAt(waiting.startedAt)} (déjà payée), pas encore récupérée. Elle a pu
                aboutir chez fal.ai : reprendre le suivi ne coûte rien.
                {pending.length > 1 && ` (${pending.length - 1} autre${pending.length > 2 ? "s" : ""} en attente.)`}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => resume(waiting)}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 font-medium text-zinc-950 hover:bg-amber-400"
                >
                  Reprendre le suivi
                </button>
                <button
                  onClick={() => forget(waiting)}
                  className="rounded-lg border border-amber-800 px-3 py-1.5 text-amber-200 hover:border-amber-600"
                >
                  Oublier
                </button>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={generate}
          disabled={!file || busy || !configured || blocked}
          className="rounded-xl bg-violet-600 px-4 py-3 font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Génération en cours…" : "Générer le modèle 3D"}
        </button>

        <StatusLine phase={phase} elapsed={elapsed} />
        {busy && hiccup && (
          <p className="text-sm text-amber-300">
            ⚠ {hiccup.message} Nouvel essai automatique ({hiccup.attempt}/{MAX_FAILURES})…
          </p>
        )}
        {following && (
          <button
            onClick={stopFollowing}
            className="self-start rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-zinc-500"
            title="La génération continue chez fal.ai : elle reste en attente ici, à reprendre ou à oublier."
          >
            Arrêter le suivi
          </button>
        )}
      </section>

      <section className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950">
        {/* Une vraie hauteur, même quand le panneau du buste s'ouvre en dessous : sur téléphone, il l'écrasait. */}
        <div className="relative min-h-[max(320px,55svh)] flex-1">
          {result ? (
            <ModelViewer
              src={bustPreview ?? result.glbUrl}
              alt={bustPreview ? "Buste imprimable" : "Modèle généré"}
              onError={onViewerError}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center p-8 text-center text-sm text-zinc-500">
              {busy ? <Spinner /> : "Le modèle apparaîtra ici."}
            </div>
          )}
          {result && broken && (
            <div className="absolute inset-0 grid place-items-center bg-zinc-950/80 p-6 text-center text-sm">
              <div className="flex max-w-sm flex-col items-center gap-3">
                <p className="text-amber-200">
                  {local ? "Ce fichier GLB n'a pas pu être lu." : broken.expired ? EXPIRED_MESSAGE : UNREACHABLE_MESSAGE}
                </p>
                {!local && broken.expired && history.some((h) => h.id === result.id) && (
                  <button
                    onClick={() => dropHistoryEntry(result)}
                    className="rounded-lg border border-zinc-600 px-3 py-2 font-medium text-zinc-100 hover:border-zinc-400"
                  >
                    Retirer de l&apos;historique
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        {result && (
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 p-4 text-sm">
            {local ? (
              <span className="text-zinc-400">
                Fichier ouvert : <span className="text-zinc-200">{result.fileName}</span>
              </span>
            ) : (
              <a
                href={result.glbUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-zinc-100 px-3 py-2 font-medium text-zinc-900 hover:bg-white"
              >
                Télécharger GLB
              </a>
            )}
            <label className="ms-auto flex items-center gap-2 text-zinc-400" title="La même que celle du buste.">
              Hauteur
              <NumberField
                ref={heightField}
                value={heightMm}
                min={HEIGHT_MIN}
                max={HEIGHT_MAX}
                onCommit={setHeightMm}
                aria-label="Hauteur du STL brut, en millimètres"
                className="w-20"
              />
              mm
            </label>
            <button
              onClick={exportStl}
              disabled={exporting}
              className="rounded-lg border border-zinc-600 px-3 py-2 font-medium text-zinc-100 hover:border-zinc-400 disabled:opacity-50"
            >
              {exporting ? "Conversion…" : "Télécharger STL brut"}
            </button>
            {exportError && <p className="w-full text-red-400">✗ {exportError}</p>}
          </div>
        )}
        {result && !local && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-zinc-800 px-4 py-3 text-xs text-zinc-400">
            <span>
              {describe(result)}
              {isSeed(result.seed) && (
                <>
                  {" · "}graine <span className="select-all font-mono text-zinc-200">{result.seed}</span>
                </>
              )}
            </span>
            {settings && (
              <button
                onClick={() => setOptions(settings)}
                disabled={busy || settingsInForm}
                className="ms-auto rounded-lg border border-zinc-700 px-2.5 py-1.5 text-zinc-200 hover:border-zinc-500 disabled:opacity-60"
                title="Remet ces réglages, graine comprise, dans le formulaire : avec la même photo et le même cadrage, le même modèle. Le cadrage n'est pas enregistré : replacez-le à l'identique."
              >
                {settingsInForm ? "✓ Réglages repris" : "Reprendre ces réglages"}
              </button>
            )}
          </div>
        )}
        {result && (
          <BustPanel
            key={result.id}
            glbUrl={result.glbUrl}
            name={baseName(result)}
            onPreview={setBustPreview}
            heightMm={heightMm}
            heightMin={HEIGHT_MIN}
            heightMax={HEIGHT_MAX}
            onHeightChange={setHeightMm}
            heightField={bustHeightField}
            commitHeight={commitHeight}
          />
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
                    // Un suivi en cours garde sa phase : on ne fait que regarder un autre modèle.
                    setResult(item);
                    if (!activeRef.current) setPhase({ kind: "idle" });
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
  const time = elapsed ? ` · ${duration(elapsed)}` : "";
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
    case "stalled":
      return (
        <p className="text-sm text-amber-300">
          ⚠ {phase.message} La génération continue peut-être chez fal.ai : « Reprendre le suivi » la récupère sans
          frais.
        </p>
      );
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

// ——— Cadrage ———

type PhotoSize = { w: number; h: number };
// `perPx` : pixels de la photo par pixel d'écran, mesuré au début du geste.
type Drag = { pointer: number; x: number; y: number; cx: number; cy: number; perPx: number };

/**
 * La photo dans son cadre carré : ce qu'on y voit est exactement ce qui part
 * (`cropRect`, le même calcul que `prepareImage`). Elle se fait glisser à la
 * souris comme au doigt (évènements « pointer »), ou aux flèches du clavier.
 */
function FramedPhoto({
  src,
  crop,
  size,
  onSize,
  onCrop,
}: {
  src: string;
  crop: Crop | null;
  /** Taille réelle de la photo, connue une fois chargée. */
  size: PhotoSize | null;
  onSize: (size: PhotoSize) => void;
  onCrop: (crop: Crop) => void;
}) {
  const [failed, setFailed] = useState(false);
  const drag = useRef<Drag | null>(null);
  const rect = crop && size ? cropRect(size.w, size.h, crop) : null;
  const center = crop && size ? normalizeCrop(size.w, size.h, crop) : null;

  if (failed) {
    return (
      <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-amber-200">
        Aperçu impossible : le navigateur ne lit pas ce format (photo HEIC d&apos;iPhone ?). Enregistrez-la en JPEG,
        puis choisissez-la de nouveau.
      </div>
    );
  }

  // Le centre est gardé dans l'image : tirer au-delà du bord ne se rattrape pas au retour.
  const moveTo = (cx: number, cy: number) => {
    if (crop && size) onCrop(normalizeCrop(size.w, size.h, { ...crop, cx, cy }));
  };
  const endDrag = (e: React.PointerEvent) => {
    if (drag.current?.pointer === e.pointerId) drag.current = null;
  };

  return (
    <div
      className={`absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 ${
        crop ? "cursor-grab touch-none select-none active:cursor-grabbing" : ""
      }`}
      tabIndex={crop ? 0 : undefined}
      role={crop ? "group" : undefined}
      aria-label={crop ? "Cadrage de la photo : faites-la glisser, ou utilisez les flèches du clavier" : undefined}
      onPointerDown={(e) => {
        // Un deuxième doigt ne reprend pas le cadrage en cours.
        if (!center || !rect || drag.current || (e.pointerType === "mouse" && e.button !== 0)) return;
        const width = e.currentTarget.getBoundingClientRect().width;
        if (!width) return;
        drag.current = {
          pointer: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          cx: center.cx,
          cy: center.cy,
          perPx: rect.side / width,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId || !size) return;
        // La photo suit le doigt : le cadre part donc dans l'autre sens.
        moveTo(d.cx - ((e.clientX - d.x) * d.perPx) / size.w, d.cy - ((e.clientY - d.y) * d.perPx) / size.h);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={(e) => {
        if (!center || !rect || !size) return;
        const step = rect.side * 0.05;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        moveTo(center.cx + move[0] / size.w, center.cy + move[1] / size.h);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Photo choisie"
        draggable={false}
        onLoad={(e) => onSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        onError={() => setFailed(true)}
        className={`pointer-events-none absolute ${
          !crop ? "inset-0 h-full w-full object-contain" : rect ? "" : "inset-0 h-full w-full object-cover opacity-0"
        }`}
        // Placée pour que le carré découpé remplisse exactement le cadre ; les pourcentages suivent sa taille.
        style={
          rect && size
            ? {
                left: `${(-rect.sx / rect.side) * 100}%`,
                top: `${(-rect.sy / rect.side) * 100}%`,
                width: `${(size.w / rect.side) * 100}%`,
                height: `${(size.h / rect.side) * 100}%`,
                maxWidth: "none",
              }
            : undefined
        }
      />
    </div>
  );
}

// ——— Réseau ———

type Answer =
  | { ok: true; body: unknown }
  | { ok: false; retryable: boolean; status?: number; message: string };

/**
 * Un appel aux routes, qui ne lève jamais. Si le corps porte `retryable`,
 * il l'emporte sur le code HTTP ; sans corps lisible (page d'erreur de
 * Vercel, réseau coupé), on le déduit : réseau, 408, 429 et 5xx se retentent.
 */
async function call(url: string, init: RequestInit): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === "TimeoutError";
    return {
      ok: false,
      retryable: true,
      message: timeout ? "Le serveur met trop de temps à répondre." : "Connexion au serveur impossible (réseau coupé ?).",
    };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {}
  const err = body && typeof body === "object" ? (body as { error?: unknown; retryable?: unknown }) : {};
  if (typeof err.retryable === "boolean" && typeof err.error === "string") {
    return { ok: false, retryable: err.retryable, status: res.status, message: err.error };
  }
  if (!res.ok) {
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    const message =
      typeof err.error === "string"
        ? err.error
        : retryable
          ? `Le serveur ne répond pas (erreur ${res.status}).`
          : `Erreur ${res.status}.`;
    return { ok: false, retryable, status: res.status, message };
  }
  return { ok: true, body };
}

/** L'état renvoyé par /api/status, ou null s'il n'a pas la forme attendue. */
function readStatus(body: unknown): StatusResponse | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  switch (b.status) {
    case "queued":
      return { status: "queued", position: typeof b.position === "number" ? b.position : undefined };
    case "running":
      return {
        status: "running",
        logs: Array.isArray(b.logs) ? b.logs.filter((l): l is string => typeof l === "string") : [],
      };
    case "done":
      return typeof b.glbUrl === "string" && /^https:\/\//.test(b.glbUrl) ? { status: "done", glbUrl: b.glbUrl } : null;
    case "error":
      return { status: "error", message: typeof b.message === "string" ? b.message : "La génération a échoué chez fal.ai." };
  }
  return null;
}

type Outcome =
  | { kind: "done"; glbUrl: string }
  // La génération a échoué chez fal.ai : il n'y a rien à récupérer.
  | { kind: "failed"; message: string }
  // Le serveur refuse le suivi (code, clé, crédit) : la génération, elle, peut aboutir.
  | { kind: "refused"; message: string }
  // Trop d'échecs passagers d'affilée.
  | { kind: "stalled"; message: string }
  // Un autre travail a pris la main, ou la page est partie.
  | { kind: "stale" };

type PollHooks = {
  alive: () => boolean;
  sleep: (ms: number) => Promise<void>;
  onStatus: (status: Extract<StatusResponse, { status: "queued" | "running" }>) => void;
  onRetry: (attempt: number, message: string) => void;
};

async function poll(requestId: string, firstDelay: number, hooks: PollHooks): Promise<Outcome> {
  let failures = 0;
  let wait = firstDelay;
  const deadline = Date.now() + FOLLOW_MAX_MIN * 60_000;
  for (;;) {
    if (wait > 0) await hooks.sleep(wait);
    if (!hooks.alive()) return { kind: "stale" };
    let status: StatusResponse | null = null;
    let failure: { retryable: boolean; status?: number; message: string };
    try {
      const answer = await call(`/api/status?id=${encodeURIComponent(requestId)}`, {
        headers: accessHeaders(),
        cache: "no-store",
        signal: AbortSignal.timeout?.(FETCH_TIMEOUT_MS),
      });
      if (answer.ok) status = readStatus(answer.body);
      // Une réponse 200 illisible (portail Wi-Fi, proxy) ne dit rien du travail : on retente.
      failure = answer.ok ? { retryable: true, message: "Réponse inattendue du serveur." } : answer;
    } catch (error) {
      failure = { retryable: true, message: error instanceof Error ? error.message : String(error) };
    }
    if (!hooks.alive()) return { kind: "stale" };

    if (status) {
      failures = 0;
      wait = POLL_MS;
      if (status.status === "done") return { kind: "done", glbUrl: status.glbUrl };
      if (status.status === "error") return { kind: "failed", message: status.message };
      // Un état inconnu, ou une file bloquée chez fal, répond « en attente » sans fin.
      if (Date.now() >= deadline) {
        return { kind: "stalled", message: `Génération toujours pas terminée après ${FOLLOW_MAX_MIN} min de suivi.` };
      }
      hooks.onStatus(status);
      continue;
    }
    if (!failure.retryable) {
      // 400 : l'identifiant ne sera jamais accepté, le garder ne servirait à rien.
      return { kind: failure.status === 400 ? "failed" : "refused", message: failure.message };
    }
    failures++;
    if (failures >= MAX_FAILURES) {
      return { kind: "stalled", message: `Suivi interrompu après ${MAX_FAILURES} essais : ${failure.message}` };
    }
    hooks.onRetry(failures, failure.message);
    wait = Math.min(RETRY_MAX_MS, POLL_MS * 2 ** (failures - 1));
  }
}

/** Une attente que le retour sur l'onglet peut écourter. */
function nap(ms: number, wake: { current: (() => void) | null }): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (wake.current === done) wake.current = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    wake.current = done;
  });
}

// ——— Petites aides ———

/** Une graine de 0 à MAX_SEED, tirée dans le navigateur. */
function randomSeed(): number {
  const span = MAX_SEED + 1;
  const limit = Math.floor(2 ** 32 / span) * span;
  const buffer = new Uint32Array(1);
  // Tirage par rejet : 2³² n'est pas un multiple de 10⁹, le modulo seul favoriserait les petites graines.
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % span;
}

function parseSeed(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Math.floor(Number(text));
  return Number.isFinite(value) ? Math.min(MAX_SEED, Math.max(0, value)) : undefined;
}

function sameOptions(a: GenerateOptions, b: SentOptions): boolean {
  return (
    a.resolution === b.resolution &&
    a.textureSize === b.textureSize &&
    a.decimationTarget === b.decimationTarget &&
    a.remesh === b.remesh &&
    a.seed === b.seed
  );
}

/** Les réglages connus d'un modèle ; les anciens n'ont gardé que la résolution. */
function describe(item: HistoryItem): string {
  const parts: string[] = [];
  if (item.resolution) parts.push(`${item.resolution}³`);
  if (item.textureSize) parts.push(`texture ${item.textureSize} px`);
  if (typeof item.decimationTarget === "number") parts.push(`${item.decimationTarget / 1000}k sommets`);
  if (typeof item.remesh === "boolean") parts.push(item.remesh ? "remaillé" : "sans remaillage");
  if (!isSeed(item.seed)) parts.push("graine non enregistrée");
  return parts.join(" · ");
}

function isGlb(f: File): boolean {
  // Le type est souvent vide pour un .glb : l'extension fait foi.
  return f.type === "model/gltf-binary" || /\.glb$/i.test(f.name);
}

/** Le nom des fichiers exportés. */
function baseName(item: Shown): string {
  if (item.fileName) {
    return item.fileName.replace(/\.glb$/i, "").replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 60) || "modele";
  }
  return `trellis-${item.id.slice(0, 8)}`;
}

function launchedAt(t: number): string {
  const date = new Date(t);
  const day = date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const hour = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `le ${day} à ${hour}`;
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

// L'avertissement « site ouvert » ne concerne pas le poste de développement,
// ni un téléphone qui l'atteint par le réseau de la maison.
// Le serveur suppose « local » : rien ne s'affiche avant de savoir.
const LOCAL_HOST =
  /^(localhost|\[::1\]|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2})$|\.local$/;
const noSubscription = () => () => {};
function useIsLocalHost(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => LOCAL_HOST.test(window.location.hostname),
    () => true,
  );
}
