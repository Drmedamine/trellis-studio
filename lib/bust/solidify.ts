import * as tables from "three/examples/jsm/objects/MarchingCubes.js";

// Tables de Bourke, telles que three les livre : deux Int32Array plates
// (256 masques d'arêtes, 256 × 16 indices). @types/three les déclare à tort
// comme des tableaux de tableaux.
const edgeTable = tables.edgeTable as unknown as Int32Array;
const triTable = tables.triTable as unknown as Int32Array;

/**
 * Fait d'un maillage TRELLIS.2 un buste imprimable : un seul volume plein et
 * fermé, coupé à plat, posé sur un socle.
 *
 * TRELLIS.2 ne rend que la peau de ce que la photo montre. Le dessous est
 * ouvert, les vêtements sont des feuilles sans épaisseur : un slicer ne sait
 * pas remplir un tel objet. On ne répare donc pas le maillage, on le
 * reconstruit, en voxels :
 *
 *  1. la peau est posée dans une grille, au-dessus de la coupe, deux fois :
 *     les voxels qu'elle touche (pour boucher les trous) et les arêtes entre
 *     centres de voxels qu'elle traverse (pour savoir de quel côté de la peau
 *     tombe chaque centre — c'est ce qui la rend à sa taille, sans gonfler) ;
 *  2. l'extérieur grossier est ce qu'on atteint depuis les côtés et le dessus
 *     sans approcher la peau à moins de `gapClose / 2` : un trou plus petit
 *     ne laisse pas passer, et le plan de coupe ferme le dessous — la tête se
 *     remplit ;
 *  3. l'extérieur revient ensuite jusqu'à la peau, sans la traverser et sans
 *     approcher le cœur du volume : il rentre dans les creux (orbites,
 *     narines, plis d'oreille) mais s'arrête au ras d'un trou bouché. Les
 *     creux ne dépendent donc plus de `gapClose`, qui ne sert qu'aux trous ;
 *  4. seules les parties minces (feuilles de veste, bord d'une oreille) sont
 *     épaissies jusqu'à `minWall` : la peau d'une tête pleine ne bouge pas ;
 *  5. le socle suit l'empreinte réelle de la coupe, on ne garde que le plus
 *     grand morceau, et la surface est refaite par marching cubes sur le
 *     volume lissé.
 *
 * Le résultat est fermé par construction : chaque arête sert exactement deux
 * triangles (`tests/solidify.test.ts` le vérifie).
 */

export type SolidifyInput = {
  /** Sommets en mm, Z en haut. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Hauteur de coupe, en mm, dans le repère de `positions`. */
  cutZ: number;
  /** Côté d'un voxel, en mm. */
  voxel: number;
  /** Épaisseur du socle en mm ; 0 = pas de socle, la coupe sert de base. */
  baseThickness: number;
  /** Débord du socle autour de la coupe, en mm. */
  baseMargin: number;
  /** Trous de la peau plus petits que ce diamètre (mm) : bouchés au ras de la peau. Les creux n'en dépendent pas. */
  gapClose: number;
  /** Épaisseur minimale donnée aux parties minces (mm) ; la peau d'un volume plein n'est pas touchée. */
  minWall: number;
  onProgress?: (fraction: number, step: string) => void;
};

export type SolidifyOutput = {
  /** Sommets en mm, posés sur Z = 0 et centrés en X/Y. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Volume en mm³. */
  volume: number;
  size: [number, number, number];
  /** Côté de voxel réellement employé (grossi si le modèle ne tenait pas). */
  voxel: number;
  /**
   * Morceaux écartés parce qu'ils ne tenaient pas au buste (flottants),
   * rapportés au volume gardé, en voxels : 0,05 = 5 % de plus jetés.
   */
  removedFraction: number;
  /** Déplacement appliqué au repère d'entrée, en mm : sortie = entrée + offset. */
  offset: [number, number, number];
};

/** Au-delà, la grille ne tient plus en mémoire d'un navigateur sans risque. */
export const MAX_VOXELS = 24_000_000;

/**
 * Pas permis dans la peau elle-même pour y classer les centres : deux
 * suffisent à traverser une surface oblique, et c'est trop peu pour faire le
 * tour de la peau par un trou bouché.
 */
const SKIN_STEPS = 2;

export type GridSettings = Pick<SolidifyInput, "voxel" | "baseThickness" | "baseMargin" | "gapClose" | "minWall">;

