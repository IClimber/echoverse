// engine/world/skylight.js — світло неба воксельного світу, як у Minecraft (Minecraft Wiki «Light»: небо — найбільше
// світло над висотною картою, униз відкритим небом без втрат; решта — заливкою (BFS) по 6 гранях з втратою на крок;
// «Smooth lighting» — вершина бере середнє світла сусідніх неопакових блоків). Заливка — як «Fast flood fill lighting»
// Seed of Andromeda / 0fps «Voxel lighting»: черга збільшення; черги — кошиками за рівнем (кожен блок обробляється
// при остаточному значенні, як у Дейкстри з малими цілими вагами).
// Без модулів гри: розмір секції, рамка, найбільше світло, втрати кроку й опакові блоки — параметрами.
//
// Значення — нижні межі справжнього світла: шлях повітрям від справжнього неба, невідоме (не завантажене) — опакове.
// Тож максимум оцінок і поширення коректні в будь-якому порядку приходу секцій, світло лише зростає, витіснення секції
// нічого не зменшує. Зменшення (копання, будування — п. 6) — дві черги (видалення й перезаливка), коли світ змінюватиметься.
//
// Вікно секції — її блоки з рамкою F з усіх боків (той самий порядок, що масив блоків секції: k — найшвидше, далі x,
// далі y; клітинка c = (y + F)·NW + x + F — як у масивах стовпця з рамкою).

export function createSkyLight({ size, frame, max, costH, costV, opaque }) {
  const S = size, F = frame, NW = S + 2 * F, NC = NW * NW, VOL = NC * NW, SS = S * S, SV = SS * S;
  const wi = (x, y, k) => ((y + F) * NW + x + F) * NW + k + F;   // вікно: x, y, k ∈ −F…S+F−1
  const li = (x, y, k) => (y * S + x) * S + k;                      // нутро: x, y, k ∈ 0…S−1
  const L2W = new Int32Array(SV);                                   // нутро → вікно
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) for (let k = 0; k < S; k++) L2W[li(x, y, k)] = wi(x, y, k);

  // Локальне світло вікна: b — блоки вікна (NW × NW × (nk + 2F)), top — верх укриття клітинок з рамкою (небо — k ≥ top,
  // блоки світу), k0 — світовий k нижнього блоку нутра, nk — висота нутра (секція — S). {lw: Uint8Array | null — null:
  // усе неопакове вікна — небо (max); under — у нутрі є неопакове нижче неба (секції потрібне сховище світла)}
  const Q = Array.from({ length: max + 1 }, () => []);
  let scratch = new Uint8Array(VOL), seed = new Uint8Array(VOL);
  function windowLight(b, top, k0, nk = S) {
    const NK = nk + 2 * F, V = NC * NK;
    if (scratch.length < V) { scratch = new Uint8Array(V); seed = new Uint8Array(V); }
    const out = scratch;
    let part = 0, under = false;
    for (let c = 0; c < NC; c++) {
      const from = top[c] - k0 + F, o = c * NK, x = c % NW - F, y = (c / NW | 0) - F, inner = x >= 0 && y >= 0 && x < S && y < S;
      for (let kw = 0; kw < NK; kw++) {
        const i = o + kw;
        if (opaque[b[i]]) out[i] = 0;
        else if (kw >= from) out[i] = max;
        else { out[i] = 0; part++; if (inner && kw >= F && kw < F + nk) under = true; }
      }
    }
    if (!part) return { lw: null, under: false };
    // засів: небо поруч з неопаковим нижче неба
    seed.fill(0, 0, V);
    const trySeed = (j) => { if (out[j] === max && !seed[j]) { seed[j] = 1; Q[max].push(j); } };
    const SY = NW * NK;
    for (let i = 0; i < V; i++) {
      if (out[i] || opaque[b[i]]) continue;
      const kw = i % NK, c = i / NK | 0, x = c % NW, y = c / NW | 0;
      if (kw > 0) trySeed(i - 1); if (kw < NK - 1) trySeed(i + 1);
      if (x > 0) trySeed(i - NK); if (x < NW - 1) trySeed(i + NK);
      if (y > 0) trySeed(i - SY); if (y < NW - 1) trySeed(i + SY);
    }
    const relax = (j, v) => { if (out[j] < v && !opaque[b[j]]) { out[j] = v; Q[v].push(j); } };
    for (let L = max; L > 0; L--) {
      const q = Q[L];
      for (let p = 0; p < q.length; p++) {
        const i = q[p];
        if (out[i] !== L) continue;
        const kw = i % NK, c = i / NK | 0, x = c % NW, y = c / NW | 0;
        let v = L - costV;
        if (v > 0) { if (kw > 0) relax(i - 1, v); if (kw < NK - 1) relax(i + 1, v); }
        v = L - costH;
        if (v > 0) {
          if (x > 0) relax(i - NK, v); if (x < NW - 1) relax(i + NK, v);
          if (y > 0) relax(i - SY, v); if (y < NW - 1) relax(i + SY, v);
        }
      }
      q.length = 0;
    }
    return { lw: out.slice(0, V), under };
  }

  return { S, F, NW, NC, VOL, SV, max, costH, costV, opaque, wi, li, L2W, windowLight };
}

