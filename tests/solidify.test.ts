import { describe, expect, it } from "vitest";
import { solidify, signedVolume } from "@/lib/bust/solidify";
import { edgeDefects, fakeTrellisHead } from "./fixtures";

const base = {
  cutZ: 25,
  voxel: 0.6,
  baseThickness: 4,
  baseMargin: 3,
  gapClose: 5,
  minWall: 1.2,
};

describe("solidify", () => {
  const head = fakeTrellisHead();

  it("le modèle de départ a bien les défauts de TRELLIS.2", () => {
    expect(edgeDefects(head.indices).open).toBeGreaterThan(0);
  });

  const out = solidify({ ...head, ...base });

  it("rend un volume fermé : chaque arête sert deux triangles, en sens opposés", () => {
    expect(out.indices.length).toBeGreaterThan(0);
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
  });

  it("oriente les normales vers l'extérieur", () => {
    expect(signedVolume(out.positions, out.indices)).toBeGreaterThan(0);
  });

  it("remplit la tête au lieu d'en faire une coque", () => {
    // Calotte de sphère R = 30 au-dessus de la coupe (h = 45 mm).
    const R = 30, h = 40 + R - base.cutZ;
    const cap = (Math.PI * h * h * (3 * R - h)) / 3;
    expect(out.volume).toBeGreaterThan(0.85 * cap);
  });

  it("pose le buste à plat sur Z = 0, socle compris", () => {
    let zmin = Infinity;
    for (let i = 2; i < out.positions.length; i += 3) zmin = Math.min(zmin, out.positions[i]);
    expect(zmin).toBeCloseTo(0, 5);
    // Hauteur : coupe → sommet (45 mm) + socle (4 mm), au voxel près.
    expect(out.size[2]).toBeGreaterThan(45 + 4 - 2 * base.voxel);
    expect(out.size[2]).toBeLessThan(45 + 4 + 2 * base.voxel);
  });

  it("donne une épaisseur à la feuille de la veste", () => {
    // La veste va jusqu'à x = 60 : elle doit exister dans le volume.
    expect(out.size[0]).toBeGreaterThan(60 + 30 - 4);
  });

  it("sans socle, la coupe sert de base", () => {
    const flat = solidify({ ...head, ...base, baseThickness: 0 });
    expect(edgeDefects(flat.indices)).toEqual({ open: 0, flipped: 0 });
    expect(flat.size[2]).toBeLessThan(45 + 2 * base.voxel);
  });

  it("refuse une coupe au-dessus du modèle", () => {
    expect(() => solidify({ ...head, ...base, cutZ: 500 })).toThrow();
  });
});

describe("solidify, mémoire", () => {
  it("grossit les voxels plutôt que d'échouer sur un grand modèle trop fin", () => {
    const head = fakeTrellisHead();
    for (let i = 0; i < head.positions.length; i++) head.positions[i] *= 3;
    const out = solidify({ ...head, ...base, cutZ: 75, voxel: 0.2 });
    expect(out.voxel).toBeGreaterThan(0.2);
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
  });
});
