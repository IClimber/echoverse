// engine/physics/character.js — контролер персонажа проти трикутників (collide.js): форма — набір куль (капсула —
// кулі на осі), рух землею з кроком на уступ і ходою вздовж схилу, ковзання в повітрі, пошук підлоги (куля донизу +
// промінь під центром), виштовхування. Як CharacterMovement в Unreal (FindFloor, StepUp з перевіркою висоти дотику,
// хід уздовж прохідної підлоги) і CharacterController в Unity (slopeLimit, stepOffset, skinWidth).
// src — джерело трикутників: gather(x0, y0, z0, x1, y1, z1, list) і solidAt(x, y, z) (точка в твердому).
// s — стан {x, y, z} (z — низ форми, «ноги»). Без імпортів гри.
import { createList, clearList, sweepSphere, overlapSphere, nearest, rayCast } from './collide.js';

export const SKIN = 0.002;           // відступ від дотику після руху
const EPS = 1e-4;
// лобом у стіну: кут між рухом і нормаллю < 30° — стоп, без ковзання вбік; стіна — від 12° униз до 30° угору від
// вертикалі (−0,2 < nz < 0,5): скіс стелі чи краю лазу над головою (Surface Nets) не стіна — уздовж нього ковзаєш, як було
const HEAD_ON = Math.cos(Math.PI / 6), WALL_NZ = [-0.2, 0.5];

// Капсула: n куль радіуса R на осі, від ніг до висоти H
export function capsule(R, H, n = 4) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([0, 0, R + i * (H - 2 * R) / (n - 1)]);
  return { R, H, pts };
}

const LST = createList(1024), H1 = {}, H2 = {}, HM = {}, F1 = {}, OV = {}, RY = {}, NQ = {};
// Трикутники навколо форми в (x, y, z), зсунутої на (dx, dy, dz), із запасом m
function around(src, sh, x, y, z, dx, dy, dz, m) {
  clearList(LST);
  const r = sh.R + m;
  src.gather(Math.min(x, x + dx) - r, Math.min(y, y + dy) - r, Math.min(z, z + dz) - r, Math.max(x, x + dx) + r, Math.max(y, y + dy) + r, Math.max(z, z + dz) + sh.H + r, LST);
  return LST;
}

// Центр кулі всередині опуклого тіла з посиланням (ref ≠ null: тіло-коробка, призма предмета; трикутники одного ref у
// списку — підряд): точка за площинами всіх його граней. {depth — до найближчої грані, що не дивиться вниз (униз — у
// землю, на якій тіло лежить), nx, ny, nz — її нормаль, ref} або null; із кількох — найглибше
const IN = {};
function insideRef(L, px, py, pz) {
  const t = L.t;
  let best = null;
  for (let i = 0; i < L.n;) {
    const ref = L.ref[i];
    let j = i, far = -Infinity, ex = -Infinity, fi = -1;
    for (; j < L.n && L.ref[j] === ref; j++) {
      const o = j * 12, s = (px - t[o]) * t[o + 9] + (py - t[o + 1]) * t[o + 10] + (pz - t[o + 2]) * t[o + 11];
      if (s > far) far = s;
      if (t[o + 11] >= -0.5 && s > ex) { ex = s; fi = j; }
    }
    if (ref !== null && far < 0 && fi >= 0 && (!best || -ex > best.depth)) {
      best = IN; IN.depth = -ex; IN.nx = t[fi * 12 + 9]; IN.ny = t[fi * 12 + 10]; IN.nz = t[fi * 12 + 11]; IN.ref = ref;
    }
    i = j;
  }
  return best;
}