/** La grille que `solidify` emploiera, en voxels. */
export type GridPlan = {
  /** Côté de voxel employé, en mm (grossi si la grille ne tenait pas). */
  voxel: number;
  /** Rayon de bouchage des trous. */
  gap: number;
  /** Épaississement des parties minces, de chaque côté. */
  wall: number;
  baseVox: number;
  marginVox: number;
  pad: number;
  nx: number;
  ny: number;
  nz: number;
  /** Première couche au-dessus de la coupe : [cutZ, cutZ + voxel). */
  zc: number;
};

/** Demi-épaisseur ajoutée aux parties minces : 2·wall + 1 voxels font au moins `minWall`. */
function wallVoxels(minWall: number, s: number) {
  return Math.max(1, Math.ceil((minWall / s - 1) / 2 - 1e-9));
}

/**
 * Taille la grille : la finesse demandée, grossie de 10 % en 10 % tant
 * qu'elle ne tient pas en mémoire. Seule source de ce calcul : l'interface
 * peut annoncer la finesse réelle avant de lancer quoi que ce soit.
 */
export function planGrid(sizeX: number, sizeY: number, keptHeight: number, settings: GridSettings): GridPlan {
  if (!(settings.voxel > 0) || !Number.isFinite(settings.voxel)) throw new Error("Finesse invalide.");
  if (!Number.isFinite(sizeX + sizeY + keptHeight)) throw new Error("Dimensions du modèle invalides.");
  let s = settings.voxel;
  for (;;) {
    const gap = Math.max(1, Math.round(settings.gapClose / 2 / s));
    const wall = wallVoxels(settings.minWall, s);
    const baseVox = settings.baseThickness > 0 ? Math.max(1, Math.round(settings.baseThickness / s)) : 0;
    const marginVox = Math.ceil(settings.baseMargin / s);
    // Le socle déborde de l'empreinte (elle-même épaissie de `wall`) de
    // `marginVox` : il reste toujours du vide autour, pour fermer la surface.
    const pad = gap + wall + marginVox + 3;
    const nx = Math.ceil(sizeX / s) + 2 * pad;
    const ny = Math.ceil(sizeY / s) + 2 * pad;
    const zc = baseVox + 3;
    const nz = zc + Math.ceil(keptHeight / s) + gap + wall + 3;
    if (nx * ny * nz <= MAX_VOXELS) return { voxel: s, gap, wall, baseVox, marginVox, pad, nx, ny, nz, zc };
    s *= 1.1;
  }
}

/** Le côté de voxel que `solidify` emploiera vraiment pour ce modèle (mm). */
export function plannedVoxel(sizeX: number, sizeY: number, keptHeight: number, settings: GridSettings): number {
  return planGrid(sizeX, sizeY, keptHeight, settings).voxel;
}

export type Extent = { xmin: number; xmax: number; ymin: number; ymax: number; zmax: number };

/**
 * Emprise de ce qui reste au-dessus de la coupe : les sommets gardés, et les
 * points où la coupe traverse une arête. Sans ces derniers, un modèle qui
 * s'élargit vers le bas débordait de la grille au ras de la coupe, et la
 * surface sortait ouverte. `scale` permet de la mesurer sur le maillage
 * brut, arrondie comme le ferait la copie mise à l'échelle en Float32Array :
 * même emprise, donc même grille.
 */
export function extentAboveCut(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  cutZ: number,
  scale = 1,
): Extent {
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  const add = (x: number, y: number) => {
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  };
  const P = new Float64Array(9);
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const v = indices[t + k] * 3;
      for (let a = 0; a < 3; a++) P[3 * k + a] = Math.fround(positions[v + a] * scale);
    }
    for (let k = 0; k < 3; k++) {
      const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2];
      if (z >= cutZ) {
        add(x, y);
        if (z > zmax) zmax = z;
      }
      const m = 3 * ((k + 1) % 3);
      const z2 = P[m + 2];
      if ((z < cutZ) !== (z2 < cutZ)) {
        const f = (cutZ - z) / (z2 - z);
        add(x + f * (P[m] - x), y + f * (P[m + 1] - y));
      }
    }
  }
  return { xmin, xmax, ymin, ymax, zmax };
}

