// Відсікання закритого (12.10.2026; скарга: у печері перед стіною малювались 10,5 млн трикутників лісу за нею) —
// програмне відсікання рушія (js/engine/graphics/occluder.js) із заслонами з блоків: поверхня «глибокого» твердого
// секції (gen/vis.js: блоки, у яких усі 26 сусідів тверді, — завжди всередині плавної поверхні, що малюється) і межі
// суцільних секцій з тими, що малюються. Заслони — лише з секцій, чий меш малюється в цьому кадрі (сцена кличе add),
// ближче OCC_R: якщо меша ще немає у відеокарті, крізь діру видно — нею не можна закривати. Секції — спереду назад;
// закрита вже растеризованими — без своїх заслонів (вони там марні). Грань на межі секції, за якою в сусіда зі списку
// глибоке по всій грані (бічна маска, gen/vis.js), не растеризуємо: промінь до неї входить у глибоке сусіда крізь його
// оболонку (сусід ближчий до ока — растеризований раніше чи закритий); так само межа суцільного сусіда, якщо в цієї
// секції біля неї глибоке скрізь. Згори (орто) — без відсікання. Коробки (регіони, секції, рідина, рослини, плитки
// далечі) перевіряє box.
import { createOccluder } from './engine/graphics/occluder.js';
import { CS, SEC } from './gen/chunk.js';
import { LEVEL } from './iso.js';

const OCC_R = 32;                  // заслони — із секцій ближче (м від ока по горизонталі): з 64 у шахті й лісі відсікається
                                   // лише на 5–15 % трикутників більше, а заслони вдвічі дорожчі
const SH = SEC * LEVEL;            // висота секції, м
const DX = [-1, 1, 0, 0, 0, 0], DY = [0, 0, -1, 1, 0, 0], DZ = [0, 0, 0, 0, -1, 1];

