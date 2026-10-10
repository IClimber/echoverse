// arena.js — алокатор діапазонів у спільному буфері (одиниці — вершини): first-fit по впорядкованому списку дір,
// звільнене зливається з сусідніми дірами. Без DOM і WebGL: буфер тримає gl.js.
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