export function solidify(input: SolidifyInput): SolidifyOutput {
  const { cutZ } = input;
  const progress = input.onProgress ?? (() => {});

  const ext = extentAboveCut(input.positions, input.indices, cutZ);
  if (!(ext.zmax > cutZ)) throw new Error("Rien au-dessus de la coupe.");
  const grid = planGrid(ext.xmax - ext.xmin, ext.ymax - ext.ymin, ext.zmax - cutZ, input);
  const { voxel: s, nx, ny, nz, zc, pad } = grid;
  const N = nx * ny * nz;
  const origin: [number, number, number] = [ext.xmin - pad * s, ext.ymin - pad * s, cutZ - zc * s];

  // ── 1 à 4. Le volume, hors socle ───────────────────────────────────────
  const solid = carve(input, grid, origin, progress);

  // ── 5a. Le socle, sous l'empreinte réelle de la coupe ──────────────────
  if (grid.baseVox > 0) addPlinth(solid, grid);

  // ── 5b. Un seul morceau : le plus grand ────────────────────────────────
  const { kept, removed } = keepLargest(solid, nx, ny, nz);
  if (kept === 0) throw new Error("Rien à imprimer au-dessus de la coupe.");
  progress(0.7, "Socle et nettoyage");

  // ── 5c. Surface lisse ──────────────────────────────────────────────────
  const field = new Float32Array(N);
  for (let i = 0; i < N; i++) field[i] = solid[i];
  blur(field, nx, ny, nz);
  blur(field, nx, ny, nz);
  progress(0.8, "Lissage");

  const mesh = marchingCubes(field, nx, ny, nz, 0.5, s, origin[0], origin[1], origin[2]);
  progress(0.95, "Surface reconstruite");

  // Posé sur Z = 0, centré en X et Y.
  const p = mesh.positions;
  let bx0 = Infinity, by0 = Infinity, bz0 = Infinity, bx1 = -Infinity, by1 = -Infinity, bz1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    bx0 = Math.min(bx0, p[i]); bx1 = Math.max(bx1, p[i]);
    by0 = Math.min(by0, p[i + 1]); by1 = Math.max(by1, p[i + 1]);
    bz0 = Math.min(bz0, p[i + 2]); bz1 = Math.max(bz1, p[i + 2]);
  }
  const dx = (bx0 + bx1) / 2, dy = (by0 + by1) / 2;
  for (let i = 0; i < p.length; i += 3) {
    p[i] -= dx;
    p[i + 1] -= dy;
    p[i + 2] -= bz0;
  }

  return {
    positions: p,
    indices: mesh.indices,
    volume: signedVolume(p, mesh.indices),
    size: [bx1 - bx0, by1 - by0, bz1 - bz0],
    voxel: s,
    removedFraction: removed / kept,
    offset: [-dx, -dy, -bz0],
  };
}

/**
 * Étapes 1 à 4 : le volume plein au-dessus de la coupe (couches ≥ zc).
 * Ses tableaux de travail meurent avec elle : la suite a besoin de la place.
 */
