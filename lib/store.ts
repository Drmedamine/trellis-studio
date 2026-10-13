"use client";

import { useSyncExternalStore } from "react";

// Petit stockage local lu par useSyncExternalStore : pas d'état rempli dans un
// effet, donc pas d'écart entre le rendu serveur et le navigateur.

export type HistoryItem = {
  id: string;
  glbUrl: string;
  thumb: string;
  createdAt: number;
  resolution: string;
};

const HISTORY_KEY = "trellis-studio:history";
const CODE_KEY = "trellis-studio:access-code";
const HISTORY_MAX = 12;

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
