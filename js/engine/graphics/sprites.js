// js/engine/graphics/sprites.js — атлас спрайтів: масив текстур PlayCanvas (шар — спрайт size×size RGBA, sRGB — правило
// «Color textures must be sRGB»), шари за ключем з лічильником посилань. Не потрібний ніде (0 посилань) спрайт лишається,
// поки місце не знадобиться іншому (повернувся — без нового завантаження); місця немає — масив росте вдвічі (до max).
// Зміни за кадр — одним завантаженням (flush: texture.lock() масиву — шари рівня 0, unlock — у GPU, мип-мапи — PlayCanvas)
import { pc } from './app.js';

// G — застосунок; onTexture(tex) — нова текстура (після росту): гра передає її матеріалам
export function createSpriteAtlas(G, { size = 32, layers = 64, max = 255, onTexture } = {}) {
  const { dev } = G, B = size * size * 4;
  let cap = 0, tex = null, Ls = [], dirty = false;
  const byKey = new Map(), keyOf = [], refs = [], free = [];
  const idle = new Map();                              // шар без посилань → ключ (порядок — давність)
  function make(n) {
    const old = Ls;
    Ls = [];
    for (let i = 0; i < n; i++) Ls.push(i < old.length ? old[i] : new Uint8Array(B));
    const t = new pc.Texture(dev, { name: 'спрайти', width: size, height: size, arrayLength: n, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE, levels: [Ls] });
    for (let i = cap; i < n; i++) { free.push(i); refs[i] = 0; }
    cap = n;
    const prev = tex;
    tex = t;
    if (onTexture) onTexture(t);
    if (prev) prev.destroy();
  }
  make(layers);
  return {
    get texture() { return tex; },
    // Шар спрайта key (data — пікселі, якщо його ще немає); +1 посилання. −1 — місця немає
    acquire(key, data) {
      let l = byKey.get(key);
      if (l !== undefined) { if (!refs[l]++) idle.delete(l); return l; }
      if (!free.length && !idle.size && cap < max) make(Math.min(max, cap * 2));
      if (free.length) l = free.pop();
      else if (idle.size) { l = idle.keys().next().value; idle.delete(l); byKey.delete(keyOf[l]); }
      else return -1;
      byKey.set(key, l); keyOf[l] = key; refs[l] = 1;
      Ls[l].set(data); dirty = true;
      return l;
    },
    release(l) { if (l >= 0 && refs[l] > 0 && !--refs[l]) idle.set(l, true); },
    flush() {
      if (!dirty) return;
      dirty = false;
      tex.lock(); tex.unlock();                      // шари рівня 0 — ті самі масиви Ls; unlock — у GPU
    },
    stats() { return { cap, used: byKey.size, idle: idle.size }; },
  };
}