function carve(
  input: SolidifyInput,
  grid: GridPlan,
  origin: [number, number, number],
  progress: (fraction: number, step: string) => void,
): Uint8Array {
  const { positions, indices, cutZ } = input;
  const { voxel: s, gap, wall, nx, ny, nz, zc } = grid;
  const [ox, oy, oz] = origin;
  const N = nx * ny * nz;
  const plane = nx * ny;
  const top = zc * plane;

  // ── 1a. Les voxels que la peau touche, échantillonnée triangle par triangle
  const surf = new Uint8Array(N);
  const step = 0.5 * s;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const az = positions[a + 2], bz = positions[b + 2], cz = positions[c + 2];
    if (az < cutZ && bz < cutZ && cz < cutZ) continue;
    const ax = positions[a], ay = positions[a + 1];
    const ux = positions[b] - ax, uy = positions[b + 1] - ay, uz = bz - az;
    const vx = positions[c] - ax, vy = positions[c + 1] - ay, vz = cz - az;
    const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
    const lw = Math.hypot(ux - vx, uy - vy, uz - vz);
    const n = Math.max(1, Math.ceil(Math.max(lu, lv, lw) / step));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const p = i / n, q = j / n;
        const z = az + uz * p + vz * q;
        if (z < cutZ) continue;
        // Bornés par sécurité : un point hors de la grille passerait à la ligne voisine.
        const gx = Math.min(nx - 1, Math.max(0, Math.floor((ax + ux * p + vx * q - ox) / s)));
        const gy = Math.min(ny - 1, Math.max(0, Math.floor((ay + uy * p + vy * q - oy) / s)));
        const gz = Math.min(nz - 1, Math.floor((z - oz) / s));
        surf[gx + nx * (gy + ny * gz)] = 1;
      }
    }
  }
  // ── 1b. Les arêtes entre centres que la peau traverse, exactement
  const crossed = markCrossings(positions, indices, cutZ, origin, s, nx, ny, nz);
  progress(0.15, "Peau posée");

  // ── 2. L'extérieur grossier, qui ne passe pas par les trous de moins de `gapClose`
  const sealed = dilate(surf, nx, ny, nz, gap);
  const outside = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0, tail = 0;
  const seed = (i: number) => {
    if (!sealed[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let z = zc; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      seed(nx * (y + ny * z));
      seed(nx - 1 + nx * (y + ny * z));
    }
    for (let x = 0; x < nx; x++) {
      seed(x + nx * ny * z);
      seed(x + nx * (ny - 1 + ny * z));
    }
  }
  for (let i = 0; i < plane; i++) seed(i + plane * (nz - 1));
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx;
    const y = ((i - x) / nx) % ny;
    const z = (i - x - nx * y) / plane;
    if (x > 0) seed(i - 1);
    if (x < nx - 1) seed(i + 1);
    if (y > 0) seed(i - nx);
    if (y < ny - 1) seed(i + nx);
    // Le plan de coupe ferme le dessous : on ne descend jamais sous zc.
    if (z > zc) seed(i - plane);
    if (z < nz - 1) seed(i + plane);
  }
  progress(0.35, "Intérieur trouvé");

  // ── 3. Le retour de l'extérieur jusqu'à la peau ────────────────────────
  // Le cœur : enfermé, et à plus de `gap` de la peau. Rien ne revient à
  // moins de `gap` de lui : par un trou bouché, l'extérieur s'arrête donc au
  // ras de la peau au lieu de longer son envers. (`sealed` sert de tampon.)
  const core = sealed;
  for (let i = 0; i < N; i++) core[i] = i >= top && !outside[i] && !sealed[i] ? 1 : 0;
  const forbidden = dilate(core, nx, ny, nz, gap);
  regrow(outside, surf, forbidden, crossed, nx, ny, nz, zc, queue);
  progress(0.5, "Creux rouverts");

  // ── 4. Le volume, et les parties minces épaissies ──────────────────────
  const solid = new Uint8Array(N);
  for (let i = top; i < N; i++) solid[i] = outside[i] ? 0 : 1;
  // Mince = là où un cube de 2·wall + 1 voxels ne tient pas dans le volume
  // pris large (peau comprise). Une feuille sans épaisseur l'est partout ;
  // la peau d'une tête pleine, nulle part : elle garde sa taille. Le voxel de
  // plus laisse les marches de l'escalier d'une peau courbe, que le cube ne
  // couvre pas, à leur place : épaissies, elles faisaient des bosses.
  const loose = forbidden;
  for (let i = 0; i < N; i++) loose[i] = i >= top && (solid[i] || surf[i]) ? 1 : 0;
  const opened = dilate(erode(loose, nx, ny, nz, wall), nx, ny, nz, wall + 1);
  const thin = loose;
  for (let i = 0; i < N; i++) thin[i] = surf[i] && !opened[i] ? 1 : 0;
  const thick = dilate(thin, nx, ny, nz, wall);
  for (let i = top; i < N; i++) if (thick[i]) solid[i] = 1;
  // À la racine d'une feuille qui sort du volume en biais, la peau n'est pas
  // « mince » (le cube y tient encore) et l'extérieur l'a reprise : la partie
  // épaissie ne touchait plus le corps qu'en diagonale, et partait au tri des
  // morceaux. La peau qui la jouxte la raccroche.
  const near = dilate(thick, nx, ny, nz, 1);
  for (let i = top; i < N; i++) if (near[i] && surf[i]) solid[i] = 1;
  progress(0.6, "Parois minces épaissies");
  return solid;
}

/**
 * Bits par voxel : 1, 2, 4 = la peau coupe l'arête qui va de son centre à
 * celui du voisin en x + 1, y + 1, z + 1. Chaque triangle est lancé le long
 * des trois axes, sur les lignes de centres que sa projection couvre.
 */
