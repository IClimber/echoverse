// js/engine/world/entities.js — облік сутностей світу: кожна належить чанку (cx, cy), де вона зараз; жива лише в зоні
// симуляції (±zone чанків від центру), поза нею спить; повернулась у зону — дорахунок за пропущений час. Змінені (dirty)
// переживають вивантаження чанка (сховище сесії); незмінені відтворюються з даних чанка (id — з даних, детерміновано).
// Як у Minecraft: сутності за чанками й дальність симуляції. Вигляд — справа рендера (PlayCanvas: однакові —
// екземплярами, окремі — Entity, сплячу вимикати: ecs/entities.md «Disable Entities when not in use»).
// Сутність — об'єкт гри з полями id, x, y, dirty, sleptAt (решта — її справа: тіло, пізніше істота); службові поля
// обліку — e.ek (ключ чанка-власника), e.awake
// chunk — розмір чанка (клітинок), zone — півширина зони (чанків), catchUp(e, dt мс) — дорахунок, keyOf(cx, cy) — ключ
export function createEntities({ chunk = 16, zone = 2, catchUp = null, keyOf = (cx, cy) => (cx + 0x8000) * 0x10000 + (cy + 0x8000) } = {}) {
  const chunks = new Map();                      // ключ → {cx, cy, ents: Set}
  const stash = new Map();                       // ключ → [змінені сутності невантаженого чанка]
  const changed = new Set();                     // id, які змінювались (зокрема видалені): з даних не відтворюються
  const removed = new Set();
  const live = new Map();                        // id → сутність завантажених чанків
  const wake = [];                               // живі в зоні (масив без виділень щокадру)
  let zx = null, zy = null, now = 0, zoneDirty = true;
  const inZone = (C) => zx !== null && Math.abs(C.cx - zx) <= zone && Math.abs(C.cy - zy) <= zone;
  // з даних чанка — у спокої (sleptAt немає — дораховувати нічого); зі сховища — sleptAt з моменту, коли заснула
  const place = (e, C, key) => { e.ek = key; C.ents.add(e); live.set(e.id, e); if (e.awake === undefined) e.awake = false; zoneDirty = true; };
  const toStash = (e, key) => { let s = stash.get(key); if (!s) stash.set(key, (s = [])); s.push(e); if (e.awake) { e.awake = false; e.sleptAt = now; } };
  const keyAt = (x, y) => { const cx = Math.floor(x / chunk), cy = Math.floor(y / chunk); return [keyOf(cx, cy), cx, cy]; };
  const detach = (e) => {
    const C = chunks.get(e.ek);
    if (C) C.ents.delete(e);
    live.delete(e.id);
    if (e.awake) zoneDirty = true;
  };
  const E = {
    // Чанк завантажено: з даних — ті, чий id не змінювався; зі сховища — змінені, що зараз тут. Повторний — нічого
    load(key, cx, cy, list = []) {
      if (chunks.has(key)) return;
      const C = { cx, cy, ents: new Set() };
      chunks.set(key, C);
      for (const e of list) if (!changed.has(e.id) && !live.has(e.id)) place(e, C, key);
      const s = stash.get(key);
      if (s) { stash.delete(key); for (const e of s) if (!removed.has(e.id)) place(e, C, key); }
    },
    // Чанк вивантажено: змінені — у сховище (за чанком, де вони є), решта — геть
    unload(key) {
      const C = chunks.get(key);
      if (!C) return;
      chunks.delete(key);
      for (const e of C.ents) {
        live.delete(e.id);
        if (e.dirty) { changed.add(e.id); toStash(e, key); } else if (e.awake) { e.awake = false; }
      }
      zoneDirty = true;
    },
    // Нова сутність (не з даних чанка): одразу змінена
    add(e) {
      e.dirty = true; changed.add(e.id);
      const [key] = keyAt(e.x, e.y), C = chunks.get(key);
      if (C) place(e, C, key); else { e.ek = key; toStash(e, key); }
    },
    // Видалена — більше не з'явиться (ні з даних, ні зі сховища)
    remove(id) {
      changed.add(id); removed.add(id);
      const e = live.get(id);
      if (e) { detach(e); e.awake = false; }
      for (const [k, s] of stash) { const i = s.findIndex((x) => x.id === id); if (i >= 0) { s.splice(i, 1); if (!s.length) stash.delete(k); } }
    },
    // Після кроку фізики: інший чанк за позицією — інший власник; невантажений — одразу в сховище
    moved(e) {
      if (e.dirty) changed.add(e.id);
      const [key] = keyAt(e.x, e.y);
      if (key === e.ek) return;
      changed.add(e.id); e.dirty = true;
      detach(e);
      const C = chunks.get(key);
      if (C) place(e, C, key); else { e.ek = key; toStash(e, key); }
    },
    // Сутності в радіусі r (квадрат чанків)
    near(x, y, r, out = []) {
      out.length = 0;
      for (let cy = Math.floor((y - r) / chunk); cy <= Math.floor((y + r) / chunk); cy++) for (let cx = Math.floor((x - r) / chunk); cx <= Math.floor((x + r) / chunk); cx++) {
        const C = chunks.get(keyOf(cx, cy));
        if (C) for (const e of C.ents) if (Math.abs(e.x - x) <= r + (e.hx || 0) && Math.abs(e.y - y) <= r + (e.hy || 0)) out.push(e);
      }
      return out;
    },
    // Зона навколо чанка (cx, cy), час t (мс): що зайшли — дорахунок за сон, що вийшли — заснули
    update(cx, cy, t) {
      now = t;
      if (cx === zx && cy === zy && !zoneDirty) return;
      zx = cx; zy = cy; zoneDirty = false;
      wake.length = 0;
      for (const C of chunks.values()) {
        const z = inZone(C);
        for (const e of C.ents) {
          if (z) {
            if (!e.awake) { e.awake = true; if (catchUp && e.sleptAt !== undefined && t > e.sleptAt) catchUp(e, t - e.sleptAt); e.sleptAt = undefined; }
            wake.push(e);
          } else if (e.awake) { e.awake = false; e.sleptAt = t; }
        }
      }
    },
    awake: () => wake,
    get: (id) => live.get(id),
    stats() { let s = 0; for (const a of stash.values()) s += a.length; return { live: live.size, awake: wake.length, stashed: s }; },
  };
  return E;
}
