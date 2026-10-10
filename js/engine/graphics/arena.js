// arena.js — арена: спільний буфер вершин на GPU (VertexBuffer + Mesh PlayCanvas, graphics/advanced-rendering/multi-draw.md)
// і алокатор діапазонів у ньому (одиниці — вершини): first-fit по впорядкованому списку дір, звільнене зливається з
// сусідніми дірами. Алокатор — без DOM і GPU (тести в Node); PlayCanvas — через застосунок G (app.js), не імпортом
export function createAlloc(cap) {
  const holes = [[0, cap]];                  // [off, n], за зростанням off, без суміжних
  const A = {
    cap, used: 0,
    // Діапазон на n вершин: зсув або −1 (місця немає — grow)
    alloc(n) {
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (h[1] < n) continue;
        const off = h[0];
        if (h[1] === n) holes.splice(i, 1); else { h[0] += n; h[1] -= n; }
        A.used += n;
        return off;
      }
      return -1;
    },
    free(off, n) {
      if (n <= 0) return;
      A.used -= n;
      let lo = 0, hi = holes.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (holes[m][0] < off) lo = m + 1; else hi = m; }
      const prev = holes[lo - 1], next = holes[lo];
      const jp = prev && prev[0] + prev[1] === off, jn = next && off + n === next[0];
      if (jp && jn) { prev[1] += n + next[1]; holes.splice(lo, 1); }
      else if (jp) prev[1] += n;
      else if (jn) { next[0] = off; next[1] += n; }
      else holes.splice(lo, 0, [off, n]);
    },
    // Більша ємність: нова діра в кінці
    grow(cap2) {
      if (cap2 <= A.cap) return;
      const last = holes[holes.length - 1];
      if (last && last[0] + last[1] === A.cap) last[1] += cap2 - A.cap; else holes.push([A.cap, cap2 - A.cap]);
      A.cap = cap2;
    },
    get holes() { return holes; },
  };
  return A;
}

// Арена на GPU: один pc.Mesh на арену — усі сітки регіону посилаються на нього й малюють свої діапазони (multi-draw).
// format — pc.VertexFormat (stride = format.size), cap — вершин; stats.arenaBytes / upBytes — заміри
export function createArena(G, format, cap, stats = { arenaBytes: 0, upBytes: 0 }) {
  const { pc, dev } = G, S = format.size;
  const A = { a: createAlloc(cap), mesh: new pc.Mesh(dev), vb: null, u8: null };
  const alloc = (n) => { stats.arenaBytes += n * S; return new pc.VertexBuffer(dev, format, n, { usage: pc.BUFFER_DYNAMIC }); };
  const bind = (vb) => {
    A.vb = vb; A.u8 = new Uint8Array(vb.lock()); A.mesh.vertexBuffer = vb;
    A.mesh.primitive[0] = { type: pc.PRIMITIVE_TRIANGLES, base: 0, baseVertex: 0, count: vb.numVertices, indexed: false };
  };
  const done = (old) => { old.destroy(); stats.arenaBytes -= old.numVertices * S; };
  bind(alloc(cap));
  A.vb.unlock();
  // вершини u8 (n · S байтів) у діапазон з off: часткове unlock
  A.put = (off, u8) => { A.u8.set(u8, off * S); A.vb.unlock(off * S, u8.byteLength); stats.upBytes += u8.byteLength; };
  A.grow = (cap2) => { const old = A.vb, u8 = A.u8; bind(alloc(cap2)); A.u8.set(u8); A.vb.unlock(); done(old); A.a.grow(cap2); };
  // стиснення на місці (меш той самий — сітки не чіпаємо): живі діапазони [власник, поле, n] підряд, власникам — нові зсуви
  A.repack = (cap2, live) => {
    const old = A.vb, u8 = A.u8; bind(alloc(cap2)); A.a = createAlloc(cap2);
    for (const [o, f, n] of live) { const off = A.a.alloc(n); A.u8.set(u8.subarray(o[f] * S, (o[f] + n) * S), off * S); o[f] = off; }
    A.vb.unlock(); done(old);
  };
  A.drop = () => { stats.arenaBytes -= A.vb.numVertices * S; if (A.mesh.vertexBuffer) A.mesh.destroy(); };   // меш міг знищити останній MeshInstance
  return A;
}