function markCrossings(
  positions: Float32Array, indices: Uint32Array, cutZ: number,
  origin: [number, number, number], s: number, nx: number, ny: number, nz: number,
): Uint8Array {
  const crossed = new Uint8Array(nx * ny * nz);
  const dims = [nx, ny, nz];
  const strides = [1, nx, nx * ny];
  const P = new Float64Array(9);
  // Inclusif : un centre pile sur l'arête commune de deux triangles est vu
  // par les deux plutôt que par aucun — une fuite coûte, un doublon non. La
  // marge est une distance (en voxels), pas une aire : un triangle vu presque
  // par la tranche n'avale pas les lignes voisines.
  const EPS = 1e-6;
  for (let t = 0; t < indices.length; t += 3) {
    let below = 0;
    for (let k = 0; k < 3; k++) {
      const v = indices[t + k] * 3;
      for (let a = 0; a < 3; a++) P[3 * k + a] = (positions[v + a] - origin[a]) / s - 0.5;
      if (positions[v + 2] < cutZ) below++;
    }
    if (below === 3) continue;
    for (let w = 0; w < 3; w++) {
      const u = (w + 1) % 3, v = (w + 2) % 3;
      const au = P[u], av = P[v], bu = P[3 + u], bv = P[3 + v], cu = P[6 + u], cv = P[6 + v];
      let d = (bu - au) * (cv - av) - (bv - av) * (cu - au);
      // Triangle vu par la tranche le long de cet axe : les deux autres le voient.
      if (Math.abs(d) < 1e-12) continue;
      const sg = d > 0 ? 1 : -1;
      d *= sg;
      const u0 = Math.max(0, Math.ceil(Math.min(au, bu, cu) - 1e-6));
      const u1 = Math.min(dims[u] - 1, Math.floor(Math.max(au, bu, cu) + 1e-6));
      const v0 = Math.max(0, Math.ceil(Math.min(av, bv, cv) - 1e-6));
      const v1 = Math.min(dims[v] - 1, Math.floor(Math.max(av, bv, cv) + 1e-6));
      const bit = 1 << w;
      const tAB = -EPS * Math.hypot(bu - au, bv - av);
      const tBC = -EPS * Math.hypot(cu - bu, cv - bv);
      const tCA = -EPS * Math.hypot(au - cu, av - cv);
      // Dans la marge, hors du triangle, la hauteur s'extrapole : on la borne à la sienne.
      const hmin = Math.min(P[w], P[3 + w], P[6 + w]), hmax = Math.max(P[w], P[3 + w], P[6 + w]);
      for (let iu = u0; iu <= u1; iu++) {
        for (let iv = v0; iv <= v1; iv++) {
          const eC = sg * ((bu - au) * (iv - av) - (bv - av) * (iu - au));
          const eA = sg * ((cu - bu) * (iv - bv) - (cv - bv) * (iu - bu));
          const eB = sg * ((au - cu) * (iv - cv) - (av - cv) * (iu - cu));
          if (eA < tBC || eB < tCA || eC < tAB) continue;
          const h = Math.min(hmax, Math.max(hmin, (eA * P[w] + eB * P[3 + w] + eC * P[6 + w]) / d));
          const k = Math.floor(h);
          const line = iu * strides[u] + iv * strides[v];
          if (k >= 0 && k < dims[w] - 1) crossed[line + k * strides[w]] |= bit;
          // Un centre posé sur la peau : il est coupé de ses deux voisins.
          if (h - k < 1e-6 && k >= 1 && k <= dims[w] - 1) crossed[line + (k - 1) * strides[w]] |= bit;
        }
      }
    }
  }
  return crossed;
}

/**
 * Ramène l'extérieur jusqu'à la peau. A : par les voxels que la peau ne
 * touche pas, sans limite, hors de la zone interdite autour du cœur. B : dans
 * les voxels de la peau, `SKIN_STEPS` pas au plus — ceux dont le centre est
 * dehors. On ne franchit jamais une arête que la peau coupe.
 */
function regrow(
  outside: Uint8Array, surf: Uint8Array, forbidden: Uint8Array, crossed: Uint8Array,
  nx: number, ny: number, nz: number, zc: number, queue: Int32Array,
) {
  const plane = nx * ny;
  const N = outside.length;
  const top = zc * plane;
  const around = (i: number, visit: (j: number) => void) => {
    const x = i % nx;
    const y = ((i - x) / nx) % ny;
    const z = (i - x - nx * y) / plane;
    const c = crossed[i];
    if (x > 0 && !(crossed[i - 1] & 1)) visit(i - 1);
    if (x < nx - 1 && !(c & 1)) visit(i + 1);
    if (y > 0 && !(crossed[i - nx] & 2)) visit(i - nx);
    if (y < ny - 1 && !(c & 2)) visit(i + nx);
    if (z > zc && !(crossed[i - plane] & 4)) visit(i - plane);
    if (z < nz - 1 && !(c & 4)) visit(i + plane);
  };

  // A. L'air autour de la peau, jusque dans les creux.
  let head = 0, tail = 0;
  const intoAir = (j: number) => {
    if (!outside[j] && !surf[j] && !forbidden[j]) {
      outside[j] = 2;
      queue[tail++] = j;
    }
  };
  for (let i = top; i < N; i++) if (outside[i] === 1) around(i, intoAir);
  while (head < tail) around(queue[head++], intoAir);

  // B. La peau elle-même, pas à pas.
  tail = 0;
  const intoSkin = (j: number) => {
    if (!outside[j] && surf[j]) {
      outside[j] = 3;
      queue[tail++] = j;
    }
  };
  for (let i = top; i < N; i++) if (outside[i] === 1 || outside[i] === 2) around(i, intoSkin);
  let start = 0;
  for (let round = 1; round < SKIN_STEPS; round++) {
    const end = tail;
    for (let k = start; k < end; k++) around(queue[k], intoSkin);
    start = end;
  }
}

