// world.js — світ у грі: зерно, закони всесвітів, стовпці й секції з генератора і запити до блоків (рух, приземлення
// після стрибка, камера, F3). Стовпець (зведення: поверхня, предмети, межі секцій) — на кожні 16×16 клітинок; секція —
// 16×16×16 блоків з рамкою. Геометрію віддає рендеру через onMesh(kind: 'sec' | 'flora' | 'far', d, n, ключ, запит, дані, меш):
// ключ секції — sk, рослин — ck, плитки далечі — рядок. Груба секція (робота lod, рівень q.lod) — теж 'sec', без блоків:
// у світі не зберігається.
import { lawsOf, physOf, KMIN, KMAX, LEVEL } from './universe.js';
import { CS, ci, bv, solidB, blocks, genColumn, B_AIR, B_STONE, O_FLOAT, O_TREE, SEC } from './gen/chunk.js';
import { createGen } from './gen/client.js';
import { standableB, GRAVITY, PLAYER_MASS, PLAYER_AREA } from './player.js';
import { floatPose, SKYLIGHT, SKY_MAX, skyBright } from './gen/mesh.js';
import { footprint } from './gen/plants.js';
import { makeBody, configureBodies, settle } from './engine/physics/bodies.js';
import { createEntities } from './engine/world/entities.js';
import { createLightField } from './engine/world/skylight.js';
import { revEq } from './worldphys.js';

// тіла рушія — зі сталими гри (блок, тверде, тяжіння, еталон маси й площі — гравець)
configureBodies({ level: LEVEL, solid: solidB, gravity: GRAVITY, refMass: PLAYER_MASS, refArea: PLAYER_AREA });

// Відкритість неба над точкою (x, y, z) для опадів (мокра стіна): верх укриття ≤ 1 блок над точкою — 1, ≥ 9 — 0,
// білінійно між центрами чотирьох клітинок; topAt(x, y) — верх укриття клітинки (одиниці; немає даних — null → 1).
// Світло неба (розсіяне: фігура, тіла, вершини) — інше: skyLight (заливкою, engine/world/skylight.js)
export const skyK = (d) => d <= 1 ? 1 : d >= 9 ? 0 : 1 - (d - 1) / 8;
export function skyOpenAt(topAt, x, y, z) {
  const fx = x - 0.5, fy = y - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
  const k = (tx, ty) => { const t = topAt(tx, ty); return t === null ? 1 : skyK((t - z) / LEVEL); };
  return (k(i, j) * (1 - u) + k(i + 1, j) * u) * (1 - v) + (k(i, j + 1) * (1 - u) + k(i + 1, j + 1) * u) * v;
}

// Числові ключі: стовпець (|cx|, |cy| < 2^20 — точно, < 2^42) і секція (cz ∈ −512…511, < 2^52)
export const ck = (cx, cy) => (cx + 0x100000) * 0x200000 + (cy + 0x100000);
export const sk = (cx, cy, cz) => ck(cx, cy) * 1024 + (cz + 512);
// Рядкові ключі робіт генератора й мешів рендера
export const skey = (d, n, cx, cy, cz) => `${d}:${n}:${cx}:${cy}:${cz}`;
// Скільки тримати в пам'яті (секція ~6 КБ) — від дальності (стрімінг: setKeep(keepFor(R)))
// Світло неба між секціями (глобальне поле) — лише ближче LIGHT_R од. від цілі камери; далі — локальне світло воркера
export const LIGHT_R = 96;
export const keepFor = (R) => { const n = Math.ceil(Math.PI * (R / CS + 1) ** 2); return { cols: Math.max(1500, Math.ceil(n * 1.8)), secs: Math.max(5000, n * 6), fars: 1500 }; };

