// js/engine/graphics/bolts.js — розряди блискавок: ламана зі стрічок, повернутих до камери (емісійні, адитивні, без
// освітлення й тіней; як лінії-«білборди» частинок PlayCanvas). Рушій без модулів гри: ламану (точки в координатах гри,
// вузол під G.root, плаваючий початок — G.O) будує гра.
const MAXS = 96;                                   // відрізків на кадр (стовбур і гілки)
export function createBolts(G) {
  const { pc, dev } = G;
  const mat = new pc.StandardMaterial();
  mat.useLighting = false; mat.useSkybox = false; mat.useFog = false;
  mat.diffuse = new pc.Color(0, 0, 0); mat.emissive = new pc.Color(0.82, 0.88, 1);
  mat.blendType = pc.BLEND_ADDITIVE; mat.depthWrite = false; mat.cull = pc.CULLFACE_NONE;
  mat.update();
  const pos = new Float32Array(MAXS * 4 * 3), idx = new Uint16Array(MAXS * 6);
  for (let i = 0; i < MAXS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  const mesh = new pc.Mesh(dev);
  mesh.setPositions(pos); mesh.setIndices(idx); mesh.update(pc.PRIMITIVE_TRIANGLES);
  const node = new pc.GraphNode('блискавка');
  G.root.addChild(node);
  const mi = new pc.MeshInstance(mesh, mat, node);
  mi.castShadow = false; mi.visible = false;
  G.layers.world.addMeshInstances([mi]);
  // segs — [[x0, y0, z0, x1, y1, z1, ширина], …] (гра), eye — око (гра), k — яскравість
  function show(segs, eye, k) {
    pos.fill(0);
    const n = Math.min(MAXS, segs.length), O = G.O;
    for (let i = 0; i < n; i++) {
      const [x0, y0, z0, x1, y1, z1, w] = segs[i];
      const mx = (x0 + x1) / 2 - eye[0], my = (y0 + y1) / 2 - eye[1], mz = (z0 + z1) / 2 - eye[2];
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      let sx = dy * mz - dz * my, sy = dz * mx - dx * mz, sz = dx * my - dy * mx;            // убік: ⟂ відрізку й погляду
      const sl = Math.hypot(sx, sy, sz) || 1, hw = Math.max(w, Math.hypot(mx, my, mz) * 0.0015) / 2 / sl;
      sx *= hw; sy *= hw; sz *= hw;
      pos.set([x0 - sx - O[0], y0 - sy - O[1], z0 - sz, x0 + sx - O[0], y0 + sy - O[1], z0 + sz, x1 + sx - O[0], y1 + sy - O[1], z1 + sz, x1 - sx - O[0], y1 - sy - O[1], z1 - sz], i * 12);
    }
    mesh.setPositions(pos); mesh.update(pc.PRIMITIVE_TRIANGLES, true);
    mat.emissiveIntensity = 3 * k; mat.update();
    mi.visible = n > 0;
  }
  return { show, hide() { mi.visible = false; } };
}
