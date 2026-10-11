// stream.js — підвантаження: що замовляти в генератора й тримати в пам'яті. Перерахунок не щокадру, а коли щось
// змінилось (інший всесвіт, ціль перейшла в інший стовпець, камера повернулась, гравець змінив секцію, заряджання,
// дальність чи режим камери, прийшли зведення стовпців) чи раз на 300 мс; між перерахунками генератор лише досилає.
// Поточний всесвіт — усе коло дальності: у піраміді видимості — раніше (пріоритет = відстань), поза нею — утричі пізніше
// (поворот камери не відкриває порожнього сектора). Коло приземлення — під ногами й у сусідніх всесвітах (стрибок без
// чекання), під час заряджання — усе видиме у всесвіті, куди стрибаємо. Далечінь (третя особа) — плитки за швом; поки
// плитки нового всесвіту немає — та сама плитка попереднього (схожий рельєф: горизонт не порожніє).
// Рівні деталізації (третя особа): секції стовпців далі LOD_R[0] — грубі (робота lod, без блоків), рівень — від відстані.
import { CS, SEC } from './gen/chunk.js';
import { LEVEL } from './iso.js';
import { FT } from './gen/far.js';
import { ck, sk } from './world.js';
import { landingChunks } from './device.js';
import { ISO, VIEW_R, FAR_R, SEAM, boxInView, LOD_ON, lodOf, colDist, FLORA_NEAR } from './camera.js';

const ZR = [-200, 2100];                 // висоти (од.) для піраміди видимості ще не згенерованого стовпця
const ZR_FAR = [-200, 2050];             // те саме для плитки далечі
const UNDER_R = 64;                      // під землею: радіус (клітинок), у якому вантажимо секції біля висоти гравця (зали)
const TURN = 0.14;                       // поворот камери (рад), після якого перерахунок

// Стовпці з центром ближче R + 12 від t: [[cx, cy, відстань]]
export function columnsInCircle(t, R) {
  const out = [], r = R + 12, c0x = Math.floor((t[0] - r) / CS), c1x = Math.floor((t[0] + r) / CS);
  const c0y = Math.floor((t[1] - r) / CS), c1y = Math.floor((t[1] + r) / CS);
  for (let cy = c0y; cy <= c1y; cy++) for (let cx = c0x; cx <= c1x; cx++) {
    const d = Math.hypot(cx * CS + CS / 2 - t[0], cy * CS + CS / 2 - t[1]);
    if (d < r) out.push([cx, cy, d]);
  }
  return out;
}
// Пріоритет стовпця (менше — раніше): у піраміді видимості чи впритул — відстань, поза нею — утричі більше
export const colPri = (dist, inF) => dist * (inF || dist < 48 ? 1 : 3);

// Скільки видимого ще бракує (заміри часу після стрибка; ?dev eco.visMissing): стовпці поточного всесвіту в колі дальності
// й у піраміді видимості (як в update) без зведення плюс їхні секції з поверхнею й островами, яких ще немає в GPU (черга
// завантаження не рахується). Рослини зблизька й плитки далечі — не рахуються
export function visibleMissing(g, camera, renderer) {
  const W = g.world, t = g.cam, m = g.view.m, iso = camera.mode === ISO, rad = iso ? g.view.rad : VIEW_R, lodOn = LOD_ON && !iso;
  let miss = 0;
  for (const [cx, cy] of columnsInCircle(t, rad)) {
    const C = W.col(g.d, g.n, cx, cy), ax = cx * CS - t[0], ay = cy * CS - t[1];
    if (!boxInView(m, ax, ay, (C ? C.czLo * SEC * LEVEL : ZR[0]) - t[2], (C ? (C.czHi + 1) * SEC * LEVEL + 40 : ZR[1]) - t[2])) continue;
    if (!C) { miss++; continue; }
    const lod = lodOn ? lodOf(colDist(cx, cy, t)) : 0, czs = [];
    for (let cz = C.czLo; cz <= C.czHi; cz++) czs.push(cz);
    for (const cz of C.isl) if (cz < C.czLo || cz > C.czHi) czs.push(cz);
    for (const cz of czs) {
      const S = W.sec(g.d, g.n, cx, cy, cz), k = sk(cx, cy, cz);
      if (lod ? (!S || !S.empty || S.solid) && !renderer.hasSection(g.d, g.n, k, lod, false)
        : !S || (!S.empty && !renderer.hasSection(g.d, g.n, k, 0, false))) miss++;
    }
  }
  return miss;
}