// Найглибший дотик форми з трикутниками {depth, nx, ny, nz, ref} або null. Куля, що поверхні не перетинає, але центр —
// усередині: в опуклому тілі з посиланням (тіло, предмет; накрило гравця — тіла з ним не зіштовхуються) — depth = до
// найближчої грані + R уздовж її нормалі; у твердому (блоки) — за найближчим трикутником (промінь до нього влучає в
// тильний бік), depth = відстань + R уздовж нормалі того трикутника; трикутника ближче 0,6 нема — «глибоко всередині»,
// depth = Infinity
export function overlap(src, sh, x, y, z) {
  const L = around(src, sh, x, y, z, 0, 0, 0, 0.7);
  let best = null;
  for (const [ox, oy, oz] of sh.pts) {
    const cx = x + ox, cy = y + oy, cz = z + oz;
    const o = overlapSphere(L, cx, cy, cz, sh.R, OV);
    if (o && (!best || o.depth > best.depth)) best = { depth: o.depth, nx: o.nx, ny: o.ny, nz: o.nz, ref: o.ref };
    if (o) continue;
    const w = insideRef(L, cx, cy, cz);
    if (w) { if (!best || w.depth + sh.R > best.depth) best = { depth: w.depth + sh.R, nx: w.nx, ny: w.ny, nz: w.nz, ref: w.ref }; continue; }
    if (!src.solidAt(cx, cy, cz)) continue;
    const q = nearest(L, cx, cy, cz, NQ);
    if (!q || q.d > 0.6) return { depth: Infinity, nx: 0, ny: 0, nz: 1, ref: null };
    const dx = (q.x - cx) * 1.05, dy = (q.y - cy) * 1.05, dz = (q.z - cz) * 1.05, r = rayCast(L, cx, cy, cz, dx, dy, dz, 1, RY);
    if (r && r.nx * dx + r.ny * dy + r.nz * dz > 0 && (!best || q.d + sh.R > best.depth)) best = { depth: q.d + sh.R, nx: r.nx, ny: r.ny, nz: r.nz, ref: r.ref };
  }
  return best;
}

// Рух форми на (dx, dy, dz): перший дотик {t, nx, ny, nz, px, py, pz, ref} (t — частка руху) або null
export function sweep(src, sh, x, y, z, dx, dy, dz, out = H1) {
  const L = around(src, sh, x, y, z, dx, dy, dz, 0.05);
  let best = null;
  for (const [ox, oy, oz] of sh.pts) {
    const h = sweepSphere(L, x + ox, y + oy, z + oz, dx, dy, dz, sh.R, H2);
    if (h && (!best || h.t < best.t)) { best = out; Object.assign(out, h); }
  }
  return best;
}

// Підлога під формою не нижче z − down: {z, nx, ny, nz, px, py, pz, ref, zU, nU}; null — немає. На рівній підлозі z —
// точно висота площини. zU — поверхня під центром (промінь до 0,25 нижче ніг) чи null, nU — її нормаль, якщо вона не
// нижча за ноги на 0,12 (інакше під центром уже інша поверхня — край уступу)
export function findFloor(src, sh, x, y, z, down) {
  // уся форма: верхні кулі біля стрімкого схилу теж можуть у нього впертися
  const L = around(src, sh, x, y, z, 0, 0, -down - 0.35, 0.05);
  let h = null;
  for (const [ox, oy, oz] of sh.pts) {
    const q = sweepSphere(L, x + ox, y + oy, z + oz, 0, 0, -down, sh.R, H2);
    if (q && (!h || q.t < h.t)) h = Object.assign(F1, q);
  }
  if (!h) return null;
  const f = { nx: h.nx, ny: h.ny, nz: h.nz, px: h.px, py: h.py, pz: h.pz, ref: h.ref, nU: null, zU: null };
  // рівна (вертикальний дотик і горизонтальний сам трикутник) — точно висота площини; лише дотик вертикальний (вершина
  // чи гребінь похилих трикутників точно під центром) — ні: висота вершини «a» там інша
  f.z = h.nz > 1 - 1e-9 && L.t[h.i * 12 + 11] > 1 - 1e-9 ? L.t[h.i * 12 + 2] : Math.min(z, z - h.t * down + (h.t > 0 ? SKIN : 0));
  if (f.z > z) f.z = z;
  const r = rayCast(L, x, y, f.z + 0.1, 0, 0, -0.35, 1, RY);
  if (r && r.nz > 0) {
    f.zU = f.z + 0.1 - r.t * 0.35;
    if (f.zU >= f.z - 0.12) f.nU = [r.nx, r.ny, r.nz];
  }
  return f;
}
// Нормаль підлоги для ходи: під центром, якщо промінь близько, інакше — дотику
export const floorNormal = (f) => f.nU || [f.nx, f.ny, f.nz];
// Підлога стійка (кут ≤ межі standZ): дотик чи під центром
export const stands = (f, standZ) => !!f && (f.nz >= standZ || (!!f.nU && f.nU[2] >= standZ));
const walks = (f, walkZ) => !!f && (f.nz >= walkZ || (!!f.nU && f.nU[2] >= walkZ));

