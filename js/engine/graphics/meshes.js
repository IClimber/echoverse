// js/engine/graphics/meshes.js — float-меш PlayCanvas з масивів (Mesh: setPositions / setNormals / setColors32 /
// setIndices, graphics/meshes): плитки далечі, фігура, шаблони тіл, стенди. Колір — u8 RGB, четвертий байт — номер
// матеріалу (варіант матеріалу ECO_MATCOL)
// G — застосунок (app.js); m — {pos: Float32Array (×3), nor: Int8Array (×3, /127), col: Uint8Array (×3), mat: Uint8Array, idx}
export function floatMesh(G, m, { dynamic = false } = {}) {
  const { pc, dev } = G, n = m.pos.length / 3;
  const nor = new Float32Array(n * 3), col = new Uint8Array(n * 4);
  for (let i = 0; i < n * 3; i++) nor[i] = m.nor[i] / 127;
  for (let i = 0; i < n; i++) { col[i * 4] = m.col[i * 3]; col[i * 4 + 1] = m.col[i * 3 + 1]; col[i * 4 + 2] = m.col[i * 3 + 2]; col[i * 4 + 3] = m.mat ? m.mat[i] : 0; }
  const M = new pc.Mesh(dev);
  M.setPositions(m.pos); M.setNormals(nor); M.setColors32(col); M.setIndices(m.idx);
  M.update(pc.PRIMITIVE_TRIANGLES, !dynamic);
  return M;
}
