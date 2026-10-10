// js/engine/graphics/instances.js — група екземплярів одного меша (graphics/advanced-rendering/hardware-instancing.md):
// формат за замовчуванням (матриця 4×4 на екземпляр — VertexFormat.getDefaultInstancingFormat), динамічний буфер,
// setData щокадру; матриці — світові PlayCanvas (G.matToPC). Екземпляри не відсікаються пірамідою (setInstancing без
// cull): гра сама бере лише ближні
export function createInstances(G, mesh, material, { layer = G.layers.world, castShadow = true } = {}) {
  const { pc, dev } = G, fmt = pc.VertexFormat.getDefaultInstancingFormat(dev);
  let cap = 0, vb = null, buf = null;
  const node = new pc.GraphNode('екземпляри');
  G.app.root.addChild(node);
  const mi = new pc.MeshInstance(mesh, material, node);
  mi.castShadow = castShadow; mi.visible = false;
  layer.addMeshInstances([mi]);
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
        mi.setInstancing(vb);
      }
      buf.set(matrices.subarray(0, n * 16));
      vb.setData(buf);
      mi.instancingCount = n;
      mi.visible = true;
    },
    destroy() { layer.removeMeshInstances([mi]); mi.destroy(); if (vb) vb.destroy(); node.destroy(); },
  };
}
