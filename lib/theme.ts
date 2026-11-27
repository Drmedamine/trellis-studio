/*
 * Le thème : clair, sombre, ou celui du système. Le choix vaut pour tous les sites 3ddeal : un cookie partagé par les
 * sous-domaines (dd_theme), avec une copie locale quand les cookies sont refusés. Sans choix, la feuille de style suit le
 * système (prefers-color-scheme) ; un choix se pose en data-theme sur <html> avant la première peinture (THEME_SCRIPT).
 */
export type Theme = "light" | "dark";

const KEY = "dd_theme";
const estTheme = (v: unknown): v is Theme => v === "light" || v === "dark";
const abonnes = new Set<() => void>();

export function storedTheme(): Theme | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)dd_theme=(light|dark)/);
    if (m && estTheme(m[1])) return m[1];
    const garde = window.localStorage.getItem(KEY);
    return estTheme(garde) ? garde : null;
  } catch {
    return null;
  }
}

export function resolvedTheme(): Theme {
  const garde = storedTheme();
  if (garde) return garde;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Le serveur ne connaît ni le choix ni le système : le site est pensé en sombre. */
export function serverTheme(): Theme {
  return "dark";
}

export function subscribeTheme(rappel: () => void): () => void {
  abonnes.add(rappel);
  const media = window.matchMedia?.("(prefers-color-scheme: light)");
  media?.addEventListener("change", rappel);
  return () => {
    abonnes.delete(rappel);
    media?.removeEventListener("change", rappel);
  };
}

export function saveTheme(theme: Theme) {
  try {
    const domaine = /(^|\.)3ddeal\.com$/.test(location.hostname) ? "; domain=3ddeal.com" : "";
    const sur = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `dd_theme=${theme}; path=/; max-age=31536000; SameSite=Lax${domaine}${sur}`;
    window.localStorage.setItem(KEY, theme);
  } catch {
    // Le choix vaut alors pour la page seulement.
  }
  document.documentElement.dataset.theme = theme;
  for (const rappel of abonnes) rappel();
}

export const THEME_SCRIPT =
  'try{var m=document.cookie.match(/(?:^|;\\s*)dd_theme=(light|dark)/),t=m?m[1]:localStorage.getItem("dd_theme");' +
  'if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}';