// opts.stand — стенд руху ?move (gen/stand.js): усі роботи генератора — з полігону
export function createWorld(seed, onMesh, opts = {}) {
  const Q = (q) => opts.stand ? { ...q, stand: true } : q;
  const lawsMap = new Map(), fars = new Map();
  // Всесвіти: 'd:n' → {d, n, cols: Map(ck → стовпець), secs: Map(sk → секція), at — коли був поточним}. Давність —
  // мітка used (touch* ставить нову; сортування — лише під час витіснення)
  const unis = new Map();
  // Сутності (тіла) — реєстр на всесвіт (engine/world/entities.js): власник — чанк, де тіло зараз; змінені переживають
  // вивантаження стовпця. Не витісняється: у ньому лише живі й змінені (їх мало)
  const ents = new Map();
  const entsOf = (d, n) => {
    const k = `${d}:${n}`;
    let E = ents.get(k);
    if (!E) ents.set(k, (E = createEntities({ chunk: CS, zone: 2, keyOf: ck, catchUp: (b) => { if (!b.sleep) settle(b, W.probe(d, n), (x, y) => revEq(W.laws(d, n), x, y)); } })));
    return E;
  };
  let keep = keepFor(256);
  let genMs = 0, genN = 0, objR = 0.5, nCols = 0, nSecs = 0, cur = null, lastU = null;   // objR — найбільша півширина перешкоди серед завантажених
  const colTimes = [];                       // мітки часу готових стовпців за останню секунду (F3: стовпців/с)
  // Світло неба: перебудови мешів секцій і рослин (ключі робіт у черзі — стрімінг їх не прибирає), запис секції — rid,
  // версія її вікна світла — lv; hooks — від гри (lightTick): чи тримає рендер секцію / рослини, ціль камери
  const relit = new Set();
  let rid = 0, nRelit = 0, nFloraLit = 0, hooks = null;
  function wantRelit(U, T) {
    const key = `r${U.d}:${U.n}:${T.cx}:${T.cy}:${T.cz}`, t = hooks && hooks.target;
    const pri = 300 + (t ? Math.hypot(T.cx * CS + 8 - t[0], T.cy * CS + 8 - t[1]) : 0);
    gen.want(key, Q({ type: 'relit', d: U.d, n: U.n, cx: T.cx, cy: T.cy, cz: T.cz, b: T.b, sl: T.lw, rid: T.rid, lv: T.lv }), pri);
    relit.add(key);
  }
  // Світло неба основ предметів стовпця C (рослини зблизька): Uint8Array за номером предмета чи null — усі під небом;
  // невідоме — як небо
  function objLight(U, C) {
    let ol = null;
    for (let i = 0; i < C.obj.length; i++) {
      const o = C.obj[i];
      if (o.k === O_FLOAT) continue;
      const X = C.cx * CS + o.x, Y = C.cy * CS + o.y;
      let v = U.light.get(X, Y, o.z);
      if (v === -2) v = U.light.get(X, Y, o.z + 1);
      if (v < 0 || v >= SKY_MAX) continue;
      if (!ol) ol = new Uint8Array(C.obj.length).fill(SKY_MAX);
      ol[i] = v;
    }
    return ol;
  }
  const sameOl = (a, b) => {
    if (a === b) return true;
    const n = (a || b).length;
    for (let i = 0; i < n; i++) if ((a ? a[i] : SKY_MAX) !== (b ? b[i] : SKY_MAX)) return false;
    return true;
  };
  // Рослини стовпця C — з тим світлом основ, що є зараз (C.fol — з яким замовлено; undefined — ще не замовляли)
  function wantFloraLit(U, C, pri) {
    const key = `p${U.d}:${U.n}:${C.cx}:${C.cy}`, ol = objLight(U, C);
    C.fol = ol || null;
    gen.want(key, Q({ type: 'flora', d: U.d, n: U.n, cx: C.cx, cy: C.cy, ol }), pri);
    return key;
  }
  const uni = (d, n, make) => {
    if (lastU && lastU.d === d && lastU.n === n) return lastU;
    let U = unis.get(`${d}:${n}`);
    if (!U && make) {
      U = { d, n, cols: new Map(), secs: new Map(), at: 0, lpend: new Set() };
      // світло неба всесвіту (engine/world/skylight.js): секції — записи U.secs, уже прийняті полем (lf; решта для поля —
      // незавантажені), небо незавантаженого — зі зведень стовпців. lpend — прийшли, але ще не в полі (далі LIGHT_R)
      U.light = createLightField(SKYLIGHT, { sec: (cx, cy, cz) => { const T = U.secs.get(sk(cx, cy, cz)); return T && T.lf ? T : null; }, col: (cx, cy) => U.cols.get(ck(cx, cy)) || null });
      unis.set(`${d}:${n}`, U);
    }
    if (U) lastU = U;
    return U;
  };
  // Витіснити найдавніше понад keep (до 0,9·keep): спершу всесвіти, що давно не були поточними, потім поточний.
  // Потрібне останньому перерахунку стрімінгу (торкнулось після початку попереднього, pass()) не витісняється: інакше
  // коло приземлення сусідніх всесвітів і цілі стрибка (не поточні) витіснялось щойно згенерованим — стрибок чекав
  // «Стабілізації», поки генерація й витіснення випадково не розминуться
  // Витіснити нічого (усе потрібне — острови, кілька всесвітів дають більше секцій, ніж keep) — до наступного перерахунку
  // (safe не змінився) не пробувати знову: інакше кожен новий стовпець і секція сортували всю мапу (десятки тисяч записів,
  // у польоті — десятки разів за кадр; 11.10.2026 — до 9 к/с)
  let safe = 0, passAt = 0;
  const stuck = { cols: -1, secs: -1 };
  const trim = (kind, total, keep) => {
    if (total <= keep || stuck[kind] === safe) return total;
    const order = [...unis.values()].filter((U) => U !== cur).sort((a, b) => a.at - b.at);
    if (cur) order.push(cur);
    for (const U of order) {
      const map = U[kind], old = [];
      for (const e of map) if (e[1].used <= safe) old.push(e);
      old.sort((a, b) => a[1].used - b[1].used);
      for (const [k, o] of old) {
        if (total <= keep * 0.9) break;
        o.dead = true; map.delete(k); total--;
        if (kind === 'cols') entsOf(U.d, U.n).unload(k);       // змінені тіла стовпця — у сховище сесії
        else if (o.lf) U.light.removeSection(o); else U.lpend.delete(o);
      }
      if (!U.cols.size && !U.secs.size && U !== cur) { unis.delete(`${U.d}:${U.n}`); if (lastU === U) lastU = null; }
      if (total <= keep * 0.9) break;
    }
    if (total > keep * 0.9) stuck[kind] = safe;              // усе давнє витіснено, решта потрібна
    return total;
  };
  let stamp = 0;
  const touch = (map, k) => { const o = map.get(k); if (o) o.used = ++stamp; return o; };

  // Стовпець прийшов: перешкоди-предмети за клітинкою (світові координати; розмір — o.r, o.top; tree — велика рослина:
  // за неї не чіпляєшся), тіла (ширяюче каміння)
  function addCol(c) {
    c.obst = new Array(CS * CS).fill(null);
    // предмет клітинки (прицілювання): номер у c.obj чи −1; ширяюче каміння — тіла
    c.objAt = new Int16Array(CS * CS).fill(-1);
    c.obj.forEach((o, i) => { if (o.k !== O_FLOAT) c.objAt[o.y * CS + o.x] = i; });
    for (const o of c.obj) if (o.r > 0) {
      const z0 = o.z * LEVEL;
      c.obst[o.y * CS + o.x] = { cx: c.cx * CS + o.cx, cy: c.cy * CS + o.cy, z0, z1: z0 + o.top, r: o.r, tree: o.k === O_TREE };
      if (o.r > objR) objR = o.r;
    }
    const bodies = [];
    const L = W.laws(c.d, c.n), key = ck(c.cx, c.cy);
    for (const o of c.obj) if (o.k === O_FLOAT) {
      const pose = floatPose(L, c.sp[o.s], o, o.x + 0.5, o.y + 0.5, o.z * LEVEL), fp = footprint(pose.T), st = L.stones[(o.st || 1) - 1];
      const h = Math.max(0.08, fp.r * pose.s * 0.75), hz = Math.max(0.06, fp.top * pose.s * 0.5);
      bodies.push(makeBody({
        id: key * 256 + o.y * CS + o.x,               // клітинка появи: одне тіло на клітинку, детерміновано
        x: c.cx * CS + pose.x, y: c.cy * CS + pose.y, z: pose.z, hx: h, hy: h, hz, dens: 0.8 + 0.6 * ((o.v >> 5 & 7) / 7),
        lift: st ? st.lift : 1.2, hover: pose.z - o.z * LEVEL, T: pose.T, s: pose.s, tilt: pose.tilt, yaw: (o.v >> 8 & 255) / 256 * Math.PI * 2, key,
      }));
    }
    // верх стовпця з предметами й поверхнею (у блоках): вище — повітря, навіть якщо секцію не завантажено
    c.kTop = (c.czHi + 1) * SEC;
    const U = uni(c.d, c.n, true), was = U.cols.get(key);
    if (was) { was.dead = true; U.cols.delete(key); } else nCols++;
    c.used = ++stamp;
    U.cols.set(key, c);
    // небо стовпця — сусіднім секціям за гранню (секції від найнижчого верху укриття до верху сусіда)
    let minTop = Infinity;
    for (let i = 0; i < c.top.length; i++) if (c.top[i] < minTop) minTop = c.top[i];
    U.light.addColumn(c.cx, c.cy, (nx, ny) => {
      const N = U.cols.get(ck(nx, ny));
      return N ? [Math.floor(minTop / SEC), Math.max(N.czHi, c.czHi, ...N.isl) + 1] : null;
    });
    for (const b of bodies) { b.x0 = b.x; b.y0 = b.y; b.z0 = b.z; }
    entsOf(c.d, c.n).load(key, c.cx, c.cy, bodies);
    nCols = trim('cols', nCols, keep.cols);
  }
  const gen = createGen(seed, (key, q, data, mesh, ms) => {
    genMs += ms; genN++;
    if (q.type === 'col') { colTimes.push(performance.now()); addCol(data); W.dirty = true; W.ver++; return; }
    if (q.type === 'far') {
      fars.delete(key); fars.set(key, data); onMesh('far', q.d, q.n, key, q, data, mesh);
      if (fars.size > keep.fars) for (const k of fars.keys()) { if (fars.size <= keep.fars * 0.9) break; fars.delete(k); }
      return;
    }
    if (q.type === 'flora') { relit.delete(key); onMesh('flora', q.d, q.n, ck(q.cx, q.cy), q, data, mesh); return; }
    if (q.type === 'relit') {                  // меш секції зі світлом неба: та сама секція (rid) — замінити
      relit.delete(key);
      const U = uni(q.d, q.n), k = sk(q.cx, q.cy, q.cz), T = U && U.secs.get(k);
      if (!T || T.rid !== q.rid) return;
      nRelit++;
      onMesh('sec', q.d, q.n, k, q, T, mesh);
      if (T.lv !== q.lv) wantRelit(U, T);      // поки будувався, вікно зросло ще
      return;
    }
    if (q.type === 'obj') { onMesh('obj', q.d, q.n, key, q, null, mesh); return; }
    if (q.type === 'lod') { onMesh('sec', q.d, q.n, sk(q.cx, q.cy, q.cz), q, null, mesh); return; }
    const U = uni(q.d, q.n, true), k = sk(q.cx, q.cy, q.cz), was = U.secs.get(k);
    if (was) { was.dead = true; U.secs.delete(k); if (was.lf) U.light.removeSection(was); else U.lpend.delete(was); } else nSecs++;
    data.used = ++stamp;
    data.cx = q.cx; data.cy = q.cy; data.cz = q.cz; data.rid = ++rid; data.lv = 0;
    U.secs.set(k, data);
    U.lpend.add(data);                         // у поле світла — у такті світу, ближчі до камери (lightTick)
    W.ver++;
    onMesh('sec', q.d, q.n, k, q, data, mesh);
    nSecs = trim('secs', nSecs, keep.secs);
  });

  // Стовпець і секція точки; останні знайдені пам'ятаємо (фізика питає сусідні блоки підряд)
  let lastC = null, lastS = null;
  const probes = new Map();
  const colOf = (d, n, x, y) => {
    const cx = Math.floor(x / CS), cy = Math.floor(y / CS);
    if (lastC && lastC.cx === cx && lastC.cy === cy && lastC.d === d && lastC.n === n && !lastC.dead) return lastC;
    const U = uni(d, n), C = U && U.cols.get(ck(cx, cy));
    if (C) lastC = C;
    return C;
  };
  const secOf = (d, n, cx, cy, cz) => {
    if (lastS && lastS.cz === cz && lastS.cx === cx && lastS.cy === cy && lastS.d === d && lastS.n === n && !lastS.s.dead) return lastS.s;
    const U = uni(d, n), S = U && U.secs.get(sk(cx, cy, cz));
    if (S) lastS = { d, n, cx, cy, cz, s: S };
    return S;
  };

  const W = {
    seed, gen,
    laws(d, n) {
      const k = `${d}:${n}`;
      let L = lawsMap.get(k);
      if (!L) { if (lawsMap.size > 256) lawsMap.clear(); L = lawsOf(seed, d, n); lawsMap.set(k, L); }
      return L;
    },
    col(d, n, cx, cy) { const U = uni(d, n); return U && U.cols.get(ck(cx, cy)); },
    sec(d, n, cx, cy, cz) { const U = uni(d, n); return U && U.secs.get(sk(cx, cy, cz)); },
    hasCol(d, n, cx, cy) { const U = uni(d, n); return !!U && U.cols.has(ck(cx, cy)); },
    hasSec(d, n, cx, cy, cz) { const U = uni(d, n); return !!U && U.secs.has(sk(cx, cy, cz)); },
    // Давність для витіснення (кличе стрімінг для потрібного)
    // Початок перерахунку стрімінгу: що торкнеться в ньому чи в попередньому — не витісняти
    pass() { safe = passAt; passAt = stamp; },
    touchCol(d, n, cx, cy) { const U = uni(d, n); return U && touch(U.cols, ck(cx, cy)); },
    touchSec(d, n, cx, cy, cz) { const U = uni(d, n); return U && touch(U.secs, sk(cx, cy, cz)); },
    setKeep(k) { keep = k; stuck.cols = stuck.secs = -1; },
    dirty: false,                            // прийшли зведення стовпців (стрімінг перерахує)
    // Поточний всесвіт (витісняється останнім)
    setCurrent(d, n) { cur = uni(d, n, true); cur.at = performance.now(); },
    // Вид блоку (цілі x, y, k); −1 — ще не згенеровано. Нижче світу — камінь, вище — повітря; вище за предмети й поверхню
    // стовпця (поза смугою островів) — повітря, навіть без секції
    block(d, n, x, y, k) {
      if (k < KMIN) return B_STONE;
      if (k > KMAX) return B_AIR;
      const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(k / SEC), S = secOf(d, n, cx, cy, cz);
      if (S) return S.empty ? (S.solid ? B_STONE : B_AIR) : S.b[bv(x - cx * CS, y - cy * CS, k - S.k0, S.nk)];
      const C = colOf(d, n, x, y);
      if (C && k >= C.kTop && !C.isl.includes(cz)) return B_AIR;
      return -1;
    },
    // Перешкода-предмет, що росте в клітинці (x, y): {cx, cy, z0, z1, r} або null
    obst(d, n, x, y) {
      const C = colOf(d, n, x, y);
      return C ? C.obst[(y - C.cy * CS) * CS + x - C.cx * CS] : null;
    },
    // Предмет клітинки (x, y) — рослина, камінь (прицілювання): {o, C, i, L} або null
    objAt(d, n, x, y) {
      const C = colOf(d, n, x, y);
      if (!C) return null;
      const i = C.objAt[(y - C.cy * CS) * CS + x - C.cx * CS];
      return i < 0 ? null : { o: C.obj[i], C, i, L: W.laws(d, n) };
    },
    // Повна будова предмета i стовпця (cx, cy) — для обрису цілі (onMesh('obj', …))
    wantObj(d, n, cx, cy, i) { const key = `o${d}:${n}:${cx}:${cy}:${i}`; gen.want(key, Q({ type: 'obj', d, n, cx, cy, i }), -1); return key; },
    // Верх укриття від опадів у стовпці (x, y) — одиниці; немає даних — null
    topAt(d, n, x, y) {
      const C = colOf(d, n, x, y);
      return C ? C.top[ci(x - C.cx * CS, y - C.cy * CS)] * LEVEL : null;
    },
    // Відкритість неба в точці (x, y, z) — skyOpenAt
    skyOpen(d, n, x, y, z) { return skyOpenAt((tx, ty) => W.topAt(d, n, tx, ty), x, y, z); },
    // Поверхня клітинки (для F3): {h, t, v, bm} або null
    column(d, n, x, y) {
      const C = colOf(d, n, x, y);
      if (!C) return null;
      const i = ci(x - C.cx * CS, y - C.cy * CS);
      return { h: C.h[i], t: C.t[i], v: C.v[i], bm: C.bm[i] };
    },
    // Тіла стовпців навколо (x, y) у радіусі r клітинок
    bodiesNear(d, n, x, y, r = 3) { return entsOf(d, n).near(x, y, r, []); },
    // Реєстр сутностей всесвіту (d, n)
    ents: (d, n) => entsOf(d, n),
    // «Щуп» для фізики гравця у всесвіті (d, n) — див. player.js
    // Той самий об'єкт для всесвіту (4 останні): у ньому живе кеш зіткнень (collision.js). sec — секція з блоками
    // (швидкий шлях зіткнень), ver — лічильник прийнятих стовпців і секцій (віртуальні секції з невідомим перебудовуються)
    probe(d, n) {
      const k = `${d}:${n}`;
      let P = probes.get(k);
      if (P) { probes.delete(k); probes.set(k, P); return P; }
      const L = W.laws(d, n);
      P = {
        liquid: L.liquid, laws: L, block: (x, y, k) => W.block(d, n, x, y, k), obj: (x, y) => W.obst(d, n, x, y), get objR() { return objR; },
        bodies: (x, y, r = 2) => W.bodiesNear(d, n, x, y, r), sec: (cx, cy, cz) => W.sec(d, n, cx, cy, cz), ver: () => W.ver,
        sky: (cx, cy) => { const C = colOf(d, n, cx * CS, cy * CS); return C ? C.sky : null; },   // верх ґрунту клітинок (прямі стіни під стелею)
      };
      probes.set(k, P);
      if (probes.size > 4) probes.delete(probes.keys().next().value);
      return P;
    },
    ver: 0,
    wantCol(d, n, cx, cy, pri) { const key = `c${d}:${n}:${cx}:${cy}`; gen.want(key, Q({ type: 'col', d, n, cx, cy }), pri); return key; },
    // Плитка далечі (крок s): запит (готова — far(key): zmin, zmax; меш — у рендері), ключ
    wantFar(d, n, tx, ty, s, pri) { const key = `f${d}:${n}:${tx}:${ty}:${s}`; gen.want(key, Q({ type: 'far', d, n, tx, ty, s }), pri); return key; },
    far: (key) => { const F = fars.get(key); if (F) { fars.delete(key); fars.set(key, F); } return F; },
    // Рослини зблизька стовпця (меш — у рендері); світло неба основ — з глобального
    wantFlora(d, n, cx, cy, pri) {
      const U = uni(d, n), C = U && U.cols.get(ck(cx, cy));
      if (C) return wantFloraLit(U, C, pri);
      const key = `p${d}:${n}:${cx}:${cy}`;
      gen.want(key, Q({ type: 'flora', d, n, cx, cy }), pri);
      return key;
    },
    // Світло неба (такт світу): поширення між секціями, потім перебудова секцій і рослин, чиє світло зросло. ms — бюджет;
    // h = {hasSection(d, n, k), hasFlora(d, n, k) — чи тримає рендер, target — ціль камери (пріоритет)}
    lightTick(ms, h) {
      hooks = h;
      const t0 = performance.now(), order = [...unis.values()], t = h.target;
      if (cur) { order.splice(order.indexOf(cur), 1); order.unshift(cur); }
      for (const U of order) {
        if (performance.now() - t0 > ms) break;
        // прийняти в поле секції ближче LIGHT_R від цілі камери (далі — світло воркера: різниця лише біля меж секцій)
        let i = 0;
        for (const T of U.lpend) {
          if (T.dead) { U.lpend.delete(T); continue; }
          if (t && Math.hypot(T.cx * CS + 8 - t[0], T.cy * CS + 8 - t[1]) > LIGHT_R) continue;
          U.lpend.delete(T);
          T.lf = true;
          U.light.addSection(T);
          if ((++i & 7) === 0 && performance.now() - t0 > ms) break;
        }
        const left = ms - (performance.now() - t0);
        if (left <= 0) break;
        U.light.step(left);
        if (!U.light.idle) break;
        U.light.flush(Math.max(0.1, ms - (performance.now() - t0)),
          (T) => { T.lv++; if (h.hasSection(U.d, U.n, sk(T.cx, T.cy, T.cz))) wantRelit(U, T); },
          (T) => {
            const C = U.cols.get(ck(T.cx, T.cy));
            if (!C || C.fol === undefined || !h.hasFlora(U.d, U.n, ck(C.cx, C.cy))) return;
            if (!sameOl(objLight(U, C), C.fol)) { nFloraLit++; relit.add(wantFloraLit(U, C, 300)); }
          });
      }
    },
    // Ключі перебудов у черзі генератора (стрімінг лишає їх при keepOnly)
    lightKeys(keys) { for (const k of relit) keys.add(k); },
    // Світло неба блоку (x, y, k): 0…30, −1 — невідомо, −2 — опакове
    lightAt(d, n, x, y, k) { const U = uni(d, n); return U ? U.light.get(x, y, k) : -1; },
    // Яскравість розсіяного світла неба в точці (x, y, z) для об'єктів без AO у вершинах (фігура, руки, тіла) — як вершини
    // землі поруч: світло блоків трилінійно між центрами (опакові не враховуються, невідоме — небо), та сама крива
    skyLight(d, n, x, y, z) {
      const U = uni(d, n);
      if (!U) return 1;
      const fx = x - 0.5, fy = y - 0.5, fz = z / LEVEL - 0.5, X = Math.floor(fx), Y = Math.floor(fy), K = Math.floor(fz);
      const u = fx - X, v = fy - Y, w = fz - K;
      let s = 0, ws = 0;
      for (let c = 0; c < 8; c++) {
        const ax = c & 1, ay = c >> 1 & 1, az = c >> 2, wt = (ax ? u : 1 - u) * (ay ? v : 1 - v) * (az ? w : 1 - w);
        if (wt <= 0) continue;
        let l = U.light.get(X + ax, Y + ay, K + az);
        if (l === -2) continue;
        if (l < 0) l = SKY_MAX;
        s += l * wt; ws += wt;
      }
      return ws > 0 ? skyBright(s / ws) : 1;
    },
    lightStats(d, n) { const U = uni(d, n); return { ...(U ? U.light.stats() : {}), pending: U ? U.lpend.size : 0, relit: relit.size, relitDone: nRelit, floraLit: nFloraLit }; },
    // Груба секція рівня lod (1, 2) — лише меш для рендера
    wantLod(d, n, cx, cy, cz, lod, pri) { const key = `l${lod}:${d}:${n}:${cx}:${cy}:${cz}`; gen.want(key, Q({ type: 'lod', lod, d, n, cx, cy, cz }), pri); return key; },
    wantSec(d, n, cx, cy, cz, pri) { const key = skey(d, n, cx, cy, cz); gen.want(key, Q({ type: 'sec', d, n, cx, cy, cz }), pri); return key; },
    stats: () => {
      const now = performance.now();
      while (colTimes.length && now - colTimes[0] > 1000) colTimes.shift();
      return { cols: nCols, secs: nSecs, genMs: genN ? genMs / genN : 0, pending: gen.pending, colsPerSec: colTimes.length, workers: gen.stats().workers, failed: gen.stats().failed };
    },
    stop() { gen.stop(); },
  };
  return W;
}