export function createStreamer() {
  let last = null, far = null, forced = true, vis = 0, ms = 0;
  return {
    force() { forced = true; },
    get visible() { return vis; },
    get ms() { return ms; },                // перерахунок (згладжено)
    // g — стан гри (world, me, cam, view, d, n, dev, prev); renderer — що вже в GPU. Повертає {far} — плитки далечі
    update(g, camera, renderer, now) {
      const W = g.world, me = g.me, t = g.cam, ch = g.dev.charge, iso = camera.mode === ISO;
      const czMe = Math.floor(Math.floor((me.z ?? 0) / LEVEL) / SEC), rad = iso ? g.view.rad : VIEW_R;
      const tcx = Math.floor(t[0] / CS), tcy = Math.floor(t[1] / CS), chTo = ch ? `${ch.to[0]}:${ch.to[1]}` : '';
      const L = last, lodOn = LOD_ON && !iso;
      const need = forced || !L || L.lod !== lodOn || L.d !== g.d || L.n !== g.n || L.cx !== tcx || L.cy !== tcy || L.cz !== czMe || L.ch !== chTo
        || L.rad !== rad || L.mode !== camera.mode || Math.abs(L.yaw - camera.yaw) > TURN || Math.abs(L.pitch - (iso ? camera.pitch : camera.pitch3)) > TURN
        || now - L.at > 300 || (W.dirty && now - L.at > 50);
      if (!need) { W.gen.tick(); return { far }; }
      forced = false; W.dirty = false; W.pass();
      const t0 = performance.now();
      last = { d: g.d, n: g.n, cx: tcx, cy: tcy, cz: czMe, ch: chTo, rad, mode: camera.mode, lod: lodOn, yaw: camera.yaw, pitch: iso ? camera.pitch : camera.pitch3, at: now };

      const keys = new Set(), m = g.view.m;
      const col = (d, n, cx, cy, pri) => {
        const C = W.touchCol(d, n, cx, cy);
        if (!C) keys.add(W.wantCol(d, n, cx, cy, pri));
        return C;
      };
      const sec = (d, n, cx, cy, cz, pri, lod) => {
        const k = sk(cx, cy, cz);
        if (lod) {                                             // груба: без блоків; відома порожня (усе повітря) — не треба
          const S = W.sec(d, n, cx, cy, cz);
          if ((!S || !S.empty || S.solid) && !renderer.hasSection(d, n, k, lod)) keys.add(W.wantLod(d, n, cx, cy, cz, lod, pri));
          return;
        }
        const S = W.touchSec(d, n, cx, cy, cz);               // меш могли звільнити з GPU — тоді наново
        if (!S || (!S.empty && !renderer.hasSection(d, n, k, 0))) keys.add(W.wantSec(d, n, cx, cy, cz, pri));
      };
      // секції стовпця: поверхня й острови; поруч з гравцем — ±2 секції від його висоти; під землею (великі порожнини) —
      // ще ±3 до UNDER_R клітинок; inView — лише ті, що в піраміді (для всесвіту, куди стрибаємо)
      const myC = W.col(g.d, g.n, Math.floor(me.x / CS), Math.floor(me.y / CS)), under = !!myC && czMe < myC.czLo;
      const list = [];
      const secs = (d, n, C, pri, near, inView) => {
        list.length = 0;
        const lod = near || !lodOn ? 0 : lodOf(colDist(C.cx, C.cy, t));
        const cave = under && Math.hypot(C.cx * CS + 8 - me.x, C.cy * CS + 8 - me.y) < UNDER_R;
        for (let cz = C.czLo; cz <= C.czHi; cz++) list.push(cz);
        for (const cz of C.isl) if (cz < C.czLo || cz > C.czHi) list.push(cz);
        const r = near ? 2 : cave ? 3 : -1;
        for (let cz = czMe - r; cz <= czMe + r; cz++) if (!list.includes(cz)) list.push(cz);
        const ax = C.cx * CS - t[0], ay = C.cy * CS - t[1];
        for (const cz of list) {
          const z0 = cz * SEC * LEVEL - t[2];
          if (inView && !near && !boxInView(m, ax, ay, z0, z0 + SEC * LEVEL + 12)) continue;
          sec(d, n, C.cx, C.cy, cz, pri + Math.abs(cz - czMe) * 2, lod);
        }
        // рослини зблизька — окрема робота стовпця, лише біля цілі камери (рендер малює ближче FLORA_NEAR; +16 — наперед)
        if (C.obj.length && colDist(C.cx, C.cy, t) < FLORA_NEAR + 16 && !renderer.hasFlora(d, n, ck(C.cx, C.cy))) keys.add(W.wantFlora(d, n, C.cx, C.cy, pri));
      };
      const nearMe = (cx, cy) => Math.abs(cx * CS + 8 - me.x) < 24 && Math.abs(cy * CS + 8 - me.y) < 24;

      // під ногами — першими
      const landing = landingChunks(me.x, me.y, CS);
      for (const [cx, cy] of landing) { const C = col(g.d, g.n, cx, cy, -1e6); if (C) secs(g.d, g.n, C, -1e6, true, false); }
      // поточний всесвіт — усе коло
      const circle = columnsInCircle(t, rad);
      vis = 0;
      for (const [cx, cy, dist] of circle) {
        const C0 = W.col(g.d, g.n, cx, cy), ax = cx * CS - t[0], ay = cy * CS - t[1];
        const inF = boxInView(m, ax, ay, (C0 ? C0.czLo * SEC * LEVEL : ZR[0]) - t[2], (C0 ? (C0.czHi + 1) * SEC * LEVEL + 40 : ZR[1]) - t[2]);
        if (inF) vis++;
        const p = colPri(dist, inF), C = col(g.d, g.n, cx, cy, p - 0.5);
        if (C) secs(g.d, g.n, C, p, nearMe(cx, cy), false);
      }
      // сусідні всесвіти — коло приземлення; куди заряджаємось — ще й усе видиме
      const hot = (d, n) => ch && ch.to[0] === d && ch.to[1] === n;
      const other = (d, n) => {
        const h = hot(d, n);
        for (const [cx, cy] of landing) { const C = col(d, n, cx, cy, h ? -5e5 : 50); if (C) secs(d, n, C, h ? -5e5 : 50, true, false); }
        if (h) for (const [cx, cy, dist] of circle) {
          if (!boxInView(m, cx * CS - t[0], cy * CS - t[1], ZR[0] - t[2], ZR[1] - t[2])) continue;
          const C = col(d, n, cx, cy, -2e5 + dist);
          if (C) secs(d, n, C, -2e5 + dist, false, true);
        }
      };
      for (const dir of [-1, 1]) other(g.d, g.n + dir);
      if (ch && (ch.to[0] !== g.d || Math.abs(ch.to[1] - g.n) !== 1)) other(ch.to[0], ch.to[1]);   // далекий стрибок (R)
      far = iso ? null : farTiles(g, renderer, keys, t, m, rad);
      W.gen.keepOnly(keys);
      W.gen.tick();
      ms = ms * 0.8 + (performance.now() - t0) * 0.2;
      return { far };
    },
  };
}

