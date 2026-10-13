"use client";

import { useImperativeHandle, useState, type Ref } from "react";

/** Pour lire la valeur au moment de s'en servir, même si le champ n'a pas encore perdu le focus. */
export type NumberFieldHandle = {
  /** Borne et valide ce qui est tapé, puis rend la valeur à employer. */
  commit: () => number;
  /**
   * Une saisie attend d'être validée. Deux champs pour une même valeur : seul
   * celui qu'on remplit doit l'emporter, l'autre rendrait l'ancienne.
   */
  pending: () => boolean;
};

/**
 * Un champ numérique qui laisse taper. Borner à chaque touche rendait la
 * saisie impossible : taper « 80 » donnait 20 dès le « 8 », puis 200.
 * Le texte reste donc libre pendant la saisie, encadré de rouge s'il sort
 * des bornes ; il n'est borné et validé qu'en quittant le champ, sur
 * Entrée, ou quand le parent en a besoin (`commit`). `onCommit` n'est
 * appelé que si la valeur change.
 */
export default function NumberField({
  value,
  min,
  max,
  step = 1,
  onCommit,
  disabled,
  className = "",
  ref,
  ...aria
}: {
  value: number;
  min: number;
  max: number;
  /** Pas des flèches du clavier ; la valeur validée est arrondie à ce pas. */
  step?: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  className?: string;
  ref?: Ref<NumberFieldHandle>;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  // null : pas de saisie en cours, le champ montre la valeur validée.
  const [draft, setDraft] = useState<string | null>(null);
  const parsed = draft === null ? value : parseNumber(draft);
  // Un champ vidé pour retaper n'est pas une erreur : il reviendra à la valeur d'avant.
  const invalid = draft !== null && draft.trim() !== "" && !(parsed >= min && parsed <= max);

  function commit(text = draft): number {
    if (text === null) return value;
    const typed = parseNumber(text);
    // Un champ vide ou illisible revient à la valeur d'avant, pas à une valeur par défaut.
    const next = Number.isFinite(typed) ? Math.min(max, Math.max(min, snap(typed, step, min))) : value;
    setDraft(null);
    if (next !== value) onCommit(next);
    return next;
  }

  useImperativeHandle(ref, () => ({ commit: () => commit(), pending: () => draft !== null }));

  return (
    <input
      {...aria}
      type="text"
      inputMode={Number.isInteger(step) && min >= 0 ? "numeric" : "decimal"}
      autoComplete="off"
      value={draft ?? format(value)}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      title={`De ${format(min)} à ${format(max)}`}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          setDraft(null);
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          // Les flèches d'un champ « number », qu'un champ texte n'a pas.
          e.preventDefault();
          const from = Number.isFinite(parsed) ? parsed : value;
          commit(String(from + (e.key === "ArrowUp" ? step : -step)));
        }
      }}
      className={`rounded-lg border bg-zinc-950 px-3 py-2 text-zinc-100 outline-none disabled:opacity-50 ${
        invalid
          ? "border-red-500 ring-1 ring-red-500 focus:border-red-500"
          : "border-zinc-700 focus:border-violet-500"
      } ${className}`}
    />
  );
}

/** Accepte la virgule décimale : c'est elle qu'on tape en français. */
function parseNumber(text: string): number {
  const t = text.trim().replace(/\s/g, "").replace(",", ".");
  return t === "" ? NaN : Number(t);
}

function snap(value: number, step: number, min: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  const snapped = min + Math.round((value - min) / step) * step;
  return Number(snapped.toFixed(decimals));
}

function format(value: number): string {
  return String(value).replace(".", ",");
}