// Ковзання в повітрі на (dx, dy, dz), до 4 відбиттів. Повертає дотики: floor (дотик з n_z ≥ standZ), ceil, walls
// ([[nx, ny], …] горизонтальні нормалі). walkZ (падіння, не політ): ковзання вздовж непрохідної поверхні (n_z < walkZ)
// не піднімає вище, ніж ішов сам рух, — як HandleSlopeBoosting в Unreal (CharacterMovementComponent: «don't move any
// higher than we originally intended») і «remove the vertical tangent motion induced by the forward motion» у Rapier:
// інакше стрибок із розбігу в крутий схил підкидав на третину вище за стрибок.
// Площини дотиків одного виклику пам'ятаються (J. Linahan, «Improving the Numerical Robustness of Sphere Swept Collision
// Detection», 2012; TwoWallAdjust в Unreal): друга, ковзання вздовж якої веде назад у першу, — рух лише вздовж їхньої складки
// (n1 × n2); третя — стоп. І залишок проти початкового напрямку — стоп (Quake, PM_SlideMove: «stop dead to avoid tiny
// occilations in sloping corners»). Інакше в куті форма щокроку перескакувала між площинами (тремтіння)
export function moveAir(src, sh, s, dx, dy, dz, standZ, walkZ = null) {
  const res = { floor: null, ceil: false, walls: [] };
  const ox = dx, oy = dy, oz = dz;
  let p1 = null, np = 0;
  for (let it = 0; it < 4; it++) {
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-9) break;
    const h = sweep(src, sh, s.x, s.y, s.z, dx, dy, dz);
    if (!h) { s.x += dx; s.y += dy; s.z += dz; break; }
    const adv = Math.max(0, h.t - SKIN / len);
    s.x += dx * adv; s.y += dy * adv; s.z += dz * adv;
    dx *= 1 - adv; dy *= 1 - adv; dz *= 1 - adv;
    if (h.nz >= standZ) res.floor = { ...h };
    else if (h.nz < -0.3) res.ceil = true;
    else { const l = Math.hypot(h.nx, h.ny); if (l > 1e-6) res.walls.push([h.nx / l, h.ny / l]); }
    const dn = dx * h.nx + dy * h.ny + dz * h.nz;
    if (dn < 0) {
      const z0 = dz;
      dx -= dn * h.nx; dy -= dn * h.ny; dz -= dn * h.nz;
      if (p1 && dx * p1[0] + dy * p1[1] + dz * p1[2] < -1e-12) {
        // назад у попередню площину — уздовж складки; третя площина чи складка вгору понад рух (падіння) — стоп
        let cx = p1[1] * h.nz - p1[2] * h.ny, cy = p1[2] * h.nx - p1[0] * h.nz, cz = p1[0] * h.ny - p1[1] * h.nx;
        const cl = Math.hypot(cx, cy, cz);
        if (np >= 2 || cl < 1e-9) { dx = dy = dz = 0; break; }
        cx /= cl; cy /= cl; cz /= cl;
        const along = dx * cx + dy * cy + dz * cz;
        dx = along * cx; dy = along * cy; dz = along * cz;
        if (walkZ !== null && dz > Math.max(0, z0) + 1e-9) { dx = dy = dz = 0; break; }
        np++;
        continue;
      }
      p1 = [h.nx, h.ny, h.nz]; np = 1;
      if (walkZ !== null && h.nz < walkZ && dz > Math.max(0, z0) + 1e-9) {
        // угору — не більше, ніж ішов рух: увесь вектор пропорційно (інакше знову в поверхню), решта — по горизонталі
        // вздовж горизонтальної нормалі
        const k = z0 > 0 ? z0 / dz : 0, rx = dx * (1 - k), ry = dy * (1 - k), l = Math.hypot(h.nx, h.ny);
        dx *= k; dy *= k; dz *= k;
        if (l > 1e-6) { const nx = h.nx / l, ny = h.ny / l, d = rx * nx + ry * ny; dx += rx - Math.min(0, d) * nx; dy += ry - Math.min(0, d) * ny; }
      }
    }
    if (dx * ox + dy * oy + dz * oz <= 0) break;                            // проти початкового напрямку — стоп
  }
  return res;
}

