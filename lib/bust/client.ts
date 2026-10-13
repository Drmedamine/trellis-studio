import type { SolidifyInput, SolidifyOutput } from "./solidify";

/** Le maillage du GLB, en un seul bloc, Z en haut (unités du fichier). */
export type RawMesh = {
  positions: Float32Array;
  indices: Uint32Array;
  min: [number, number, number];
  max: [number, number, number];
};

const cache = new Map<string, Promise<RawMesh>>();

/** Charge le GLB une fois par adresse ; three n'est chargé qu'ici, au besoin. */
export function loadRawMesh(url: string): Promise<RawMesh> {
  let p = cache.get(url);
  if (!p) {
    p = readGlb(url);
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

async function readGlb(url: string): Promise<RawMesh> {
  const [THREE, { GLTFLoader }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
  ]);
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);

  const pos: number[] = [];
  const idx: number[] = [];
  const v = new THREE.Vector3();
  gltf.scene.traverse((o) => {
    const mesh = o as import("three").Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    const attr = g.getAttribute("position");
    if (!attr) return;
    const offset = pos.length / 3;
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrixWorld);
      // glTF a Y en haut ; on travaille Z en haut, comme les slicers.
      pos.push(v.x, -v.z, v.y);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(offset + index.getX(i));
    else for (let i = 0; i < attr.count; i++) idx.push(offset + i);
  });
  if (!idx.length) throw new Error("Le fichier ne contient aucun maillage.");

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  // L'emprise ne compte que les sommets servis par un triangle : un sommet
  // orphelin déplacerait la coupe, qui se donne en fraction de la hauteur.
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < indices.length; t++) {
    const i = indices[t] * 3;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { positions, indices, min, max };
}

export type BustSettings = {
  /** Hauteur totale voulue, socle compris, en mm. */
  heightMm: number;
  /** Coupe, en fraction de la hauteur du modèle (0 = tout garder). */
  cut: number;
  base: boolean;
  /** Côté de voxel visé, en mm. */
  voxel: number;
};

export const BASE_THICKNESS = 4;

/** Met le modèle à l'échelle (la partie gardée + le socle = la hauteur voulue) puis le solidifie. */
export function makeBust(
  raw: RawMesh,
  settings: BustSettings,
  onProgress: (fraction: number, step: string) => void,
): Promise<SolidifyOutput> {
  const zmin = raw.min[2], zmax = raw.max[2];
  const cutRaw = zmin + settings.cut * (zmax - zmin);
  const base = settings.base ? BASE_THICKNESS : 0;
  const scale = (settings.heightMm - base) / (zmax - cutRaw);
  const positions = new Float32Array(raw.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = raw.positions[i] * scale;

  const input: Omit<SolidifyInput, "onProgress"> = {
    positions,
    indices: raw.indices.slice(),
    cutZ: cutRaw * scale,
    voxel: settings.voxel,
    baseThickness: base,
    baseMargin: 3,
    gapClose: 5,
    minWall: 1.2,
  };

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./bust.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === "progress") onProgress(msg.fraction, msg.step);
      else {
        worker.terminate();
        if (msg.type === "done") resolve(msg.out);
        else reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || "Le calcul a échoué (mémoire ?)."));
    };
    worker.postMessage(input, [input.positions.buffer, input.indices.buffer]);
  });
}

/** STL binaire, écrit directement : pas de copie en BufferGeometry. */
export function toStl(positions: Float32Array, indices: Uint32Array): Blob {
  const count = indices.length / 3;
  const buf = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buf);
  const header = "Trellis Studio - buste imprimable";
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, count, true);
  let o = 84;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const n of [nx, ny, nz]) {
      view.setFloat32(o, n, true);
      o += 4;
    }
    for (const v of [a, b, c]) {
      for (let k = 0; k < 3; k++) {
        view.setFloat32(o, positions[v + k], true);
        o += 4;
      }
    }
    o += 2;
  }
  return new Blob([buf], { type: "model/stl" });
}

/** Un GLB du buste pour la visionneuse (Y en haut, en mètres pour l'échelle). */
export async function toPreviewGlb(positions: Float32Array, indices: Uint32Array): Promise<string> {
  const [THREE, { GLTFExporter }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/exporters/GLTFExporter.js"),
  ]);
  const p = new Float32Array(positions.length);
  for (let i = 0; i < p.length; i += 3) {
    p[i] = positions[i] / 1000;
    p[i + 1] = positions[i + 2] / 1000;
    p[i + 2] = -positions[i + 1] / 1000;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(p, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.6, metalness: 0 }),
  );
  const glb = (await new GLTFExporter().parseAsync(mesh, { binary: true })) as ArrayBuffer;
  return URL.createObjectURL(new Blob([glb], { type: "model/gltf-binary" }));
}