/**
 * Le socle : l'empreinte des trois premières couches au-dessus de la coupe,
 * bouchée (un contour creux devient une semelle pleine), élargie de
 * `marginVox` en X/Y seulement, recopiée sous la coupe. Plusieurs îlots sont
 * réunis par leur enveloppe convexe : un socle est une seule pièce.
 */
function addPlinth(solid: Uint8Array, grid: GridPlan) {
  const { nx, ny, nz, zc, baseVox, marginVox } = grid;
  const plane = nx * ny;
  const foot = new Uint8Array(plane);
  for (let z = zc; z < Math.min(nz, zc + 3); z++) {
    const o = z * plane;
    for (let i = 0; i < plane; i++) if (solid[o + i]) foot[i] = 1;
  }
  fillHoles2d(foot, nx, ny);
  const grown = dilateDisc2d(foot, nx, ny, marginVox);
  if (countIslands2d(grown, nx, ny) > 1) fillHull2d(grown, nx, ny);
  // Par sécurité, rien à moins de 3 voxels du bord : la surface s'y ouvrirait.
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) if (x < 3 || y < 3 || x >= nx - 3 || y >= ny - 3) grown[x + nx * y] = 0;
  }
  for (let z = zc - baseVox; z < zc; z++) solid.set(grown, z * plane);
}

/** Ce que le bord de la grille n'atteint pas sans traverser l'empreinte en fait partie. */
function fillHoles2d(foot: Uint8Array, nx: number, ny: number) {
  const reached = new Uint8Array(foot.length);
  const queue = new Int32Array(foot.length);
  let head = 0, tail = 0;
  const seed = (i: number) => {
    if (!foot[i] && !reached[i]) {
      reached[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < nx; x++) {
    seed(x);
    seed(x + nx * (ny - 1));
  }
  for (let y = 0; y < ny; y++) {
    seed(nx * y);
    seed(nx - 1 + nx * y);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx, y = (i - x) / nx;
    if (x > 0) seed(i - 1);
    if (x < nx - 1) seed(i + 1);
    if (y > 0) seed(i - nx);
    if (y < ny - 1) seed(i + nx);
  }
  for (let i = 0; i < foot.length; i++) if (!reached[i]) foot[i] = 1;
}

/** Dilatation par un disque : un disque posé sur chaque pixel du contour. */
function dilateDisc2d(foot: Uint8Array, nx: number, ny: number, r: number): Uint8Array {
  const out = foot.slice();
  if (r <= 0) return out;
  const disc: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) disc.push(dx, dy);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      const i = x + nx * y;
      if (!foot[i]) continue;
      const edge = x === 0 || x === nx - 1 || y === 0 || y === ny - 1 ||
        !foot[i - 1] || !foot[i + 1] || !foot[i - nx] || !foot[i + nx];
      if (!edge) continue;
      for (let k = 0; k < disc.length; k += 2) {
        const X = x + disc[k], Y = y + disc[k + 1];
        if (X >= 0 && X < nx && Y >= 0 && Y < ny) out[X + nx * Y] = 1;
      }
    }
  }
  return out;
}

/**
 * Nombre d'îlots, en s'arrêtant à deux. 4-connexes, comme `keepLargest` en
 * 3D : deux empreintes qui ne se touchent qu'en diagonale y font deux
 * morceaux, et l'un serait jeté avec tout ce qu'il porte.
 */
