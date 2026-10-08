// strip.js — стенд «смуга всесвітів» (index.html?strip[&seed=…&x=…&y=…]): мінікарти однієї ділянки
// в різних всесвітах. Видно, чи сусіди схожі (спільний рельєф із варіаціями), а далекі — справді інші, а не перефарбовані.
import { lawsOf } from './universe.js';
import { tile, genChunk, digest, T_WATER, T_ICE, T_LUSH, T_DRY, T_DESERT, O_TREE, O_ROCK, O_FLOAT, O_COVER } from './gen/chunk.js';
import { regionAt, speciesOf, pickSpecies, groundTint } from './gen/flora.js';
import { GOLD, SPOTS } from './golden.js';
import { hashStr } from './rng.js';
import { fmtN } from './debug.js';

const SIZE = 96, PX = 2;                       // клітинок на бік, px на клітинку

// Мінікарта: поверхня (трава, степ, пустеля — відтінку біому), дерева — кольором листя свого виду, покрив — трохи
// відтінком виду. Повертає {cv, biomes (скільки різних), species (скільки різних)}
function minimap(L, x0, y0) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE * PX;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(SIZE * PX, SIZE * PX), P = L.pal;
  const TOP = [P.liquid, P.ice, P.sand, P.lush, P.dry, P.desert, P.snow, P.rock, P.bed];
  const hs = new Int16Array((SIZE + 1) * (SIZE + 1)), c = {}, bset = new Set(), sset = new Set();
  for (let y = -1; y < SIZE; y++) for (let x = -1; x < SIZE; x++) {
    tile(L, x0 + x, y0 + y, c);
    if (x >= 0 && y >= 0) {
      let col = c.t === T_WATER ? TOP[0].map((v, i) => v + (P.liquidDeep[i] - v) * Math.min(1, c.v / 160))
        : c.t === T_LUSH ? groundTint(L, 'lush', c.bm) : c.t === T_DRY ? groundTint(L, 'dry', c.bm) : c.t === T_DESERT ? groundTint(L, 'desert', c.bm) : TOP[c.t];
      if (c.bm) bset.add(c.bm);
      // освітлення схилів: вище за сусіда зліва-згори — світліше
      const up = hs[y * (SIZE + 1) + x], k = c.t <= T_ICE ? 1 : 1 + 0.09 * Math.max(-3, Math.min(3, c.h - up));
      if (c.o === O_TREE || c.o === O_COVER) {
        const S = speciesOf(L, regionAt(L, x0 + x, y0 + y), c.bm), list = c.o === O_TREE ? S.big : S.small;
        if (list.length) {
          const g = pickSpecies(list, c.os);
          sset.add(g.id);
          col = c.o === O_TREE ? (g.form === 'cactus' || g.form === 'crystal' || g.form === 'coral' || g.form === 'tentacle' || g.form === 'dead' ? g.leaf : g.leaf.map((v) => v * 0.8)) : col.map((v, i) => v * 0.8 + g.leaf[i] * 0.2);
        }
      } else if (c.o === O_ROCK || c.o === O_FLOAT) col = P.rock.map((v) => v * 0.8);
      for (let py = 0; py < PX; py++) for (let px = 0; px < PX; px++) {
        const i = ((y * PX + py) * SIZE * PX + x * PX + px) * 4;
        img.data[i] = col[0] * k; img.data[i + 1] = col[1] * k; img.data[i + 2] = col[2] * k; img.data[i + 3] = 255;
      }
    }
    hs[(y + 1) * (SIZE + 1) + x + 1] = c.h;
  }
  ctx.putImageData(img, 0, 0);
  return { cv, biomes: bset.size, species: sset.size };
}

export function runStrip() {
  const q = new URLSearchParams(location.search);
  const seedText = q.get('seed') || 'test', seed = hashStr(seedText);
  const x0 = (+q.get('x') || 0) - SIZE / 2, y0 = (+q.get('y') || 0) - SIZE / 2;
  document.getElementById('menu').hidden = true;
  document.getElementById('gl').hidden = true;
  Object.assign(document.body.style, { overflow: 'auto', userSelect: 'text', padding: '16px' });
  const root = document.createElement('div');
  root.innerHTML = '<h1 style="font-size:22px">Смуга всесвітів</h1>';
  const rows = [
    ['Сусіди: глибина 0, номери −8…+8', Array.from({ length: 17 }, (_, i) => [0, i - 8])],
    ['Далекі: глибина 0', [0, 10, 25, 50, 100, 200, 500, 1000, -300].map((n) => [0, n])],
    ['Глибини (номер 0)', [0, 1, 2, 3, 4, 5].map((d) => [d, 0])],
  ];
  const t0 = performance.now();
  for (const [title, list] of rows) {
    const h = document.createElement('h2'); h.textContent = title; root.append(h);
    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexWrap: 'wrap', gap: '10px' });
    for (const [d, n] of list) {
      const L = lawsOf(seed, d, n), fig = document.createElement('figure');
      Object.assign(fig.style, { margin: 0, width: SIZE * PX + 'px', fontSize: '11px', color: '#96a2bb' });
      const cap = document.createElement('figcaption');
      const mm = minimap(L, x0, y0);
      cap.textContent = `${d}:${fmtN(n)} · ${L.grav.toFixed(2)} g · ${L.liquid.name}${L.liquid.kind === 0 ? ' ' + L.liquid.tC + '°' : ''} · море ${L.seaE.toFixed(2)} · рельєф ${L.amp} · t ${L.temp.toFixed(2)} · вол ${L.wet.toFixed(2)} · біомів ${mm.biomes}, видів ${mm.species}`;
      fig.append(mm.cv, cap);
      wrap.append(fig);
    }
    root.append(wrap);
  }
  // Детермінізм між рушіями: відбитки еталонних чанків у цьому браузері
  let bad = 0;
  for (const [s, gold] of Object.entries(GOLD)) SPOTS.forEach(([d, n, cx, cy], i) => { if (digest(genChunk(lawsOf(hashStr(s), d, n), cx, cy)) !== gold[i]) bad++; });
  const det = document.createElement('p');
  det.id = 'det';
  det.style.cssText = `font-size:20px;font-weight:600;color:${bad ? '#ff6b5e' : '#7ee0c3'}`;
  det.textContent = bad ? `Детермінізм: ${bad} з 12 відбитків НЕ збігаються з еталоном` : 'Детермінізм: усі 12 відбитків збігаються з еталоном';
  root.prepend(det);
  const note = document.createElement('p');
  note.textContent = `зерно «${seedText}», центр (${x0 + SIZE / 2}, ${y0 + SIZE / 2}), ${(performance.now() - t0).toFixed(0)} мс`;
  root.append(note);
  document.body.append(root);
}