// Хода землею на (dx, dy). o = {step — висота кроку на уступ, walkZ — межа схилу, на який заходиш (cos), standZ — на якому
// стоїш, floorN — нормаль підлоги ([x, y, z]) чи null}. Лобом у стіну (WALL_NZ; кут між рухом і нормаллю < 30°:
// у стовбур — ближче половини суми радіусів від осі) — стоп, без ковзання вбік (12.10.2026, рішення користувача: «коли я
// йду в дерево і впираюсь в дерево, то не треба мене зміщувати в бік»; було — ковзання з частиною швидкості й обхід
// круглої перешкоди дотичною); навскіс — уздовж поверхні, як було. Повертає {walls, stepped (на скільки піднявся
// кроком), ex, ey (зсув кроком понад рух — для вигляду), head — уперся лобом}
export function moveH(src, sh, s, dx, dy, o) {
  const res = { walls: [], stepped: 0, ex: 0, ey: 0, head: false };
  const x0 = s.x, y0 = s.y, want = Math.hypot(dx, dy);
  let last = null;
  let fn = o.floorN && o.floorN[2] >= o.walkZ ? o.floorN : null;
  let rx = dx, ry = dy;
  for (let it = 0; it < 4 && Math.hypot(rx, ry) > 1e-9; it++) {
    const dz = fn ? -(fn[0] * rx + fn[1] * ry) / fn[2] : 0;
    // свій об'єкт результату: stepUp пише в H1, а після невдалого кроку ковзання — за цим дотиком, не за пробою кроку
    const len = Math.hypot(rx, ry, dz), h = sweep(src, sh, s.x, s.y, s.z, rx, ry, dz, HM);
    if (!h) { s.x += rx; s.y += ry; s.z += dz; rx = ry = 0; break; }
    const adv = Math.max(0, h.t - SKIN / len);
    s.x += rx * adv; s.y += ry * adv; s.z += dz * adv;
    rx *= 1 - adv; ry *= 1 - adv;
    if (h.nz >= o.walkZ) { fn = [h.nx, h.ny, h.nz]; continue; }             // інший схил, теж прохідний — уздовж нього
    const st = o.step > 0 && h.pz <= s.z + o.step + EPS ? stepUp(src, sh, s, rx, ry, o) : null;
    if (st) { res.stepped = st.up; res.ex = st.ex; res.ey = st.ey; rx = ry = 0; break; }
    const l = Math.hypot(h.nx, h.ny);
    if (l < 1e-6) { fn = null; continue; }                                  // стеля над схилом — далі по горизонталі
    const nx = h.nx / l, ny = h.ny / l, d = rx * nx + ry * ny;
    res.walls.push([nx, ny]);
    if (h.nz > WALL_NZ[0] && h.nz < WALL_NZ[1] && -(dx * nx + dy * ny) > HEAD_ON * want) { res.head = true; rx = ry = 0; break; }
    const prev = last;
    last = { nx, ny, ref: h.ref };
    if (d < 0) { rx -= d * nx; ry -= d * ny; } else fn = null;
    // друга стіна, ковзання вздовж якої веде назад у першу, — кут: складка двох стін вертикальна, по горизонталі — стоп
    // (Linahan 2012, TwoWallAdjust в Unreal; без цього в тупому куті форма щокроку перескакувала між стінами)
    if (prev && rx * prev.nx + ry * prev.ny < -1e-12) { rx = ry = 0; break; }
    if (rx * dx + ry * dy <= 0) { rx = ry = 0; break; }                     // проти початкового напрямку — стоп (Quake)
  }
  // уперся навскіс і майже не зрушив (кут, зубець) — запасний хід по осях, як у блоковому світі (у кут — ні); лобом — ні
  if (want > 1e-9 && Math.hypot(s.x - x0, s.y - y0) < want * 0.05 && !res.stepped && !res.head) {
    for (const [ax, ay] of [[dx, 0], [0, dy]]) {
      if (!ax && !ay) continue;
      const h = sweep(src, sh, s.x, s.y, s.z, ax, ay, 0);
      const len = Math.hypot(ax, ay), adv = h ? Math.max(0, h.t - SKIN / len) : 1;
      if (adv * len > want * 0.05) { s.x += ax * adv; s.y += ay * adv; break; }
    }
  }
  return res;
}

