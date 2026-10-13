// test/pixels.mjs — попіксельне порівняння кадрів двох версій гри (не в npm test): headless Chrome, однакові сцени,
// заморожений кадр (годинник стоїть, анімація фігури — за міткою, порядок малювання — канонічний, eco.canon), знімок
// полотна одразу після рендера (eco.grab). Версія A — еталон (знімки на диск), B — порівнюється з ними.
//   node test/pixels.mjs --api=webgl2|webgpu --ports=8125,8124 [--canon=0,0] [--scenes=…] [--views=8,32]
//     [--shadows=off,pcf3,pcss] [--out=ТЕКА] [--noise=файл.json] [--save-noise=файл.json]
// --save-noise — записати набір «нічийних» пікселів (A/A: та сама версія з різним порядком малювання, --canon=0,1);
// --noise — різниця, що вся в цьому наборі, — не різниця (порядок граней на однаковій глибині)
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { launch, wait, SCENES, openGame, placeScene, settled } from './cdp.mjs';

const arg = (k, d) => { const a = process.argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };

// ---- PNG: декодер (8 біт, RGB / RGBA, без черезрядкового) і кодер сірого ----
export function decodePNG(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('PNG: лише 8 біт без черезрядкового'); }
    else if (type === 'IDAT') idat.push(d);
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0;
  if (!bpp) throw new Error('PNG: тип кольору ' + ct);
  const raw = inflateSync(Buffer.concat(idat)), st = w * bpp, out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(st), cur = new Uint8Array(st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], row = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1));
    for (let i = 0; i < st; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; out[o] = cur[x * bpp]; out[o + 1] = cur[x * bpp + (bpp > 1 ? 1 : 0)]; out[o + 2] = cur[x * bpp + (bpp > 1 ? 2 : 0)]; out[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255; }
    [prev, cur] = [cur, prev];
  }
  return { w, h, data: out };
}
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; }
function chunk(type, data) { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
export function encodeGray(w, h, px) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; raw.set(px.subarray(y * w, (y + 1) * w), y * (w + 1) + 1); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const API = arg('api', 'webgl2'), PORTS = arg('ports', '8125,8124').split(',').map(Number), CANON = arg('canon', '0,0').split(',').map(Number);
const SC = arg('scenes', 'plain,night,iso,cave,forest,first,under,mount,suns3,grove,grove1,shaft,aim').split(',').filter((k) => SCENES[k]);
const VIEWS = arg('views', '8,32').split(',').map(Number), SHS = arg('shadows', 'off,pcf3,pcss').split(',');
const OUT = arg('out', `${tmpdir()}/echoverse-pixels-${API}`); mkdirSync(`${OUT}/A`, { recursive: true }); mkdirSync(`${OUT}/diff`, { recursive: true });
const NOISE = arg('noise') && existsSync(arg('noise')) ? JSON.parse(readFileSync(arg('noise'), 'utf8')) : null, SAVE = arg('save-noise');
const noiseOut = SAVE && existsSync(SAVE) ? JSON.parse(readFileSync(SAVE, 'utf8')) : {};
const P = await launch({ port: 9345, dir: `${tmpdir()}/echoverse-pixels-profile-${API}` });
const bySeed = SC.reduce((m, k) => { (m[SCENES[k].seed] ||= []).push(k); return m; }, {});
const rows = [];
for (let vi = 0; vi < 2; vi++) {
  const port = PORTS[vi];
  for (const seed in bySeed) {
    await openGame(P, port, { gpu: API, view: VIEWS[VIEWS.length - 1], seed });
    await P.ev('eco.gpuProf(false)');
    for (const name of bySeed[seed]) {
      const S = SCENES[name];
      if (!(await placeScene(P, S))) { rows.push({ name, skip: true }); console.log(name, 'місце не знайдено'); continue; }
      for (const view of VIEWS) {
        await P.ev(`eco.pin(false); eco.freeze(false); eco.setView(${view})`);
        await settled(P, 240000);
        // фаза й годинник, що стоїть, — в одному такті (між ними кадр зсунув би годинник); погода й вітер — на ньому
        await P.ev(`${S.ph === 'best' ? 'eco.bestPhase()' : `eco.setPhase(${S.ph})`}; eco.pin(true)`); await wait(1500);
        await P.ev(`eco.freeze(true, 1e6); eco.canon(${CANON[vi]})`);
        for (const sh of SHS) {
          await P.ev(`eco.shadows('${sh}')`);
          await wait(1500);                                      // шейдери, усі каскади (дальні — раз на 15 кадрів)
          const url = await P.ev('eco.grab()'), png = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
          const key = `${name}-${view}-${sh}`;
          if (vi === 0) { writeFileSync(`${OUT}/A/${key}.png`, png); continue; }
          const a = decodePNG(readFileSync(`${OUT}/A/${key}.png`)), b = decodePNG(png);
          if (a.w !== b.w || a.h !== b.h) { rows.push({ key, sizeA: [a.w, a.h], sizeB: [b.w, b.h] }); console.log(key, 'інший розмір'); continue; }
          const n = a.w * a.h, mask = new Uint8Array(n), T = NOISE && NOISE[key] ? new Set(NOISE[key]) : null, idx = [];
          let diff = 0, fresh = 0, maxd = 0;
          for (let i = 0; i < n; i++) {
            const o = i * 4, d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
            if (!d) continue;
            diff++; idx.push(i); if (d > maxd) maxd = d;
            mask[i] = Math.min(255, 64 + d * 4);
            if (!T || !T.has(i)) fresh++;
          }
          if (SAVE) noiseOut[key] = [...new Set([...(noiseOut[key] || []), ...idx])];
          if (diff) writeFileSync(`${OUT}/diff/${key}.png`, encodeGray(a.w, a.h, mask));
          rows.push({ key, diff, fresh, maxd });
          console.log(`${key.padEnd(18)} різних ${diff} (поза шумом ${fresh}), найбільша ${maxd}`);
        }
      }
      await P.ev('eco.freeze(false); eco.pin(false)');
    }
    await P.send('Page.navigate', { url: 'about:blank' }); await wait(1000);
  }
}
if (SAVE) writeFileSync(SAVE, JSON.stringify(noiseOut));
writeFileSync(`${OUT}/report.json`, JSON.stringify({ api: API, ports: PORTS, canon: CANON, rows, errs: P.errs }, null, 1));
const bad = rows.filter((r) => r.fresh || r.sizeA);
console.log(`\n${API}: кадрів ${rows.filter((r) => r.diff !== undefined).length}, з різницею поза шумом — ${bad.length}; помилок у консолі ${P.errs.length}`);
for (const e of P.errs.slice(0, 10)) console.log(e);
P.quit();
process.exit(bad.length ? 1 : 0);