// Глобальне світло всесвіту (головний потік): секції — записи світу {cx, cy, cz, b | empty | solid, lw, lu, dead};
// поле додає в них lt (нутро S³, лише де є неопакове нижче неба), dm (маска сусідів, чиє вікно зачепила зміна), lc.
// sec(cx, cy, cz) — запис чи null; col(cx, cy) — {top (клітинки з рамкою), isl (секції островів)} чи null.
// Незавантажена секція: блок вище top своєї клітинки (поза смугою островів) — небо (max), інакше невідомо
export function createLightField(SL, { sec, col }) {
  const { S, F, NW, SS, SV, max, costH, costV, opaque, wi, li, L2W } = { SS: SL.S * SL.S, ...SL };
  const R = Array.from({ length: max + 1 }, () => []), I = Array.from({ length: max + 1 }, () => []), P = new Int32Array(max + 1);
  let hi = 0, queued = 0, nStore = 0;
  const dirty = new Set();
  const st = { steps: 0, sets: 0, ms: 0 };

  const nb = (T, dx, dy, dz) => { const N = sec(T.cx + dx, T.cy + dy, T.cz + dz); return N && !N.dead ? N : null; };
  // опакове в нутрі запису (j — індекс нутра)
  const opq = (T, j) => T.empty ? !!T.solid : opaque[T.b[L2W[j]]] === 1;
  // маска сусідів за положенням блоку: біт (ox + 1)·9 + (oy + 1)·3 + (oz + 1) — сусід, чия рамка вікна містить блок
  const MASK = new Int32Array(27);
  for (let sx = -1; sx <= 1; sx++) for (let sy = -1; sy <= 1; sy++) for (let sz = -1; sz <= 1; sz++) {
    let m = 0;
    for (const ox of sx ? [0, sx] : [0]) for (const oy of sy ? [0, sy] : [0]) for (const oz of sz ? [0, sz] : [0]) {
      if (ox || oy || oz) m |= 1 << ((ox + 1) * 9 + (oy + 1) * 3 + oz + 1);
    }
    MASK[(sx + 1) * 9 + (sy + 1) * 3 + sz + 1] = m;
  }
  const side = (v) => v < F ? -1 : v >= S - F ? 1 : 0;

  function set(T, j, v) {
    T.lt[j] = v;
    R[v].push(T); I[v].push(j); queued++; st.sets++;
    if (v > hi) hi = v;
    const k = j % S, c = j / S | 0, x = c % S, y = c / S | 0;
    T.dm |= MASK[(side(x) + 1) * 9 + (side(y) + 1) * 3 + side(k) + 1];
    T.lc = true;
    dirty.add(T);
  }
  const relax = (T, j, v) => { if (T.lt[j] < v && !opq(T, j)) set(T, j, v); };

  // Світло блоку (x, y, k нутра) секції (cx, cy, cz): ≥ 0 — світло, −1 — невідомо, −2 — опакове
  function valueAt(N, cx, cy, cz, x, y, k) {
    if (N) {
      if (N.solid) return -2;
      const j = li(x, y, k);
      if (!N.empty && opaque[N.b[L2W[j]]]) return -2;
      return N.lt ? N.lt[j] : max;
    }
    const C = col(cx, cy);
    if (!C || C.isl.includes(cz)) return -1;
    return cz * S + k >= C.top[(y + F) * NW + x + F] ? max : -1;
  }
  // Світло блоку світу (X, Y, K)
  function get(X, Y, K) {
    const cx = Math.floor(X / S), cy = Math.floor(Y / S), cz = Math.floor(K / S), N = sec(cx, cy, cz);
    return valueAt(N && !N.dead ? N : null, cx, cy, cz, X - cx * S, Y - cy * S, K - cz * S);
  }

  // Грань секції T (напрямок dx, dy, dz) бере світло сусіда за гранню (завантаженого чи відомого неба)
  function pull(T, dx, dy, dz) {
    if (!T.lt) return;
    const N = nb(T, dx, dy, dz), cost = dz ? costV : costH, ncx = T.cx + dx, ncy = T.cy + dy, ncz = T.cz + dz;
    for (let a = 0; a < S; a++) for (let b = 0; b < S; b++) {
      let x, y, k;
      if (dx) { x = dx > 0 ? S - 1 : 0; y = a; k = b; } else if (dy) { y = dy > 0 ? S - 1 : 0; x = a; k = b; } else { k = dz > 0 ? S - 1 : 0; x = a; y = b; }
      const v = valueAt(N, ncx, ncy, ncz, dx ? S - 1 - x : x, dy ? S - 1 - y : y, dz ? S - 1 - k : k) - cost;
      if (v > 0) relax(T, li(x, y, k), v);
    }
  }
  const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // діапазон нутра секції, який покриває рамка вікна сусіда зі зсувом o (−1, 0, 1)
  const rng = (o) => o < 0 ? [0, F] : o > 0 ? [S - F, S] : [0, S];

  // Підказки: оцінки рамки вікна від воркера (шляхи через рамку) — у нутро завантажених сусідів і навпаки
  function hintsInto(T) {
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
      if (!(ox || oy || oz)) continue;
      const N = nb(T, ox, oy, oz);
      if (!N || !N.lw) continue;
      const [x0, x1] = rng(ox), [y0, y1] = rng(oy), [k0, k1] = rng(oz), lw = N.lw;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = k0; k < k1; k++) {
        const v = lw[wi(x - ox * S, y - oy * S, k - oz * S)];
        if (v) relax(T, li(x, y, k), v);
      }
    }
  }
  function hintsFrom(T) {
    const lw = T.lw;
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
      if (!(ox || oy || oz)) continue;
      const N = nb(T, ox, oy, oz);
      if (!N || !N.lt) continue;
      const [x0, x1] = rng(-ox), [y0, y1] = rng(-oy), [k0, k1] = rng(-oz);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = k0; k < k1; k++) {
        const v = lw[wi(x + ox * S, y + oy * S, k + oz * S)];
        if (v) relax(N, li(x, y, k), v);
      }
    }
  }

  return {
    get, stats: () => ({ queued, dirty: dirty.size, store: nStore, ...st }),
    get idle() { return !queued; },
    // Прийшла секція T (запис світу з cx, cy, cz; lw — вікно воркера чи null, lu — у нутрі є неопакове нижче неба)
    addSection(T) {
      T.dm = 0; T.lc = false; T.lt = null;
      if (T.solid) return;
      if (T.empty) {
        const C = col(T.cx, T.cy);
        if (C) {
          const lt = new Uint8Array(SV);
          let any = false;
          for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
            const from = C.top[(y + F) * NW + x + F] - T.cz * S;
            for (let k = 0; k < S; k++) { if (k >= from) lt[li(x, y, k)] = max; else any = true; }
          }
          if (any) T.lt = lt;
        }
      } else if (T.lu && T.lw) {
        const lt = new Uint8Array(SV);
        for (let j = 0; j < SV; j++) lt[j] = T.lw[L2W[j]];
        T.lt = lt;
      }
      if (T.lt) { nStore++; hintsInto(T); T.lc = true; dirty.add(T); }   // lc — рослини стовпця перевірять світло основ
      if (T.lw) hintsFrom(T);
      for (const [dx, dy, dz] of DIRS6) {
        pull(T, dx, dy, dz);
        const N = nb(T, dx, dy, dz);
        if (N) pull(N, -dx, -dy, -dz);
      }
      if (T.lw) dirty.add(T);
    },
    // Секцію витіснено (запис уже dead): сховище не рахуємо
    removeSection(T) { if (T.lt) nStore--; },
    // Прийшло зведення стовпця (cx, cy): його небо — сусідам за гранями стовпця. czs(cx, cy) — [czLo, czHi]
    // завантажених секцій стовпця
    addColumn(cx, cy, czs) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const r = czs(cx + dx, cy + dy);
        if (!r) continue;
        for (let cz = r[0]; cz <= r[1]; cz++) {
          const N = sec(cx + dx, cy + dy, cz);
          if (N && !N.dead && N.lt) pull(N, -dx, -dy, 0);
        }
      }
    },
    // Поширення (кошики від найбільшого рівня); бюджет у мс
    step(ms) {
      if (!queued) return;
      const t0 = performance.now();
      let n = 0;
      while (queued) {
        while (hi > 0 && P[hi] >= R[hi].length) { R[hi].length = 0; I[hi].length = 0; P[hi] = 0; hi--; }
        if (hi <= 0) { queued = 0; break; }
        const L = hi, p = P[L]++, T = R[L][p], j = I[L][p];
        queued--;
        if (T.dead || !T.lt || T.lt[j] !== L) continue;
        st.steps++;
        const k = j % S, c = j / S | 0, x = c % S, y = c / S | 0;
        let v = L - costV;
        if (v > 0) {
          if (k > 0) relax(T, j - 1, v); else { const N = nb(T, 0, 0, -1); if (N && N.lt) relax(N, li(x, y, S - 1), v); }
          if (k < S - 1) relax(T, j + 1, v); else { const N = nb(T, 0, 0, 1); if (N && N.lt) relax(N, li(x, y, 0), v); }
        }
        v = L - costH;
        if (v > 0) {
          if (x > 0) relax(T, j - S, v); else { const N = nb(T, -1, 0, 0); if (N && N.lt) relax(N, li(S - 1, y, k), v); }
          if (x < S - 1) relax(T, j + S, v); else { const N = nb(T, 1, 0, 0); if (N && N.lt) relax(N, li(0, y, k), v); }
          if (y > 0) relax(T, j - SS, v); else { const N = nb(T, 0, -1, 0); if (N && N.lt) relax(N, li(x, S - 1, k), v); }
          if (y < S - 1) relax(T, j + SS, v); else { const N = nb(T, 0, 1, 0); if (N && N.lt) relax(N, li(x, 0, k), v); }
        }
        if ((++n & 255) === 0 && performance.now() - t0 > ms) break;
      }
      st.ms += performance.now() - t0;
    },
    // Після поширення (черга порожня): вікна брудних секцій. onWindow(T) — вікно T зросло там, що бере меш (вершини:
    // −1…S); onLight(T) — змінилось світло в нутрі T (рослини стовпця). Бюджет у мс; що не встигло — наступного разу
    flush(ms, onWindow, onLight) {
      if (queued || !dirty.size) return;
      const t0 = performance.now(), todo = new Set();
      for (const T of dirty) {
        dirty.delete(T);
        if (T.dead) continue;
        if (T.lc) { T.lc = false; onLight(T); }
        if (T.lw) todo.add(T);
        for (let b = 0, m = T.dm; m; b++, m >>>= 1) {
          if (!(m & 1)) continue;
          const N = nb(T, (b / 9 | 0) - 1, (b / 3 | 0) % 3 - 1, b % 3 - 1);
          if (N && N.lw) todo.add(N);
        }
        T.dm = 0;
        if (performance.now() - t0 > ms) break;
      }
      for (const T of todo) if (this.window(T)) onWindow(T);
      st.ms += performance.now() - t0;
    },
    // Вікно секції T з глобального (максимум з тим, що було: невідоме лишається оцінкою воркера); true — зросло там,
    // що бере меш (вершини й рідина: −1…S по кожній осі)
    window(T) {
      const lw = T.lw, b = T.b;
      let nw = null, used = false;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const N = ox || oy || oz ? nb(T, ox, oy, oz) : T, ncx = T.cx + ox, ncy = T.cy + oy, ncz = T.cz + oz;
        const x0 = ox < 0 ? -F : ox > 0 ? S : 0, x1 = ox < 0 ? 0 : ox > 0 ? S + F : S;
        const y0 = oy < 0 ? -F : oy > 0 ? S : 0, y1 = oy < 0 ? 0 : oy > 0 ? S + F : S;
        const k0 = oz < 0 ? -F : oz > 0 ? S : 0, k1 = oz < 0 ? 0 : oz > 0 ? S + F : S;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = k0; k < k1; k++) {
          const i = wi(x, y, k);
          if (opaque[b[i]]) continue;
          const v = valueAt(N, ncx, ncy, ncz, x - ox * S, y - oy * S, k - oz * S);
          if (v > lw[i]) {
            if (!nw) nw = lw.slice();
            nw[i] = v;
            if (x >= -1 && y >= -1 && k >= -1 && x <= S && y <= S && k <= S) used = true;
          }
        }
      }
      if (nw) T.lw = nw;
      return used;
    },
  };
}
