/**
 * Un faux modèle TRELLIS.2, avec ses trois défauts : un crâne (sphère de
 * rayon 30 mm) ouvert dessous, un petit trou au sommet, et une « veste » en
 * feuille d'épaisseur nulle qui part de la tête.
 */
export function fakeTrellisHead() {
  const pos: number[] = [];
  const idx: number[] = [];
  const R = 30, cz = 40, rings = 48, segs = 96;
  const vert = (x: number, y: number, z: number) => (pos.push(x, y, z), pos.length / 3 - 1);
  const grid: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const th = (Math.PI * i) / rings;
    const row: number[] = [];
    for (let j = 0; j < segs; j++) {
      const ph = (2 * Math.PI * j) / segs;
      row.push(vert(R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph), cz + R * Math.cos(th)));
    }
    grid.push(row);
  }
  for (let i = 0; i < rings; i++) {
    const zMid = cz + R * Math.cos((Math.PI * (i + 0.5)) / rings);
    if (zMid < 22) continue; // dessous ouvert
    if (i === 1) continue; // petit trou au sommet (~4 mm)
    for (let j = 0; j < segs; j++) {
      const a = grid[i][j], b = grid[i][(j + 1) % segs], c = grid[i + 1][(j + 1) % segs], d = grid[i + 1][j];
      idx.push(a, d, c, a, c, b);
    }
  }
  // La « veste » : une feuille sans épaisseur, finement découpée.
  const n = 40;
  const sheet: number[][] = [];
  for (let u = 0; u <= n; u++) {
    const row: number[] = [];
    for (let v = 0; v <= n; v++) row.push(vert(20 + (40 * u) / n, -25 + (50 * v) / n, 20 + (15 * u) / n));
    sheet.push(row);
  }
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      idx.push(sheet[u][v], sheet[u + 1][v], sheet[u + 1][v + 1], sheet[u][v], sheet[u + 1][v + 1], sheet[u][v + 1]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Arêtes mal servies : vues autrement que deux fois, ou deux fois dans le même sens. */
export function edgeDefects(indices: Uint32Array) {
  const directed = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[t + k], b = indices[t + ((k + 1) % 3)];
      const key = `${a}>${b}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  let open = 0, flipped = 0;
  for (const [key, count] of directed) {
    const [a, b] = key.split(">");
    const back = directed.get(`${b}>${a}`) ?? 0;
    if (count > 1) flipped++;
    if (back === 0) open++;
  }
  return { open, flipped };
}

/**
 * Une sphère fermée, pôles sur l'axe x (les anneaux s'y resserrent). Avec
 * `dent`, un creux conique au pôle +x — une orbite, une narine : `width` de
 * large à l'entrée, `depth` de profond sur l'axe.
 */
export function sphere(
  R: number,
  centre: [number, number, number],
  dent?: { width: number; depth: number },
  rings = 200,
  segs = 160,
) {
  const pos: number[] = [];
  const idx: number[] = [];
  const [cx, cy, cz] = centre;
  const radius = (th: number) => {
    if (!dent) return R;
    const half = dent.width / 2, arc = R * th;
    return arc < half ? R - dent.depth * (1 - arc / half) : R;
  };
  const vert = (th: number, ph: number) => {
    const r = radius(th);
    pos.push(cx + r * Math.cos(th), cy + r * Math.sin(th) * Math.cos(ph), cz + r * Math.sin(th) * Math.sin(ph));
    return pos.length / 3 - 1;
  };
  const north = vert(0, 0);
  const rows: number[][] = [];
  for (let i = 1; i < rings; i++) {
    const row: number[] = [];
    for (let j = 0; j < segs; j++) row.push(vert((Math.PI * i) / rings, (2 * Math.PI * j) / segs));
    rows.push(row);
  }
  const south = vert(Math.PI, 0);
  for (let j = 0; j < segs; j++) {
    const k = (j + 1) % segs;
    idx.push(north, rows[0][j], rows[0][k]);
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i][j], b = rows[i][k], c = rows[i + 1][k], d = rows[i + 1][j];
      idx.push(a, d, c, a, c, b);
    }
    idx.push(south, rows[rows.length - 1][k], rows[rows.length - 1][j]);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/**
 * Un buste large : des épaules (ellipsoïde de 120 × 40 mm à la coupe z = 0,
 * ouvert dessous comme TRELLIS.2 les rend) et une tête posée dessus.
 */
export function fakeShoulders() {
  const pos: number[] = [];
  const idx: number[] = [];
  const ellipsoid = (a: number, b: number, c: number, cz: number, zOpen: number) => {
    const rings = 60, segs = 120;
    const grid: number[][] = [];
    for (let i = 0; i <= rings; i++) {
      const th = (Math.PI * i) / rings;
      const row: number[] = [];
      for (let j = 0; j < segs; j++) {
        const ph = (2 * Math.PI * j) / segs;
        pos.push(a * Math.sin(th) * Math.cos(ph), b * Math.sin(th) * Math.sin(ph), cz + c * Math.cos(th));
        row.push(pos.length / 3 - 1);
      }
      grid.push(row);
    }
    for (let i = 0; i < rings; i++) {
      if (cz + c * Math.cos((Math.PI * (i + 0.5)) / rings) < zOpen) continue;
      for (let j = 0; j < segs; j++) {
        const k = (j + 1) % segs;
        idx.push(grid[i][j], grid[i + 1][j], grid[i + 1][k], grid[i][j], grid[i + 1][k], grid[i][k]);
      }
    }
  };
  ellipsoid(60, 20, 30, 0, -10);
  ellipsoid(15, 15, 18, 40, -Infinity);
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Deux maillages en un. */
export function merge(a: { positions: Float32Array; indices: Uint32Array }, b: { positions: Float32Array; indices: Uint32Array }) {
  const positions = new Float32Array(a.positions.length + b.positions.length);
  positions.set(a.positions);
  positions.set(b.positions, a.positions.length);
  const indices = new Uint32Array(a.indices.length + b.indices.length);
  indices.set(a.indices);
  const offset = a.positions.length / 3;
  for (let i = 0; i < b.indices.length; i++) indices[a.indices.length + i] = b.indices[i] + offset;
  return { positions, indices };
}

/**
 * Distances (croissantes) où le rayon `o + t·d` traverse le maillage, t > 0
 * (Möller–Trumbore). Un rayon qui passe sur une arête la voit dans ses deux
 * triangles : une traversée n'est comptée qu'une fois.
 */
export function rayHits(
  positions: Float32Array,
  indices: Uint32Array,
  o: [number, number, number],
  d: [number, number, number],
): number[] {
  const hits: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-12) continue;
    const s = [o[0] - positions[a], o[1] - positions[a + 1], o[2] - positions[a + 2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < -1e-9 || u > 1 + 1e-9) continue;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
    if (v < -1e-9 || u + v > 1 + 1e-9) continue;
    const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
    if (dist > 0) hits.push(dist);
  }
  hits.sort((x, y) => x - y);
  return hits.filter((t, i) => i === 0 || t - hits[i - 1] > 1e-5);
}

/** Une boîte fermée, d'un coin à l'autre. */
export function box(min: [number, number, number], max: [number, number, number]) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const positions = new Float32Array([
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  return { positions, indices };
}

/**
 * Une feuille sans épaisseur (col, revers, mèche plate) qui part de `from`
 * et monte de `angle` degrés dans le plan XZ, `width` de large en Y.
 */
export function sheet(from: [number, number, number], angle: number, length: number, width: number, n = 40) {
  const a = (angle * Math.PI) / 180;
  const pos: number[] = [];
  const idx: number[] = [];
  const rows: number[][] = [];
  for (let u = 0; u <= n; u++) {
    const t = (length * u) / n;
    const row: number[] = [];
    for (let v = 0; v <= n; v++) {
      pos.push(from[0] + t * Math.cos(a), from[1] - width / 2 + (width * v) / n, from[2] + t * Math.sin(a));
      row.push(pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      idx.push(rows[u][v], rows[u + 1][v], rows[u + 1][v + 1], rows[u][v], rows[u + 1][v + 1], rows[u][v + 1]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

/** Une tige (mèche, branche de lunettes) : un tube ouvert de `diameter`, dans le plan XZ, à `angle` degrés. */
export function rod(from: [number, number, number], angle: number, length: number, diameter: number, segs = 8, n = 60) {
  const a = (angle * Math.PI) / 180;
  const axis = [Math.cos(a), 0, Math.sin(a)];
  const side = [-Math.sin(a), 0, Math.cos(a)];
  const r = diameter / 2;
  const pos: number[] = [];
  const idx: number[] = [];
  const rows: number[][] = [];
  for (let u = 0; u <= n; u++) {
    const t = (length * u) / n;
    const row: number[] = [];
    for (let k = 0; k < segs; k++) {
      const c = r * Math.cos((2 * Math.PI * k) / segs), s = r * Math.sin((2 * Math.PI * k) / segs);
      pos.push(from[0] + t * axis[0] + s * side[0], from[1] + c, from[2] + t * axis[2] + s * side[2]);
      row.push(pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let u = 0; u < n; u++) {
    for (let k = 0; k < segs; k++) {
      const kk = (k + 1) % segs;
      idx.push(rows[u][k], rows[u + 1][k], rows[u + 1][kk], rows[u][k], rows[u + 1][kk], rows[u][kk]);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