function countIslands2d(img: Uint8Array, nx: number, ny: number): number {
  const seen = new Uint8Array(img.length);
  const queue = new Int32Array(img.length);
  let islands = 0;
  for (let s = 0; s < img.length; s++) {
    if (!img[s] || seen[s]) continue;
    if (++islands > 1) return islands;
    let head = 0, tail = 0;
    seen[s] = 1;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      const x = i % nx, y = (i - x) / nx;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx !== 0 && dy !== 0) continue;
          const X = x + dx, Y = y + dy;
          if (X < 0 || X >= nx || Y < 0 || Y >= ny) continue;
          const j = X + nx * Y;
          if (img[j] && !seen[j]) {
            seen[j] = 1;
            queue[tail++] = j;
          }
        }
      }
    }
  }
  return islands;
}

/** Remplit l'enveloppe convexe des pixels allumés (chaîne monotone d'Andrew). */
function fillHull2d(img: Uint8Array, nx: number, ny: number) {
  // Les extrémités de chaque ligne suffisent : l'enveloppe ne passe que par elles.
  const pts: [number, number][] = [];
  for (let y = 0; y < ny; y++) {
    let first = -1, last = -1;
    for (let x = 0; x < nx; x++) {
      if (img[x + nx * y]) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first >= 0) {
      pts.push([first, y]);
      if (last !== first) pts.push([last, y]);
    }
  }
  if (pts.length < 3) return;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length < 3) return;
  let x0 = nx, x1 = 0, y0 = ny, y1 = 0;
  for (const [x, y] of hull) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let inside = true;
      for (let k = 0; k < hull.length && inside; k++) {
        const a = hull[k], b = hull[(k + 1) % hull.length];
        if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) inside = false;
      }
      if (inside) img[x + nx * y] = 1;
    }
  }
}

/** Dilatation par un cube de côté 2r+1 : trois passes séparables, fenêtre glissante. */
function dilate(src: Uint8Array, nx: number, ny: number, nz: number, r: number): Uint8Array {
  let from: Uint8Array = src;
  let a = new Uint8Array(src.length);
  let b = new Uint8Array(src.length);
  const axes: [number, number][] = [
    [1, nx],
    [nx, ny],
    [nx * ny, nz],
  ];
  for (const [stride, len] of axes) {
    const lines = src.length / len;
    for (let l = 0; l < lines; l++) {
      // Début de la ligne l pour cet axe.
      let start: number;
      if (stride === 1) start = l * nx;
      else if (stride === nx) start = (l % nx) + Math.floor(l / nx) * nx * ny;
      else start = l;
      let count = 0;
      for (let k = 0; k < Math.min(r, len); k++) count += from[start + k * stride];
      for (let k = 0; k < len; k++) {
        if (k + r < len) count += from[start + (k + r) * stride];
        if (k - r - 1 >= 0) count -= from[start + (k - r - 1) * stride];
        a[start + k * stride] = count > 0 ? 1 : 0;
      }
    }
    from = a;
    [a, b] = [b, a];
  }
  return from;
}

/** Érosion par le même cube : la dilatation du vide. */
function erode(src: Uint8Array, nx: number, ny: number, nz: number, r: number): Uint8Array {
  const empty = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) empty[i] = src[i] ? 0 : 1;
  const out = dilate(empty, nx, ny, nz, r);
  for (let i = 0; i < out.length; i++) out[i] = out[i] ? 0 : 1;
  return out;
}

/** Flou par moyenne sur un cube de 3 : trois passes séparables. */
function blur(f: Float32Array, nx: number, ny: number, nz: number) {
  const tmp = new Float32Array(f.length);
  const axes: [number, number][] = [
    [1, nx],
    [nx, ny],
    [nx * ny, nz],
  ];
  for (const [stride, len] of axes) {
    const lines = f.length / len;
    for (let l = 0; l < lines; l++) {
      let start: number;
      if (stride === 1) start = l * nx;
      else if (stride === nx) start = (l % nx) + Math.floor(l / nx) * nx * ny;
      else start = l;
      for (let k = 0; k < len; k++) {
        const i = start + k * stride;
        const prev = k > 0 ? f[i - stride] : 0;
        const next = k < len - 1 ? f[i + stride] : 0;
        tmp[i] = (prev + f[i] + next) / 3;
      }
    }
    f.set(tmp);
  }
}

