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
 *  1. la peau est posée dans une grille, au-dessus de la coupe seulement ;
 *  2. l'extérieur est ce qu'on atteint depuis les côtés et le dessus sans
 *     traverser la peau épaissie de `gapClose` — un trou plus petit ne laisse
 *     pas passer, et le plan de coupe ferme le dessous : la tête se remplit ;
 *  3. le volume est tout ce qui n'est pas l'extérieur (rendu à sa taille),
 *     plus la peau épaissie de `minWall` — une feuille de veste devient une
 *     paroi imprimable ;
 *  4. on ajoute le socle, on ne garde que le plus grand morceau, et la
 *     surface est refaite par marching cubes sur le volume lissé.
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
  /** Trous plus petits que ce diamètre (mm) : bouchés. */
  gapClose: number;
  /** Épaisseur minimale donnée aux parois minces (mm). */
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
};

/** Au-delà, la grille ne tient plus en mémoire d'un navigateur sans risque. */
export const MAX_VOXELS = 24_000_000;

export function solidify(input: SolidifyInput): SolidifyOutput {
  const { positions, indices, cutZ } = input;
  const progress = input.onProgress ?? (() => {});

  // ── Emprise de ce qui reste au-dessus de la coupe ──────────────────────
  let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const z = positions[i + 2];
    if (z < cutZ) continue;
    const x = positions[i], y = positions[i + 1];
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
    if (z > zmax) zmax = z;
  }
  if (!(zmax > cutZ)) throw new Error("Rien au-dessus de la coupe.");

  // La finesse demandée, grossie s'il le faut pour tenir en mémoire.
  let s = input.voxel;
  let gap = 0, wall = 0, baseVox = 0, marginVox = 0, pad = 0, nx = 0, ny = 0, nz = 0, zc = 0, N = 0;
  for (;;) {
    gap = Math.max(1, Math.round(input.gapClose / 2 / s));
    wall = Math.max(1, Math.round(input.minWall / 2 / s));
    baseVox = input.baseThickness > 0 ? Math.max(1, Math.round(input.baseThickness / s)) : 0;
    marginVox = Math.ceil(input.baseMargin / s);
    pad = gap + wall + marginVox + 3;
    nx = Math.ceil((xmax - xmin) / s) + 2 * pad;
    ny = Math.ceil((ymax - ymin) / s) + 2 * pad;
    // Couche zc = première couche au-dessus de la coupe : [cutZ, cutZ + s).
    zc = baseVox + 3;
    nz = zc + Math.ceil((zmax - cutZ) / s) + gap + wall + 3;
    N = nx * ny * nz;
    if (N <= MAX_VOXELS) break;
    s *= 1.1;
  }

  const ox = xmin - pad * s;
  const oy = ymin - pad * s;
  const oz = cutZ - zc * s;
  const plane = nx * ny;

  // ── 1. La peau, échantillonnée triangle par triangle ───────────────────
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
        const gx = Math.floor((ax + ux * p + vx * q - ox) / s);
        const gy = Math.floor((ay + uy * p + vy * q - oy) / s);
        const gz = Math.min(nz - 1, Math.floor((z - oz) / s));
        surf[gx + nx * (gy + ny * gz)] = 1;
      }
    }
  }
  progress(0.15, "Peau posée");

  // ── 2. L'extérieur, qui ne passe pas par les trous de moins de `gapClose`
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
  progress(0.4, "Intérieur trouvé");

  // ── 3. Le volume : ni l'extérieur rendu à sa taille, ou une paroi épaissie
  const far = dilate(outside, nx, ny, nz, gap);
  const thick = dilate(surf, nx, ny, nz, wall);
  const solid = new Uint8Array(N);
  for (let i = zc * plane; i < N; i++) solid[i] = !far[i] || thick[i] ? 1 : 0;
  progress(0.6, "Volume plein");

  // ── 4a. Le socle : un disque sous la coupe, débordant de `baseMargin` ──
  if (baseVox > 0) {
    let cx = 0, cy = 0, count = 0;
    for (let z = zc; z < Math.min(nz, zc + 3); z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          if (solid[x + nx * (y + ny * z)]) {
            cx += x;
            cy += y;
            count++;
          }
        }
      }
    }
    if (count > 0) {
      cx /= count;
      cy /= count;
      let r2 = 0;
      for (let z = zc; z < Math.min(nz, zc + 3); z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            if (solid[x + nx * (y + ny * z)]) r2 = Math.max(r2, (x - cx) ** 2 + (y - cy) ** 2);
          }
        }
      }
      const r = Math.min(Math.sqrt(r2) + marginVox, Math.min(cx, nx - 1 - cx, cy, ny - 1 - cy) - 2);
      for (let z = zc - baseVox; z < zc; z++) {
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) solid[x + nx * (y + ny * z)] = 1;
          }
        }
      }
    }
  }

  // ── 4b. Un seul morceau : le plus grand ────────────────────────────────
  keepLargest(solid, nx, ny, nz, queue);
  progress(0.7, "Socle et nettoyage");

  // ── 4c. Surface lisse ──────────────────────────────────────────────────
  const field = new Float32Array(N);
  for (let i = 0; i < N; i++) field[i] = solid[i];
  blur(field, nx, ny, nz);
  blur(field, nx, ny, nz);
  progress(0.8, "Lissage");

  const mesh = marchingCubes(field, nx, ny, nz, 0.5, s, ox, oy, oz);
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
  };
}

