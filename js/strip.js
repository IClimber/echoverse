// strip.js — стенд «смуга всесвітів» (index.html?strip[&seed=…&x=…&y=…]): мінікарти однієї ділянки
// в різних всесвітах. Видно, чи сусіди схожі (спільний рельєф із варіаціями), а далекі — справді інші, а не перефарбовані.
import { lawsOf, STRANGE_NAMES, TIER_NAMES, FAM_NAMES } from './universe.js';
import { tile, genChunk, digest, T_WATER, T_ICE, T_LUSH, T_DRY, T_DESERT, O_TREE, O_ROCK, O_FLOAT, O_COVER } from './gen/chunk.js';
import { regionAt, speciesOf, pickSpecies, groundTint } from './gen/flora.js';
import { GOLD, SPOTS, LIB_GOLD, libDigest } from './golden.js';
import { hashStr } from './rng.js';
import { fmtN } from './fmt.js';
import { skyState, bodiesOf } from './sky.js';

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

// Смужка неба всесвіту (кольори — оптика з фізики, optics.js): полудень (зеніт → обрій), захід, північ; крапки — сонця (кольором), місяці, кільця
function skyBar(L) {
  const cv = document.createElement('canvas');
  cv.width = SIZE * PX; cv.height = 14;
  const ctx = cv.getContext('2d'), w = cv.width / 3, day = L.sky.dayMin * 60, css = (c) => `rgb(${c.map((v) => v | 0).join(',')})`;
  [0.5, 0.75, 0].forEach((ph, i) => {
    const st = skyState(L, ((ph - L.sky.off + 1) % 1) * day), gr = ctx.createLinearGradient(0, 0, 0, 14);
    gr.addColorStop(0, css(st.zenith)); gr.addColorStop(1, css(st.horizon));
    ctx.fillStyle = gr; ctx.fillRect(i * w, 0, w, 14);
  });
  bodiesOf(L).suns.forEach((s, i) => { ctx.fillStyle = css(s.col); ctx.beginPath(); ctx.arc(8 + i * 10, 7, 2 + s.size * 40, 0, 7); ctx.fill(); });
  bodiesOf(L).moons.forEach((m, i) => { ctx.fillStyle = css(m.col); ctx.beginPath(); ctx.arc(2 * w + 8 + i * 10, 7, 2 + m.size * 40, 0, 7); ctx.fill(); });
  if (L.sky.rings) { ctx.strokeStyle = css(L.sky.rings.col); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(w * 1.5, 12, w * 0.4, 4, 0, Math.PI, 0); ctx.stroke(); }
  return cv;
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
      const S = L.sky, Rf = L.relief, forms = [Rf.volcano > 0.5 && 'вулкани', Rf.craters > 0.5 && 'кратери', Rf.spires > 0.3 && 'шпилі', Rf.canyons > 0.4 && 'каньйони', Rf.terrace > 0.6 && 'тераси', L.stones.some((st) => st.active && st.lift > 1) && 'ширяюче каміння', L.islandStone >= 0 && 'острови', L.mag.k > 0.6 && 'сяйва', L.anom.freq > 0.3 && 'аномалії', L.liquid.tension && 'натяг',
        L.land.cliff.share >= 0.3 && 'скелі', ...L.land.fam.map((f, i) => f.share >= 0.25 && FAM_NAMES[i]), L.land.cuesta.share >= 0.25 && 'куести',
        L.land.insel.prob >= 0.3 && 'останці', L.land.karst.share >= 0.15 && 'карст', L.land.rift.share >= 0.2 && 'рифти',
        L.land.ero.bias <= -0.35 && 'рівнини', L.land.ero.bias >= 0.35 && 'порізано'].filter(Boolean);
      const odd = Object.entries(L.tiers).filter(([, t]) => t >= 2).map(([k, t]) => `${k} (${TIER_NAMES[t]})`);
      const St = L.star, P = L.air.pressure, phen = [L.comp && (L.planet.held === 'comp' ? 'компаньйон стоїть' : 'компаньйон'), L.planet.held === 'moon' && 'місяць стоїть', L.planet.held === 'res' && 'резонанс 3:2', L.anom.rev && 'зворотна гравітація', L.tanom && 'часові аномалії'].filter(Boolean);
      cap.textContent = `${d}:${fmtN(n)} · ${STRANGE_NAMES[L.strange.cls]}${odd.length ? ': ' + odd.join(', ') : ''} · зоря ${'MKGFAB'[St.cls]} ${St.T.toFixed(0)} K${St.n > 1 ? ` (+${St.n - 1})` : ''} · ${L.grav.toFixed(L.grav < 0.1 ? 3 : 2)} g · ${(L.clim.Tpatch - 273.15).toFixed(0)} °C · ${L.air.vacuum ? 'без повітря' : `${P < 0.1 ? P.toPrecision(1) : P.toFixed(1)} атм, ${L.air.gasName.split(' ')[0]}`}${phen.length ? ' · ' + phen.join(', ') : ''} · доба ${S.lock ? 'вічна' : S.dayMin.toFixed(0) + ' хв'} · сонць ${S.suns.length}, місяців ${S.moons.length}${S.rings ? ', кільця' : ''}${L.phys.friction < 1 ? ' · ковзко' : ''}${L.phys.bounce ? ' · пружно' : ''}${L.phys.time !== 1 ? ` · час ×${L.phys.time.toFixed(1)}` : ''} · планета ${(L.planet.R * 6371).toFixed(0)} км · ${L.liquid.name}${L.liquid.kind === 0 ? ' ' + L.liquid.tC + '°' : ''} · море ${L.seaE.toFixed(2)} · рельєф ${L.amp} · t ${L.temp.toFixed(2)} · вол ${L.wet.toFixed(2)} · біомів ${mm.biomes}, видів ${mm.species}${forms.length ? ' · ' + forms.join(', ') : ''}`;
      fig.append(skyBar(L), mm.cv, cap);
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
  const lib = libDigest(), libOk = lib === LIB_GOLD;   // точна математика (stdlib) — до біта та сама, що в Node
  if (!libOk) det.style.color = '#ff6b5e';
  det.textContent = (bad ? `Детермінізм: ${bad} з 12 відбитків НЕ збігаються з еталоном` : 'Детермінізм: усі 12 відбитків збігаються з еталоном')
    + (libOk ? ' · математика (stdlib) — до біта' : ` · математика (stdlib) НЕ збігається: ${lib} замість ${LIB_GOLD}`);
  root.prepend(det);
  const note = document.createElement('p');
  note.textContent = `зерно «${seedText}», центр (${x0 + SIZE / 2}, ${y0 + SIZE / 2}), ${(performance.now() - t0).toFixed(0)} мс`;
  root.append(note);
  document.body.append(root);
}