// Місце появи в новому світі: найближча до (0, 0) клітинка стартового всесвіту (0, 0), де на відкритій поверхні
// можна стояти і з якої можна зійти. Детерміноване (спіраль від центру), тож те саме зерно — те саме місце.
// Повертає [x, y, z] (z — ноги) або null
export function findSpawn(seed, d = 0, n = 0, maxR = 200) {
  const L = lawsOf(seed, d, n), ph = physOf(L), cols = new Map();
  const col = (x, y) => { const k = `${x},${y}`; let c = cols.get(k); if (!c) { c = genColumn(L, x, y); cols.set(k, c); } return c; };
  const surf = (c) => { for (let k = c.c.h + (c.c.fb || 0) + 1; k >= 0; k--) if (c.at(k) !== B_AIR) return k; return -1; };
  const P = {
    liquid: L.liquid,
    block: (x, y, k) => col(x, y).at(k),
    obj: (x, y) => { const c = col(x, y); if (!blocks(c.c.o)) return null; const z0 = (surf(c) + 1) * LEVEL; return { cx: x + 0.5, cy: y + 0.5, z0, z1: z0 + 2, r: 0.4 }; },
    objR: 0.5,
  };
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx += (dy === -r || dy === r || dx === r) ? 1 : 2 * r) {
      const c = col(dx, dy), k = surf(c);
      if (k < 0 || !solidB(c.at(k))) continue;
      const z = (k + 1) * LEVEL, x = dx + 0.5, y = dy + 0.5;
      if (!standableB(P, x, y, z)) continue;
      let exits = 0;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        for (let s = -16; s <= ph.up; s++) if (standableB(P, x + ax, y + ay, z + s * LEVEL)) { exits++; break; }
      }
      if (exits >= 2) return [x, y, z];
    }
  }
  return null;
}