/** Dilatation par un cube de côté 2r+1 : trois passes séparables, fenêtre glissante. */
function dilate(src: Uint8Array, nx: number, ny: number, nz: number, r: number): Uint8Array {
  let a = src.slice();
  let b = new Uint8Array(src.length);
  const axes: [number, number][] = [
    [1, nx],
    [nx, ny],
    [nx * ny, nz],
  ];
  for (const [stride, len] of axes) {
    b.fill(0);
    const lines = src.length / len;
    for (let l = 0; l < lines; l++) {
      // Début de la ligne l pour cet axe.
      let start: number;
      if (stride === 1) start = l * nx;
      else if (stride === nx) start = (l % nx) + Math.floor(l / nx) * nx * ny;
      else start = l;
      let count = 0;
      for (let k = 0; k < Math.min(r, len); k++) count += a[start + k * stride];
      for (let k = 0; k < len; k++) {
        if (k + r < len) count += a[start + (k + r) * stride];
        if (k - r - 1 >= 0) count -= a[start + (k - r - 1) * stride];
        if (count > 0) b[start + k * stride] = 1;
      }
    }
    [a, b] = [b, a];
  }
  return a;
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

function keepLargest(solid: Uint8Array, nx: number, ny: number, nz: number, queue: Int32Array) {
  const N = solid.length;
  const plane = nx * ny;
  const label = new Int32Array(N);
  let best = 0, bestSize = 0, next = 0;
  for (let s = 0; s < N; s++) {
    if (!solid[s] || label[s]) continue;
    next++;
    let head = 0, tail = 0, size = 0;
    label[s] = next;
    queue[tail++] = s;
    while (head < tail) {
      const i = queue[head++];
      size++;
      const x = i % nx;
      const y = ((i - x) / nx) % ny;
      const z = (i - x - nx * y) / plane;
      const visit = (j: number) => {
        if (solid[j] && !label[j]) {
          label[j] = next;
          queue[tail++] = j;
        }
      };
      if (x > 0) visit(i - 1);
      if (x < nx - 1) visit(i + 1);
      if (y > 0) visit(i - nx);
      if (y < ny - 1) visit(i + nx);
      if (z > 0) visit(i - plane);
      if (z < nz - 1) visit(i + plane);
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  for (let i = 0; i < N; i++) if (solid[i] && label[i] !== best) solid[i] = 0;
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