// width — ширина буфера (клітинок): 128 у шахті відсікає втричі менше трикутників, 256 — стільки ж, скільки 192, а дорожче
export function createOcclusion(W, { width = 192 } = {}) {
  // запас заслонів усередині плавної поверхні — пів клітинки по кожній осі (gen/vis.js); найдовше ребро трикутників
  // землі — діагональ грані секції (прогин від кривизни між вершинами)
  const make = () => createOccluder({ width, margin: [0.5, 0.5, 0.5 * LEVEL], edge: CS * Math.SQRT2 });
  let R = make(), occR = OCC_R;
  const xs = new Float64Array(4), ys = new Float64Array(4), zs = new Float64Array(4), list = [], inList = new Map();
  let enabled = true, on = false, D = 0, N = 0, E = null, t0 = 0, KX = 0, KY = 0, KZ = 0, safe2 = 0;
  // ключ секції відносно секції ока (±512 по осях — ціле в межах Smi)
  const keyOf = (cx, cy, cz) => ((cx - KX + 512) << 20) | ((cy - KY + 512) << 10) | (cz - KZ + 512);
  const st = { on: false, why: '', secs: 0, skipped: 0, solid: 0, inner: 0, polys: 0, hid: 0, drawn: 0, texels: 0, safe: 0, boxes: 0, culled: 0, ms: 0 };   // ms — заслони (до end)

  // Прямокутник у площині осі ax (0 x, 1 y, 2 z) на рівні w, сторони [p0, p1] × [q0, q1] (м), нормаль — знак s:
  // заслін, якщо дивиться на око (задню грань закриває передня того самого глибокого)
  function rect(ax, s, w, p0, q0, p1, q1) {
    if (s > 0 ? E[ax] <= w : E[ax] >= w) return;
    for (let k = 0; k < 4; k++) {
      const p = k === 1 || k === 2 ? p1 : p0, q = k >= 2 ? q1 : q0;
      if (ax === 0) { xs[k] = w; ys[k] = p; zs[k] = q; } else if (ax === 1) { xs[k] = p; ys[k] = w; zs[k] = q; } else { xs[k] = p; ys[k] = q; zs[k] = w; }
    }
    R.poly(4, xs, ys, zs);
  }
  // Сусід (cx, cy, cz) + dir — у списку цього кадру, і його груба клітинка біля спільної межі глибока по всьому
  // прямокутнику [a0, a1) × [b0, b1) (грубі клітинки межі)
  function deepBehind(cx, cy, cz, dir, a0, b0, a1, b1) {
    const B = inList.get(keyOf(cx + DX[dir], cy + DY[dir], cz + DZ[dir]));
    if (!B || !B.occS) return false;
    const m = ((1 << a1) - 1) & ~((1 << a0) - 1), o = (dir ^ 1) * 8;
    for (let v = b0; v < b1; v++) if ((B.occS[o + v] & m) !== m) return false;
    return true;
  }
  // Заслони секції S (cx, cy, cz) і межі суцільних сусідів з нею
  function raster(cx, cy, cz, S) {
    const x0 = cx * CS, y0 = cy * CS, z0 = cz * SH;
    st.secs++;
    // межі, закриті сусідом, пропускаємо лише ближче безпечної відстані (там клітинку закриває центр — оболонка сусіда
    // дає те саме); далі велика грань на межі цілком покриває клітинки, яких дрібні грані сусіда не покривають
    const fx = Math.max(E[0] - x0, x0 + CS - E[0]), fy = Math.max(E[1] - y0, y0 + CS - E[1]), fz = Math.max(E[2] - z0, z0 + SH - E[2]);
    const near = fx * fx + fy * fy + fz * fz <= safe2;
    // прямокутники — за напрямом, у кожному шарі за шаром; з нормаллю вздовж осі ближчі до ока (з її боку) — вищі
    // шари, тож їх першими: закриті ближчими пропускаються (occluder.js)
    const q = S.occ;
    if (q) for (let i = 0, n = q.length; i < n;) {
      const dir = q[i], s = dir & 1 ? 1 : -1;
      let e = i;
      while (e < n && q[e] === dir) e += 6;
      for (let c = 0; c < e - i; c += 6) {
        const k = s > 0 ? e - 6 - c : i + c, pl = q[k + 1], u0 = q[k + 2], v0 = q[k + 3], u1 = q[k + 4], v1 = q[k + 5];
        if (pl === (s > 0 ? 16 : 0)) {               // на межі секції: задня — rect пропустить; закрита сусідом — пропускаємо
          const ax = dir >> 1, w = ax === 0 ? x0 + pl : ax === 1 ? y0 + pl : z0 + pl * LEVEL;
          if (near && (s > 0 ? E[ax] > w : E[ax] < w) && deepBehind(cx, cy, cz, dir, u0 >> 1, v0 >> 1, u1 >> 1, v1 >> 1)) { st.inner++; continue; }
        }
        if (dir < 2) rect(0, s, x0 + pl, y0 + u0, z0 + v0 * LEVEL, y0 + u1, z0 + v1 * LEVEL);
        else if (dir < 4) rect(1, s, y0 + pl, x0 + u0, z0 + v0 * LEVEL, x0 + u1, z0 + v1 * LEVEL);
        else rect(2, s, z0 + pl * LEVEL, x0 + u0, y0 + v0, x0 + u1, y0 + v1);
      }
      i = e;
    }
    // суцільний сусід (блоки й рамка в блок тверді — gen/chunk.js emptyOf, тож усі його блоки глибокі): його межа з
    // цією секцією, нормаль — до неї
    for (let f = 0; f < 6; f++) {
      const B = W.sec(D, N, cx + DX[f], cy + DY[f], cz + DZ[f]);
      if (!B || !B.empty || !B.solid) continue;
      if (near && S.occS) { let v = 0; while (v < 8 && S.occS[f * 8 + v] === 255) v++; if (v === 8) { st.inner++; continue; } }
      st.solid++;
      const s = f & 1 ? -1 : 1;                 // сусід з боку +x — його грань −x
      if (f < 2) rect(0, s, x0 + (f ? CS : 0), y0, z0, y0 + CS, z0 + SH);
      else if (f < 4) rect(1, s, y0 + (f === 3 ? CS : 0), x0, z0, x0 + CS, z0 + SH);
      else rect(2, s, z0 + (f === 5 ? SH : 0), x0, y0, x0 + CS, y0 + CS);
    }
  }

  const O = {
    stats: st,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    // Параметри (заміри, ?dev): width — ширина буфера (клітинок), radius — заслони із секцій ближче (м)
    get params() { return { width, radius: occR }; },
    set({ width: w, radius } = {}) { if (w && w !== width) { width = w; R = make(); } if (radius) occR = radius; },
    // Початок кадру: eye — око (світ), d, n — всесвіт, iso — згори, m — «камера × проєкція» відносно org (ціль камери),
    // curve — кривизна вершинного шейдера (світ опущено на curve·d², d — від цілі по горизонталі), aspect — ширина /
    // висота кадру. Повертає, чи відсікання діє в цьому кадрі
    begin(eye, d, n, iso, m, org, curve, aspect) {
      t0 = performance.now();
      st.secs = st.skipped = st.solid = st.inner = 0;
      list.length = 0; inList.clear();
      on = enabled && !iso;
      st.on = on; st.why = !enabled ? 'вимкнено' : iso ? 'згори' : '';
      if (!on) { R.off(); return false; }
      D = d; N = n; E = eye; KX = Math.floor(eye[0] / CS); KY = Math.floor(eye[1] / CS); KZ = Math.floor(eye[2] / SH);
      R.begin(m, org, aspect, curve > 0 ? [curve, org[0], org[1]] : null, eye);
      return true;
    },
    // Секція (cx, cy, cz), чий меш малюється в цьому кадрі (растеризація — у end)
    add(cx, cy, cz) {
      if (!on) return;
      const x0 = cx * CS, y0 = cy * CS, z0 = cz * SH;
      const hx = Math.max(x0 - E[0], 0, E[0] - x0 - CS), hy = Math.max(y0 - E[1], 0, E[1] - y0 - CS), hz = Math.max(z0 - E[2], 0, E[2] - z0 - SH);
      const d2 = hx * hx + hy * hy;
      if (d2 > occR * occR || !R.inView(x0, y0, z0, x0 + CS, y0 + CS, z0 + SH)) return;
      list.push({ cx, cy, cz, d: d2 + hz * hz });
    },
    // Кінець заслонів (перед перевірками коробок): секції ближчі першими; закрита вже растеризованими — пропустити
    end() {
      if (!on) return;
      list.sort((a, b) => a.d - b.d);
      safe2 = R.stats.safe * R.stats.safe;
      // усі секції списку буде оброблено (растеризовано чи закрито вже растеризованими)
      for (const q of list) { q.S = W.sec(D, N, q.cx, q.cy, q.cz); if (q.S) inList.set(keyOf(q.cx, q.cy, q.cz), q.S); }
      for (const q of list) {
        if (!q.S) continue;
        const x0 = q.cx * CS, y0 = q.cy * CS, z0 = q.cz * SH;
        if (R.hidden(x0, y0, z0, x0 + CS, y0 + CS, z0 + SH)) { st.skipped++; continue; }
        raster(q.cx, q.cy, q.cz, q.S);
      }
      list.length = 0; inList.clear();
      R.end();
      const r = R.stats;
      st.polys = r.polys; st.hid = r.hid; st.drawn = r.drawn; st.texels = r.texels; st.safe = r.safe; st.ms = performance.now() - t0;
    },
    // Чи може бути видно щось у коробці світу (м): у кадрі й не закрита
    box(x0, y0, z0, x1, y1, z1) { return R.box(x0, y0, z0, x1, y1, z1); },
    // Підсумок кадру (після перевірок коробок)
    finish() { if (on) { st.boxes = R.stats.boxes; st.culled = R.stats.culled; } },
    buffer: () => R.buffer(),
  };
  return O;
}
