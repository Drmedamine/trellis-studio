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
