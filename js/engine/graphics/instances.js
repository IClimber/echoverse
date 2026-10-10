// js/engine/graphics/instances.js — група екземплярів одного меша (graphics/advanced-rendering/hardware-instancing.md):
// формат за замовчуванням (матриця 4×4 на екземпляр — VertexFormat.getDefaultInstancingFormat), динамічний буфер,
// setData щокадру; матриці — світові PlayCanvas (G.matToPC). Відсікання — цілою групою (setInstancing(vb, true)) за
// власною AABB, що охоплює всі екземпляри (setCustomAabb, як радить опис setInstancing): без неї AABB групи — меш у
// початку координат, і каскад тіні розтягував глибину до нього (для PCSS — ще й ширину пошуку блокерів)
export function createInstances(G, mesh, material, { layer = G.layers.world, castShadow = true } = {}) {
  const { pc, dev } = G, fmt = pc.VertexFormat.getDefaultInstancingFormat(dev);
  let cap = 0, vb = null, buf = null;
  const node = new pc.GraphNode('екземпляри');
  G.app.root.addChild(node);
  const mi = new pc.MeshInstance(mesh, material, node);
  mi.castShadow = castShadow; mi.visible = false;
  layer.addMeshInstances([mi]);
  // радіус меша навколо його початку (екземпляр — масштаб × радіус навколо позиції)
  const ma = mesh.aabb, r0 = ma.center.length() + ma.halfExtents.length(), bb = new pc.BoundingBox(), lo = new pc.Vec3(), hi = new pc.Vec3();
  return {
    mi,
    // matrices: Float32Array (16 на екземпляр), n — скільки
    update(matrices, n) {
      if (!n) { mi.visible = false; return; }
      if (n > cap) {
        cap = Math.max(16, cap * 2); while (cap < n) cap *= 2;
        if (vb) vb.destroy();
        vb = new pc.VertexBuffer(dev, fmt, cap, { usage: pc.BUFFER_DYNAMIC });
        buf = new Float32Array(cap * 16);
        mi.setInstancing(vb, true);
      }
      buf.set(matrices.subarray(0, n * 16));
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const o = i * 16, k = r0 * Math.sqrt(Math.max(buf[o] ** 2 + buf[o + 1] ** 2 + buf[o + 2] ** 2, buf[o + 4] ** 2 + buf[o + 5] ** 2 + buf[o + 6] ** 2, buf[o + 8] ** 2 + buf[o + 9] ** 2 + buf[o + 10] ** 2));
        const x = buf[o + 12], y = buf[o + 13], z = buf[o + 14];
        if (x - k < x0) x0 = x - k; if (y - k < y0) y0 = y - k; if (z - k < z0) z0 = z - k;
        if (x + k > x1) x1 = x + k; if (y + k > y1) y1 = y + k; if (z + k > z1) z1 = z + k;
      }
      bb.setMinMax(lo.set(x0, y0, z0), hi.set(x1, y1, z1));
      mi.setCustomAabb(bb);
      vb.setData(buf);
      mi.instancingCount = n;
      mi.visible = true;
    },
    destroy() { layer.removeMeshInstances([mi]); mi.destroy(); if (vb) vb.destroy(); node.destroy(); },
  };
}