// Крок на уступ: угору на step, уперед, донизу. Уперед — на залишок руху, а не вийшло — на R/2 і R (куля, що впирається
// в стіну, інакше обминає скошений край уступу: за такт гравець проходить соті частки). Приймається, якщо підлога
// стійка, вища за z і не вища за z + step, і прохідна — вона сама чи на відстані R уперед (крутий край у пів блоку
// переступаєш, довгий крутий схил — ні). Повертає {up — підйом, ex, ey — зсув понад залишок (для вигляду)} або null
function stepUp(src, sh, s, rx, ry, o) {
  const z0 = s.z, hu = sweep(src, sh, s.x, s.y, s.z, 0, 0, o.step, H1);
  const up = hu ? Math.max(0, hu.t * o.step - SKIN) : o.step;
  if (up < 0.02) return null;
  const len = Math.hypot(rx, ry), ux = rx / len, uy = ry / len;
  for (const fw of [len, sh.R / 2, sh.R]) {
    if (fw < len - 1e-12) continue;
    const hf = sweep(src, sh, s.x, s.y, z0 + up, ux * fw, uy * fw, 0, H1);
    const adv = hf ? Math.max(0, hf.t * fw - SKIN) : fw;
    if (adv < 1e-5) return null;
    const x2 = s.x + ux * adv, y2 = s.y + uy * adv;
    const f = findFloor(src, sh, x2, y2, z0 + up, up + 0.05);
    if (!f || !stands(f, o.standZ) || f.z > z0 + o.step + EPS || f.z < z0 + 0.01) continue;
    let ok = walks(f, o.walkZ);
    if (!ok) {                                                           // прохідна підлога трохи далі?
      const h3 = sweep(src, sh, x2, y2, z0 + up, ux * sh.R, uy * sh.R, 0, H1);
      if (!h3) {
        const f3 = findFloor(src, sh, x2 + ux * sh.R, y2 + uy * sh.R, z0 + up, up + 0.05);
        ok = !!f3 && walks(f3, o.walkZ) && f3.z <= z0 + o.step + EPS;
      }
    }
    if (!ok) continue;
    const extra = Math.max(0, adv - len);
    s.x = x2; s.y = y2; s.z = f.z;
    return { up: f.z - z0, ex: ux * extra, ey: uy * extra };
  }
  return null;
}

// Виштовхнути форму з поверхні: уздовж найглибшого дотику (до 8 разів); не вийшло — найближче вільне до 1 (угору, униз,
// убік). Глибоко в твердому (трикутників поруч немає: телепорт, секцію догенеровано) — угору до maxUp, до першого вільного місця (інакше форма
// провалювалась би крізь товщу, де нема об чого спертися). true — вільно
export function depenetrate(src, sh, s, maxUp = 64) {
  let deep = false;
  for (let i = 0; i < 8; i++) {
    const o = overlap(src, sh, s.x, s.y, s.z);
    if (!o) return true;
    if (o.depth === Infinity) { deep = true; break; }
    const k = o.depth + SKIN;
    s.x += o.nx * k; s.y += o.ny * k; s.z += o.nz * k;
  }
  if (!overlap(src, sh, s.x, s.y, s.z)) return true;
  if (deep) { for (let dz = 0.5; dz <= maxUp + 1e-9; dz += 0.5) if (!overlap(src, sh, s.x, s.y, s.z + dz)) { s.z += dz; return true; } return false; }
  // затисло (стеля й підлога, тіло): найближче вільне місце — угору, униз, убік до 1
  for (let d = 0.05; d <= 1 + 1e-9; d += 0.05) {
    for (const [ax, ay, az] of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
      if (!overlap(src, sh, s.x + ax * d, s.y + ay * d, s.z + az * d)) { s.x += ax * d; s.y += ay * d; s.z += az * d; return true; }
    }
  }
  return false;
}