// Далечінь (третя особа): плитки поверхні FT×FT клітинок у радіусі FAR_R, що виходять за шов і потрапляють у піраміду
// видимості; крок — від відстані (2, 4, 8 клітинок). Поки потрібного кроку немає — показуємо інший готовий крок тієї
// самої плитки, а немає жодного — плитку всесвіту до останнього стрибка (g.prev: та сама глибина, |Δn| ≤ 1)
function farTiles(g, renderer, keys, t, m, rad) {
  const W = g.world, out = [], tx0 = Math.floor((t[0] - FAR_R) / FT), tx1 = Math.floor((t[0] + FAR_R) / FT);
  const ty0 = Math.floor((t[1] - FAR_R) / FT), ty1 = Math.floor((t[1] + FAR_R) / FT);
  const pv = g.prev && g.prev[0] === g.d && Math.abs(g.prev[1] - g.n) <= 1 ? g.prev : null;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const ax = tx * FT - t[0], ay = ty * FT - t[1], qx = Math.max(ax, Math.min(0, ax + FT)), qy = Math.max(ay, Math.min(0, ay + FT));
    const near = Math.hypot(qx, qy), far = Math.hypot(Math.max(-ax, ax + FT), Math.max(-ay, ay + FT));
    if (near > FAR_R || far < SEAM) continue;
    const s = near < 300 ? 2 : near < 700 ? 4 : 8;
    let F = null;
    const find = (d, n) => {
      for (const ss of [s, s * 2, s / 2, s * 4]) {
        if (ss < 2 || ss > 8) continue;
        const k = `f${d}:${n}:${tx}:${ty}:${ss}`;
        if (renderer.hasFar(k)) return { k, d: W.far(k) };
      }
      return null;
    };
    F = find(g.d, g.n) || (pv && find(pv[0], pv[1]));
    const z0 = F && F.d ? F.d.zmin - t[2] : ZR_FAR[0] - t[2], z1 = F && F.d ? F.d.zmax + 40 - t[2] : ZR_FAR[1] - t[2];
    if (!boxInView(m, ax, ay, z0, z1, FT)) continue;
    const key = `f${g.d}:${g.n}:${tx}:${ty}:${s}`;
    if (!renderer.hasFar(key)) keys.add(W.wantFar(g.d, g.n, tx, ty, s, 0.5 * rad + 0.5 * near));
    if (F) out.push({ key: F.k, x0: tx * FT, y0: ty * FT });
  }
  return out;
}
