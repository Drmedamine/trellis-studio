/**
 * Convertit le GLB généré en STL binaire prêt pour un slicer :
 * Z en haut, posé sur le plateau, centré, mis à la hauteur demandée en mm.
 * Chargé seulement au clic (three ne part pas dans la page).
 */
export async function glbToStl(glbUrl: string, heightMm: number): Promise<Blob> {
  const [THREE, { GLTFLoader }, { STLExporter }] = await Promise.all([
    import("three"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/exporters/STLExporter.js"),
  ]);

  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // glTF a Y en haut ; les slicers attendent Z en haut.
  const holder = new THREE.Group();
  holder.add(root);
  holder.rotation.x = Math.PI / 2;
  holder.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.z > 0 ? heightMm / size.z : 1;
  holder.scale.setScalar(scale);
  holder.updateMatrixWorld(true);

  const scaled = new THREE.Box3().setFromObject(holder);
  const center = scaled.getCenter(new THREE.Vector3());
  holder.position.set(-center.x, -center.y, -scaled.min.z);
  holder.updateMatrixWorld(true);

  const data = new STLExporter().parse(holder, { binary: true }) as DataView;
  return new Blob([data.buffer as ArrayBuffer], { type: "model/stl" });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
