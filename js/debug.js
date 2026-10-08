// debug.js — панель F3: зерно, адреса, клітинка, чанк і його відбиток, закони всесвіту, швидкодія.
import { CS, TYPE_NAMES, BLOCK_NAMES, digest } from './gen/chunk.js';
import { physOf } from './universe.js';
import { BIOMES } from './gen/biomes.js';
import { regionAt, speciesOf, FORMS } from './gen/flora.js';
import { jumpHeight } from './player.js';
import { dayPhase, clockStr } from './sky.js';
import { weatherAt, WEATHER_NAMES } from './weather.js';
import { LEVEL } from './iso.js';

// Види області під ногами в цьому біомі: «область 3fa2c1: хвойне, кущ, трава»
function speciesLine(L, x, y, bm) {
  const reg = regionAt(L, x, y), S = speciesOf(L, reg, bm);
  return `область ${(reg.id >>> 0).toString(16).padStart(8, '0').slice(0, 6)}: ${[...S.big, ...S.small].map((g) => FORMS[g.form].name).join(', ') || 'немає'}`;
}

export const fmtN = (n) => n > 0 ? '+' + n : n < 0 ? '−' + -n : '0';

export function debugText(g, perf, meshCount, cam) {
  const { world, rec, me } = g, L = world.laws(g.d, g.n);
  const tx = Math.floor(me.x), ty = Math.floor(me.y), c = world.column(g.d, g.n, tx, ty);
  const kf = Math.floor((me.z ?? 0) / LEVEL + 1e-4), under = world.block(g.d, g.n, tx, ty, kf - 1);
  const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS), C = world.chunk(g.d, g.n, cx, cy), st = world.stats(), ph = physOf(L);
  return [
    `зерно      «${rec.seedText}» (${rec.seed})  генератор v${rec.gen}`,
    `адреса     глибина ${g.d}, всесвіт ${fmtN(g.n)}`,
    `позиція    ${me.x.toFixed(2)}, ${me.y.toFixed(2)}  z ${me.z.toFixed(2)}${me.air ? '  у повітрі' : ''}`,
    `гравітація ${L.grav.toFixed(2)} g: стрибок ${(jumpHeight(L.grav) / LEVEL).toFixed(1)} рівня, крок угору ${ph.up}, хода ×${ph.speed.toFixed(2)}`,
    `клітинка   ${c ? `поверхня ${c.h}, ${TYPE_NAMES[c.t]}; під ногами — ${under >= 0 ? BLOCK_NAMES[under] : '—'} (блок ${kf - 1})${me.ground ? '' : me.swim ? ', пливе' : ', у повітрі'}` : '—'}`,
    `чанк       ${cx}, ${cy}  відбиток ${C ? digest(C) : '—'}`,
    `закони     море ${L.seaE.toFixed(2)}, рельєф ${L.amp}, t ${L.temp.toFixed(2)}, вологість ${L.wet.toFixed(2)}`,
    `рідина     ${L.liquid.name}, ${L.liquid.tC} °C, густина ${L.liquid.density}${L.liquid.swim ? ', можна плавати' : L.liquid.why ? ' — ' + L.liquid.why : ''}${me.swim ? '  (пливе)' : ''}`,
    `біом       ${c ? BIOMES[c.bm].name : '—'}  (у всесвіті: ${L.biomes.flat().map(([id]) => BIOMES[id].name).filter((v, i, a) => a.indexOf(v) === i).length} біомів)`,
    `види       ${c && c.bm ? speciesLine(L, tx, ty, c.bm) : '—'}`,
    `рослини    густота ${(L.flora * 100).toFixed(1)} %, розмір ×${L.treeH.toFixed(2)}, каміння ${(L.rocks * 100).toFixed(1)} %`,
    `фізика     тертя ${L.phys.friction.toFixed(2)}${L.phys.friction < 1 ? ' (ковзко)' : ''}, пружність ${L.phys.bounce.toFixed(2)}, падіння до ${ph.vT.toFixed(1)} од/с, плин часу ×${L.phys.time.toFixed(2)}, радіус планети ${L.phys.planetR.toFixed(0)}`,
    `небо       доба ${L.sky.lock ? 'вічна (припливне захоплення)' : (L.sky.dayMin / L.phys.time).toFixed(1) + ' хв'}, ${clockStr(dayPhase(L, g.clock || 0))}, сонць ${L.sky.suns.length}, місяців ${L.sky.moons.length}${L.sky.rings ? ', кільця' : ''}, широта ${(L.sky.lat * 69).toFixed(0)}°`,
    `повітря    тиск ${L.air.pressure.toFixed(2)} атм, ${L.air.gasName}, радіація ${(L.air.rad * 100).toFixed(0)} %, серпанок ${(L.air.haze * 100).toFixed(0)} %, вітер ${(L.air.wind * 100).toFixed(0)} %`,
    `погода     ${WEATHER_NAMES[weatherAt(L, g.clock || 0).kind]} (зміна раз на ${L.air.segMin.toFixed(1)} хв; ${Object.entries(L.air.w).filter(([, v]) => v > 0.05).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ')})`,
    `камера     ${cam.mode === 'iso' ? `згори, масштаб ${cam.zoom.toFixed(2)}` : `третя особа, відстань ${cam.dist.toFixed(1)}`}, азимут ${Math.round(cam.yaw * 180 / Math.PI) % 360}°, видно чанків ${g.view ? g.view.chunks.length : 0}`,
    `кадр       ${perf.fps.toFixed(0)} к/с, CPU ${perf.cpu.toFixed(2)} мс`,
    `генерація  ${st.genMs.toFixed(2)} мс/чанк, у пам'яті ${st.chunks}, мешів ${meshCount}, у черзі ${st.pending}`,
  ].join('\n');
}
