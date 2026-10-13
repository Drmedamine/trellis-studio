import { describe, expect, it } from "vitest";
import { extentAboveCut, plannedVoxel, signedVolume, solidify } from "@/lib/bust/solidify";
import { bustInput, gapCloseFor, plannedBustVoxel, type RawMesh } from "@/lib/bust/client";
import { box, edgeDefects, fakeShoulders, fakeTrellisHead, merge, rayHits, rod, sheet, sphere } from "./fixtures";

type Vec = [number, number, number];

// Les réglages de makeBust pour un buste de cette taille (45 mm gardés).
const base = {
  cutZ: 25,
  voxel: 0.6,
  baseThickness: 4,
  baseMargin: 3,
  gapClose: gapCloseFor(45),
  minWall: 1.2,
};

/** Un point du repère d'entrée, dans celui du résultat. */
const moved = (offset: Vec, p: Vec): Vec => [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]];

describe("solidify", () => {
  const head = fakeTrellisHead();

  it("le modèle de départ a bien les défauts de TRELLIS.2", () => {
    expect(edgeDefects(head.indices).open).toBeGreaterThan(0);
  });

  const out = solidify({ ...head, ...base });
  // Le centre du crâne (sphère R = 30 centrée en z = 40), dans le repère du résultat.
  const centre = moved(out.offset, [0, 0, 40]);

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
    // Plein : depuis le centre, on ne traverse qu'une peau, à 30 mm.
    for (const d of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as Vec[]) {
      const hits = rayHits(out.positions, out.indices, centre, d);
      expect(hits).toHaveLength(1);
      expect(Math.abs(hits[0] - R)).toBeLessThan(base.voxel);
    }
  });

  it("bouche le trou du sommet au ras de la peau", () => {
    // Droit dans l'anneau manquant (entre 2 et 4 mm de l'axe).
    const th = (1.5 * Math.PI) / 48;
    const hits = rayHits(out.positions, out.indices, centre, [Math.sin(th), 0, Math.cos(th)]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toBeGreaterThan(30 - 2 * base.voxel);
  });

  it("pose le buste à plat sur Z = 0, socle compris", () => {
    let zmin = Infinity;
    for (let i = 2; i < out.positions.length; i += 3) zmin = Math.min(zmin, out.positions[i]);
    expect(zmin).toBeCloseTo(0, 5);
    // Hauteur : coupe → sommet (45 mm) + socle (4 mm), au voxel près.
    expect(out.size[2]).toBeGreaterThan(45 + 4 - 2 * base.voxel);
    expect(out.size[2]).toBeLessThan(45 + 4 + 2 * base.voxel);
  });

  it("donne une épaisseur à la feuille de la veste, sans l'enfler", () => {
    // La veste va jusqu'à x = 60 : elle doit exister dans le volume.
    expect(out.size[0]).toBeGreaterThan(60 + 30 - 4);
    // Traversée de part en part, selon sa normale, au milieu de la feuille.
    const n: Vec = [-15 / Math.hypot(15, 40), 0, 40 / Math.hypot(15, 40)];
    const mid: Vec = [50, 0, 31.25];
    const from = moved(out.offset, [mid[0] - 5 * n[0], mid[1], mid[2] - 5 * n[2]]);
    const hits = rayHits(out.positions, out.indices, from, n);
    expect(hits).toHaveLength(2);
    const thickness = hits[1] - hits[0];
    expect(thickness).toBeGreaterThanOrEqual(base.minWall);
    expect(thickness).toBeLessThan(base.minWall + 3 * base.voxel);
  });

  it("ne jette rien quand tout tient ensemble (le socle porte la veste)", () => {
    expect(out.removedFraction).toBe(0);
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

describe("solidify, fidélité", () => {
  // Une boule fermée de 20 mm, finesse « Normal », coupe sous la boule.
  const R = 20, C: Vec = [0, 0, 30];
  const fine = { cutZ: 5, voxel: 0.55, baseThickness: 0, baseMargin: 3, gapClose: gapCloseFor(45), minWall: 1.2 };

  it("rend une sphère à sa taille : ni gonflée, ni rongée", () => {
    const out = solidify({ ...sphere(R, C), ...fine });
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
    const c = moved(out.offset, C);
    let far = 0, near = Infinity;
    for (let i = 0; i < out.positions.length; i += 3) {
      const d = Math.hypot(out.positions[i] - c[0], out.positions[i + 1] - c[1], out.positions[i + 2] - c[2]);
      far = Math.max(far, d);
      near = Math.min(near, d);
    }
    // Avant : la peau entière épaissie, 2 voxels de trop partout.
    expect((far - R) / fine.voxel).toBeLessThan(0.6);
    expect((R - near) / fine.voxel).toBeLessThan(0.6);
    const equivalent = Math.cbrt(out.volume / ((4 / 3) * Math.PI));
    expect(Math.abs(equivalent - R) / fine.voxel).toBeLessThan(0.15);
  });

  // Un creux de 4 mm de large et 3 de profond : une orbite, une narine.
  const dented = sphere(R, C, { width: 4, depth: 3 });
  const depthAlongAxis = (gapClose: number) => {
    const out = solidify({ ...dented, ...fine, gapClose });
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
    const hits = rayHits(out.positions, out.indices, moved(out.offset, C), [1, 0, 0]);
    expect(hits).toHaveLength(1);
    return R - hits[0];
  };

  it("garde un creux de 4 mm de large", () => {
    // Avant : rebouché, il en restait 0,2 mm.
    expect(depthAlongAxis(fine.gapClose)).toBeGreaterThanOrEqual(1.5);
  });

  it("les creux ne dépendent plus du bouchage des trous", () => {
    // 5 mm : l'ancien réglage, qui comblait tout creux de moins de 5 à 6 mm.
    expect(depthAlongAxis(5)).toBeCloseTo(depthAlongAxis(fine.gapClose), 6);
  });
});

describe("solidify, parties minces qui sortent du volume en biais", () => {
  // Une boule fermée de 15 mm ; la feuille ou la tige part de son centre, à
  // 45°, et en sort de 15 mm. Avant : détachée à sa racine, puis jetée.
  const ball = sphere(15, [0, 0, 30]);
  const settings = { cutZ: 5, baseThickness: 0, baseMargin: 3, gapClose: 1.5, minWall: 1.2 };

  for (const voxel of [0.4, 0.55, 0.8]) {
    it(`garde une feuille sans épaisseur (finesse ${voxel} mm)`, () => {
      const out = solidify({ ...merge(ball, sheet([0, 0, 30], 45, 30, 12)), ...settings, voxel });
      expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
      expect(out.removedFraction).toBe(0);
      // La boule seule fait 30 mm : la feuille dépasse de 15·cos 45° ≈ 6 mm.
      expect(out.size[0]).toBeGreaterThan(35);
      expect(out.size[2]).toBeGreaterThan(35);
    });

    it(`garde une tige de 0,3 mm (finesse ${voxel} mm)`, () => {
      const out = solidify({ ...merge(ball, rod([0, 0, 30], 45, 30, 0.3)), ...settings, voxel });
      expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
      expect(out.removedFraction).toBe(0);
      expect(out.size[0]).toBeGreaterThan(35);
    });
  }
});

describe("solidify, socle", () => {
  // Épaules de 120 × 40 mm à la coupe : plus large que la grille n'est profonde.
  const shoulders = fakeShoulders();
  const settings = { cutZ: 0, voxel: 0.6, baseThickness: 4, baseMargin: 3, gapClose: 2, minWall: 1.2 };
  const out = solidify({ ...shoulders, ...settings });

  it("reste un seul volume fermé", () => {
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
    expect(out.removedFraction).toBe(0);
  });

  it("passe sous toute l'empreinte de la coupe, épaules comprises", () => {
    // Avant : un disque borné par la demi-largeur de la grille, les épaules
    // flottaient à 4 mm du plateau.
    let x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < out.positions.length; i += 3) {
      if (out.positions[i + 2] > 1e-4) continue;
      x0 = Math.min(x0, out.positions[i] - out.offset[0]);
      x1 = Math.max(x1, out.positions[i] - out.offset[0]);
    }
    expect(x0).toBeLessThan(-60);
    expect(x1).toBeGreaterThan(60);
    // Chaque colonne de la coupe (ellipse 60 × 20) a le socle dessous : en
    // montant du plateau, la première face rencontrée est le dessous, z = 0.
    let columns = 0;
    for (let x = -59.3; x < 60; x += 4) {
      for (let y = -19.7; y < 20; y += 2.5) {
        if ((x / 60) ** 2 + (y / 20) ** 2 > 1) continue;
        const [ox, oy] = moved(out.offset, [x, y, 0]);
        const hits = rayHits(out.positions, out.indices, [ox, oy, -1], [0, 0, 1]);
        expect(hits[0]).toBeCloseTo(1, 3);
        columns++;
      }
    }
    expect(columns).toBeGreaterThan(100);
  });

  it("réunit deux empreintes qui ne se touchent qu'en diagonale", () => {
    // Deux boîtes de 10 mm décalées en diagonale : leurs empreintes élargies
    // se frôlent par un coin. Comptées comme un seul îlot, elles n'étaient pas
    // réunies, et l'une partait au tri des morceaux.
    const settings = { cutZ: 0, voxel: 0.6, baseThickness: 4, baseMargin: 3, gapClose: 1.5, minWall: 1.2 };
    for (const d of [4.2, 4.4, 4.6]) {
      const two = merge(box([0, 0, -2], [10, 10, 10]), box([10 + d, 10 + d, -2], [20 + d, 20 + d, 10]));
      const out = solidify({ ...two, ...settings });
      expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
      expect(out.removedFraction).toBe(0);
      expect(out.size[0]).toBeGreaterThan(20 + d + 2 * settings.baseMargin - 2 * settings.voxel);
    }
  });
});

describe("solidify, résultat honnête", () => {
  it("dit quelle part a été jetée", () => {
    // Une bille de 5 mm qui flotte à côté de la tête : seule à partir.
    const head = fakeTrellisHead();
    const blob = sphere(5, [-45, 0, 60], undefined, 40, 40);
    const out = solidify({ ...merge(head, blob), ...base });
    const expected = ((4 / 3) * Math.PI * 5 ** 3) / out.volume;
    expect(out.removedFraction).toBeGreaterThan(0.75 * expected);
    expect(out.removedFraction).toBeLessThan(1.25 * expected);
  });

  it("grossit les voxels plutôt que d'échouer sur un grand modèle trop fin, et l'annonce d'avance", () => {
    const head = fakeTrellisHead();
    for (let i = 0; i < head.positions.length; i++) head.positions[i] *= 3;
    const settings = { ...base, cutZ: 75, voxel: 0.2 };
    const e = extentAboveCut(head.positions, head.indices, settings.cutZ);
    const planned = plannedVoxel(e.xmax - e.xmin, e.ymax - e.ymin, e.zmax - settings.cutZ, settings);
    const out = solidify({ ...head, ...settings });
    expect(out.voxel).toBeGreaterThan(0.2);
    expect(out.voxel).toBe(planned);
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
  });

  it("annonce, depuis le maillage brut, la grille que le calcul emploiera", () => {
    const head = fakeTrellisHead();
    // Comme loadRawMesh : l'emprise ne compte que les sommets servis.
    const min: Vec = [Infinity, Infinity, Infinity], max: Vec = [-Infinity, -Infinity, -Infinity];
    for (const v of head.indices) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], head.positions[v * 3 + k]);
        max[k] = Math.max(max[k], head.positions[v * 3 + k]);
      }
    }
    const raw: RawMesh = { ...head, min, max };
    for (const settings of [
      { heightMm: 100, cut: 0.3, base: true, voxel: 0.55 },
      { heightMm: 400, cut: 0, base: true, voxel: 0.4 },
      { heightMm: 60, cut: 0.5, base: false, voxel: 0.8 },
    ]) {
      const input = bustInput(raw, settings);
      const e = extentAboveCut(input.positions, input.indices, input.cutZ);
      const actual = plannedVoxel(e.xmax - e.xmin, e.ymax - e.ymin, e.zmax - input.cutZ, input);
      expect(plannedBustVoxel(raw, settings)).toBe(actual);
      expect(input.gapClose).toBe(gapCloseFor(settings.heightMm - (settings.base ? 4 : 0)));
    }
    // 400 mm en « Fin » ne tient pas : la finesse annoncée est la vraie.
    expect(plannedBustVoxel(raw, { heightMm: 400, cut: 0, base: true, voxel: 0.4 })).toBeGreaterThan(0.4);
  });

  it("reste fermé avec une coupe haute, là où le modèle s'élargit vers le bas", () => {
    // La coupe traverse des triangles dont les sommets du dessus sont plus
    // près de l'axe que la coupe elle-même : avant, la grille ne comptait que
    // ces sommets, la peau et le socle en débordaient et la surface s'ouvrait.
    const head = fakeTrellisHead();
    const min: Vec = [Infinity, Infinity, Infinity], max: Vec = [-Infinity, -Infinity, -Infinity];
    for (const v of head.indices) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], head.positions[v * 3 + k]);
        max[k] = Math.max(max[k], head.positions[v * 3 + k]);
      }
    }
    const raw: RawMesh = { ...head, min, max };
    for (const settings of [
      { heightMm: 20, cut: 0.9, base: true, voxel: 0.55 },
      { heightMm: 20, cut: 0.8, base: true, voxel: 0.55 },
      { heightMm: 20, cut: 0.9, base: false, voxel: 0.4 },
    ]) {
      const input = bustInput(raw, settings);
      const out = solidify(input);
      expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
      expect(plannedBustVoxel(raw, settings)).toBe(out.voxel);
    }
  });

  it("bouche les trous à 6 % de la hauteur gardée, entre 3 et 8 mm", () => {
    expect(gapCloseFor(30)).toBe(3);
    expect(gapCloseFor(96)).toBeCloseTo(5.76, 10);
    expect(gapCloseFor(400)).toBe(8);
  });

  it("par le chemin du site, une tête trouée au sommet sort pleine, pas en coque", () => {
    // Le cas réel qui a échappé aux tests : à 100 mm, le trou du sommet de la
    // fausse tête fait près de 5 mm ; bouché à 1,9 mm, la tête sortait creuse
    // (255 cm³ au lieu de 1 430).
    const head = fakeTrellisHead();
    const min: Vec = [Infinity, Infinity, Infinity], max: Vec = [-Infinity, -Infinity, -Infinity];
    for (const v of head.indices) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], head.positions[v * 3 + k]);
        max[k] = Math.max(max[k], head.positions[v * 3 + k]);
      }
    }
    const out = solidify(bustInput({ ...head, min, max }, { heightMm: 100, cut: 0.25, base: true, voxel: 0.55 }));
    expect(edgeDefects(out.indices)).toEqual({ open: 0, flipped: 0 });
    // Calotte pleine : sphère de rayon 30 × échelle, coupée à 15 mm sous son centre.
    const scale = 96 / (70 - (min[2] + 0.25 * (max[2] - min[2])));
    const R = 30 * scale, h = (70 - (min[2] + 0.25 * (max[2] - min[2]))) * scale;
    const cap = (Math.PI * h * h * (3 * R - h)) / 3;
    expect(out.volume).toBeGreaterThan(0.9 * cap);
  });
});
