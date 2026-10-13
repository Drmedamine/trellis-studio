"use client";

import { useSyncExternalStore } from "react";
import {
  DECIMATIONS,
  RESOLUTIONS,
  TEXTURE_SIZES,
  type GenerateOptions,
  type Resolution,
  type TextureSize,
} from "./options";

// Petit stockage local lu par useSyncExternalStore : pas d'état rempli dans un
// effet, donc pas d'écart entre le rendu serveur et le navigateur.

export type HistoryItem = {
  id: string;
  glbUrl: string;
  thumb: string;
  createdAt: number;
  // Réglages de la génération. Optionnels : les modèles enregistrés avant
  // qu'on les garde n'ont que la résolution, et doivent rester lisibles.
  resolution?: string;
  textureSize?: string;
  decimationTarget?: number;
  remesh?: boolean;
  seed?: number;
};

/** Des réglages complets : la graine y est toujours, c'est elle qui rend un résultat reproductible. */
export type SentOptions = GenerateOptions & { seed: number };

/**
 * Une génération payée dont le modèle n'est pas encore récupéré. Écrite dès
 * que fal.ai a donné son identifiant : une page fermée ou un réseau coupé ne
 * la perd plus, le suivi reprend au retour.
 */
export type PendingJob = {
  requestId: string;
  thumb: string;
  options: SentOptions;
  startedAt: number;
};

/** La plus grande graine acceptée par /api/generate (9 chiffres). */
export const MAX_SEED = 999_999_999;

const HISTORY_KEY = "trellis-studio:history";
const CODE_KEY = "trellis-studio:access-code";
const PENDING_KEY = "trellis-studio:pending";
const HISTORY_MAX = 12;
// Pas de plafond pour les générations en attente : chacune est payée et peut
// encore être récupérée. Elles ne partent que récupérées, échouées ou oubliées.
// La même règle que /api/status : un identifiant qu'il refuserait ne sert à rien.
const REQUEST_ID = /^[0-9a-f-]{8,64}$/i;

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read<T>(key: string, parse: (raw: string | null) => T): T {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {}
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;
  const value = parse(raw);
  cache.set(key, { raw, value });
  return value;
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
  listeners.forEach((l) => l());
}

export function isSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SEED;
}

/**
 * Des réglages complets et valides, ou null. Ce qui vient du stockage a pu
 * être écrit par une ancienne version : chaque champ est revérifié.
 */
export function parseOptions(value: unknown): SentOptions | null {
  if (!value || typeof value !== "object") return null;
  const { resolution, textureSize, decimationTarget, remesh, seed } = value as Record<string, unknown>;
  if (!(RESOLUTIONS as readonly unknown[]).includes(resolution)) return null;
  if (!(TEXTURE_SIZES as readonly unknown[]).includes(textureSize)) return null;
  if (!(DECIMATIONS as readonly unknown[]).includes(decimationTarget)) return null;
  if (typeof remesh !== "boolean" || !isSeed(seed)) return null;
  return {
    resolution: resolution as Resolution,
    textureSize: textureSize as TextureSize,
    decimationTarget: decimationTarget as number,
    remesh,
    seed,
  };
}

/** Les réglages qui ont produit ce modèle, s'ils ont tous été gardés. */
export function settingsOf(item: HistoryItem): SentOptions | null {
  return parseOptions(item);
}

const EMPTY: HistoryItem[] = [];

function parseHistory(raw: string | null): HistoryItem[] {
  if (!raw) return EMPTY;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list)
      ? list.filter(
          (i): i is HistoryItem =>
            i && typeof i.id === "string" && typeof i.glbUrl === "string" &&
            /^https:\/\//.test(i.glbUrl),
        )
      : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function useHistory() {
  return useSyncExternalStore(
    subscribe,
    () => read(HISTORY_KEY, parseHistory),
    () => EMPTY,
  );
}

export function addToHistory(item: HistoryItem) {
  const list = read(HISTORY_KEY, parseHistory).filter((i) => i.id !== item.id);
  write(HISTORY_KEY, JSON.stringify([item, ...list].slice(0, HISTORY_MAX)));
}

export function removeFromHistory(id: string) {
  const list = read(HISTORY_KEY, parseHistory).filter((i) => i.id !== id);
  write(HISTORY_KEY, JSON.stringify(list));
}

const NO_JOB: PendingJob[] = [];

function parsePending(raw: string | null): PendingJob[] {
  if (!raw) return NO_JOB;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return NO_JOB;
    const jobs: PendingJob[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const { requestId, thumb, options, startedAt } = entry as Record<string, unknown>;
      const parsed = parseOptions(options);
      if (typeof requestId !== "string" || !REQUEST_ID.test(requestId) || !parsed) continue;
      if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) continue;
      jobs.push({ requestId, thumb: typeof thumb === "string" ? thumb : "", options: parsed, startedAt });
    }
    return jobs.length ? jobs : NO_JOB;
  } catch {
    return NO_JOB;
  }
}

/** Les générations payées pas encore récupérées, la plus récente d'abord. */
export function usePendingJobs() {
  return useSyncExternalStore(
    subscribe,
    () => read(PENDING_KEY, parsePending),
    () => NO_JOB,
  );
}

/** Même lecture, hors rendu (dans un gestionnaire d'évènement ou un effet). */
export function pendingJobs(): PendingJob[] {
  return read(PENDING_KEY, parsePending);
}

export function addPendingJob(job: PendingJob) {
  const list = pendingJobs().filter((j) => j.requestId !== job.requestId);
  write(PENDING_KEY, JSON.stringify([job, ...list]));
}

export function removePendingJob(requestId: string) {
  const list = pendingJobs().filter((j) => j.requestId !== requestId);
  write(PENDING_KEY, list.length ? JSON.stringify(list) : null);
}

export function useAccessCode() {
  return useSyncExternalStore(
    subscribe,
    () => read(CODE_KEY, (raw) => raw ?? ""),
    () => "",
  );
}

export function setAccessCode(code: string) {
  write(CODE_KEY, code || null);
}

/**
 * L'en-tête du code d'accès, seulement si un code a été saisi. Relu à chaque
 * appel : un code corrigé pendant un suivi sert dès l'interrogation suivante.
 * Encodé, car un en-tête HTTP ne porte pas « é » tel quel.
 */
export function accessHeaders(): Record<string, string> {
  const code = read(CODE_KEY, (raw) => raw ?? "").trim();
  if (!code) return {};
  try {
    return { "x-access-code": encodeURIComponent(code) };
  } catch {
    // Un caractère que encodeURIComponent refuse (moitié d'émoji) : sans
    // en-tête, le serveur répond « code invalide », ce qui est vrai.
    return {};
  }
}