/** Garde le plus grand morceau (6-connexe) ; rend les voxels gardés et écartés. */
function keepLargest(solid: Uint8Array, nx: number, ny: number, nz: number): { kept: number; removed: number } {
  const N = solid.length;
  const plane = nx * ny;
  const seen = new Uint8Array(N);
  const queue = new Int32Array(N);
  const flood = (start: number, mark: number): number => {
    let head = 0, tail = 0;
    seen[start] = mark;
    queue[tail++] = start;
    const visit = (j: number) => {
      if (solid[j] && seen[j] !== mark) {
        seen[j] = mark;
        queue[tail++] = j;
      }
    };
    while (head < tail) {
      const i = queue[head++];
      const x = i % nx;
      const y = ((i - x) / nx) % ny;
      const z = (i - x - nx * y) / plane;
      if (x > 0) visit(i - 1);
      if (x < nx - 1) visit(i + 1);
      if (y > 0) visit(i - nx);
      if (y < ny - 1) visit(i + nx);
      if (z > 0) visit(i - plane);
      if (z < nz - 1) visit(i + plane);
    }
    return tail;
  };
  let best = -1, bestSize = 0, total = 0;
  for (let s = 0; s < N; s++) {
    if (!solid[s] || seen[s]) continue;
    const size = flood(s, 1);
    total += size;
    if (size > bestSize) {
      bestSize = size;
      best = s;
    }
  }
  if (best < 0) return { kept: 0, removed: 0 };
  flood(best, 2);
  for (let i = 0; i < N; i++) if (seen[i] === 1) solid[i] = 0;
  return { kept: bestSize, removed: total - bestSize };
}

// Arêtes d'une cellule, dans l'ordre des tables de three (Bourke) :
// [axe (0=x, 1=y, 2=z), dx, dy, dz] de l'arête de grille qui la porte.
const CELL_EDGES: [number, number, number, number][] = [
  [0, 0, 0, 0], [1, 1, 0, 0], [0, 0, 1, 0], [1, 0, 0, 0],
  [0, 0, 0, 1], [1, 1, 0, 1], [0, 0, 1, 1], [1, 0, 0, 1],
  [2, 0, 0, 0], [2, 1, 0, 0], [2, 1, 1, 0], [2, 0, 1, 0],
];
const CORNERS: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

/**
 * Marching cubes indexé : chaque sommet est porté par une arête de la grille
 * et partagé par toutes les cellules qui la touchent — c'est ce qui rend la
 * surface fermée, et non une soupe de triangles à souder ensuite.
 */
function marchingCubes(
  f: Float32Array, nx: number, ny: number, nz: number,
  iso: number, s: number, ox: number, oy: number, oz: number,
) {
  const plane = nx * ny;
  const vertexOf = new Map<number, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  const cellVerts = new Int32Array(12);

  const edgeVertex = (axis: number, x: number, y: number, z: number): number => {
    const i = x + nx * (y + ny * z);
    const key = i * 3 + axis;
    let v = vertexOf.get(key);
    if (v !== undefined) return v;
    const j = axis === 0 ? i + 1 : axis === 1 ? i + nx : i + plane;
    const a = f[i], b = f[j];
    const t = (iso - a) / (b - a);
    const px = x + (axis === 0 ? t : 0);
    const py = y + (axis === 1 ? t : 0);
    const pz = z + (axis === 2 ? t : 0);
    v = pos.length / 3;
    pos.push(ox + (px + 0.5) * s, oy + (py + 0.5) * s, oz + (pz + 0.5) * s);
    vertexOf.set(key, v);
    return v;
  };

  for (let z = 0; z < nz - 1; z++) {
    for (let y = 0; y < ny - 1; y++) {
      for (let x = 0; x < nx - 1; x++) {
        let cube = 0;
        for (let c = 0; c < 8; c++) {
          const [dx, dy, dz] = CORNERS[c];
          if (f[x + dx + nx * (y + dy + ny * (z + dz))] < iso) cube |= 1 << c;
        }
        const edges = edgeTable[cube];
        if (edges === 0) continue;
        for (let e = 0; e < 12; e++) {
          if (edges & (1 << e)) {
            const [axis, dx, dy, dz] = CELL_EDGES[e];
            cellVerts[e] = edgeVertex(axis, x + dx, y + dy, z + dz);
          }
        }
        const base = cube << 4;
        for (let k = 0; triTable[base + k] !== -1; k += 3) {
          // Coin « dehors » = sous le seuil : dans cet ordre, les tables de
          // three donnent des normales sortantes (le test du volume le garde).
          idx.push(
            cellVerts[triTable[base + k]],
            cellVerts[triTable[base + k + 1]],
            cellVerts[triTable[base + k + 2]],
          );
        }
      }
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

export function signedVolume(p: Float32Array, idx: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}
