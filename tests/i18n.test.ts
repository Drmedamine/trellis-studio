import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DICT } from "@/lib/i18n";

// Chaque phrase passée à tr() dans le code doit avoir son anglais et son arabe : sinon elle resterait en français
// pour tout le monde, sans que rien ne le signale.
const SOURCES = ["components", "app", "lib/bust"].flatMap((dir) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(dir, f)),
);

function phrases(): string[] {
  const out: string[] = [];
  for (const file of SOURCES) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) out.push(JSON.parse(`"${m[1]}"`));
  }
  return out;
}

describe("traductions", () => {
  it("chaque phrase de l'interface est traduite en anglais et en arabe", () => {
    const missing = phrases().filter((p) => !DICT[p]);
    expect(missing).toEqual([]);
  });

  it("les variables {0}, {1}… et les balises <c> se retrouvent dans chaque traduction", () => {
    const marks = (t: string) => [...t.matchAll(/\{\d\}|<c>/g)].map((m) => m[0]).sort().join(" ");
    for (const [fr, [en, ar]] of Object.entries(DICT)) {
      expect(marks(en), fr).toBe(marks(fr));
      expect(marks(ar), fr).toBe(marks(fr));
    }
  });

  it("les étapes du buste, nommées hors des composants, sont traduites", () => {
    const steps = [...readFileSync("lib/bust/solidify.ts", "utf8").matchAll(/progress\([^,]+,\s*"([^"]+)"\)/g)].map((m) => m[1]);
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.filter((s) => !DICT[s])).toEqual([]);
  });
});
