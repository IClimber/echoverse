// debug.js — панель F3: зерно, адреса, клітинка, чанк і його відбиток, закони всесвіту, швидкодія.
import { CS, TYPE_NAMES, BLOCK_NAMES, O_ROCK, O_TREE, digest, tile } from './gen/chunk.js';
import { canLift } from './carry.js';
import { physOf, STRANGE_NAMES, TIER_NAMES, FAM_NAMES } from './universe.js';
import { BIOMES } from './gen/biomes.js';
import { regionAt, speciesOf, FORMS } from './gen/flora.js';
import { jumpHeight } from './player.js';
import { dayPhase, clockStr } from './sky.js';
import { weatherAt, WEATHER_NAMES } from './weather.js';
import { LEVEL } from './iso.js';
import { LOD_ON } from './camera.js';
import { styleOf } from './gen/mesh.js';
import { stats as CST } from './collision.js';

// Рельєф 3.1: скелі, родини кривої, ерозія, куести, останці, карст, рифти
function land3(L) {
  const D = L.land, pc = (v) => (v * 100).toFixed(0) + ' %';
  const fam = D.fam.map((f, i) => f.share >= 0.01 ? `${FAM_NAMES[i]} ${pc(f.share)}` : '').filter(Boolean);
  return `скелі ${pc(D.cliff.share)} до ${D.cliff.F.toFixed(0)} бл. · плато ${D.P.toFixed(0)} бл.${fam.length ? ': ' + fam.join(', ') : ''} · ерозія ${D.ero.bias.toFixed(2)}`
    + ` · куести ${pc(D.cuesta.share)} · останці ${pc(D.insel.prob)} · карст ${pc(D.karst.share)} · рифти ${pc(D.rift.share)}`;
}

// Види області під ногами в цьому біомі: «область 3fa2c1: хвойне, кущ, трава»
function speciesLine(L, x, y, bm) {
  const reg = regionAt(L, x, y), S = speciesOf(L, reg, bm);
  return `область ${(reg.id >>> 0).toString(16).padStart(8, '0').slice(0, 6)}: ${[...S.big, ...S.small].map((g) => FORMS[g.form].name).join(', ') || 'немає'}`;
}

// Поза гравця: стоїть / присів / лежить / пливе під рідиною; лізе (хват) / драбина; сповзає (кут, межа); витривалість
const POSE_NAMES = { stand: 'стоїть', crouch: 'присів', crawl: 'лежить', swim: 'пливе під рідиною' };
const deg = (a) => (a * 180 / Math.PI).toFixed(0) + '°';
function poseLine(me) {
  const s = [me.climb ? (me.climb.kind === 'wall' ? `лізе по стіні, хват ${(me.grip ?? 1).toFixed(2).replace('.', ',')}` : 'драбина / ліана') : POSE_NAMES[me.pose || 'stand']];
  if (me.dive) s.push('пірнає');
  if (me.slide) s.push(`сповзає: ${deg(me.slideA || 0)}, межа ${deg(me.slideS || 0)}`);
  if (me.mantle) s.push('вилазить');
  if ((me.stam ?? 1) < 1 || me.climb) s.push(`витривалість ${Math.round((me.stam ?? 1) * 100)} %${me.tired ? ' (втома)' : ''}`);
  return s.join(' · ');
}
const STONE_NAMES = { boulder: 'брила', slabs: 'плити', spire: 'шпиль', cairn: 'купа', geode: 'жеода', log: 'колода' };
// Ціль: блок x y k вид / тіло m кг (можна взяти / заважко) / рослина (форма) / камінь; відстань
export function aimLine(a, gg) {
  if (!a) return '—';
  const t = ` · ${a.t.toFixed(2).replace('.', ',')}`;
  if (a.kind === 'block') return `блок ${a.x} ${a.y} ${a.k}, ${BLOCK_NAMES[a.b]}${t}`;
  if (a.kind === 'body') { const q = canLift(a.body, gg); return `тіло ${Math.round(a.body.mass)} кг (${q.ok ? 'можна взяти' : 'заважко'})${t}`; }
  // у каменю форма виду — 'stone' (її немає у FORMS), вигляд — стиль (брила, колода…); до 12.10.2026 тут був виняток,
  // і він зупиняв цикл гри
  const o = a.obj.o, g = a.obj.C.sp && a.obj.C.sp[o.s];
  const name = !g ? '' : o.k === O_ROCK ? STONE_NAMES[styleOf(g, o.v)] : FORMS[g.form] && FORMS[g.form].name;
  return (o.k === O_ROCK ? 'камінь' : o.k === O_TREE ? 'дерево' : 'рослина') + (name ? ` (${name})` : '') + t;
}

export const fmtN = (n) => n > 0 ? '+' + n : n < 0 ? '−' + -n : '0';

const f1 = (v) => v.toFixed(1).replace('.', ','), f2 = (v) => v.toFixed(2).replace('.', ',');
export function debugText(g, perf, meshCount, cam, R, lod) {
  const { world, rec, me } = g, L = world.laws(g.d, g.n);
  const tx = Math.floor(me.x), ty = Math.floor(me.y), c = world.column(g.d, g.n, tx, ty);
  const kf = Math.floor((me.z ?? 0) / LEVEL + 1e-4), under = me.floorB ?? -1;
  const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS), C = world.col(g.d, g.n, cx, cy), st = world.stats(), ph = physOf(L);
  return [
    `зерно      «${rec.seedText}» (${rec.seed})  генератор v${rec.gen}`,
    `адреса     глибина ${g.d}, всесвіт ${fmtN(g.n)}`,
    `позиція    ${me.x.toFixed(2)}, ${me.y.toFixed(2)}  z ${me.z.toFixed(2)}${me.air ? '  у повітрі' : ''}`,
    `гравітація ${L.grav.toFixed(L.grav < 0.1 ? 3 : 2)} g: стрибок ${jumpHeight(L.grav).toFixed(2)} м, крок угору ${ph.up}, хода ×${ph.speed.toFixed(2)}`,
    `клітинка   ${c ? `поверхня ${c.h}, ${TYPE_NAMES[c.t]}; під ногами — ${me.ground && under > 0 ? BLOCK_NAMES[under] : '—'}${me.ground ? '' : me.swim ? ', пливе' : ', у повітрі'}` : '—'}`,
    `чанк       ${cx}, ${cy}, секція ${Math.floor(kf / 16)}  відбиток стовпця ${C ? digest(C) : '—'}`,
    `дивність   ${STRANGE_NAMES[L.strange.cls]} (qs ${L.strange.qs.toFixed(2)})${Object.keys(L.tiers).length ? '; ' + Object.entries(L.tiers).map(([k, t]) => `${k} — ${TIER_NAMES[t]}`).join(', ') : ''}`,
    `закони     море ${L.seaE.toFixed(2)}, рельєф ${L.amp}, t ${L.temp.toFixed(2)}, вологість ${L.wet.toFixed(2)}`,
    `рідина     ${L.liquid.name}, ${L.liquid.tC} °C, густина ${L.liquid.density}${L.liquid.swim ? ', тримає' : ', не тримає'}${L.liquid.danger ? ' — небезпечна: ' + L.liquid.danger : ''}${me.swim ? '  (пливе)' : ''}`,
    `біом       ${c ? BIOMES[c.bm].name : '—'}  (у всесвіті: ${L.biomes.flat().map(([id]) => BIOMES[id].name).filter((v, i, a) => a.indexOf(v) === i).length} біомів)`,
    `види       ${c && c.bm ? speciesLine(L, tx, ty, c.bm) : '—'}`,
    `рослини    густота ${(L.flora * 100).toFixed(1)} %, розмір ×${L.treeH.toFixed(2)}, каміння ${(L.rocks * 100).toFixed(1)} %`,
    `рельєф     річки ${(L.relief.rivers * 100).toFixed(0)} %, каньйони ${(L.relief.canyons * 100).toFixed(0)} %, кратери ${(L.relief.craters * 100).toFixed(0)} %, вулкани ${(L.relief.volcano * 100).toFixed(0)} %${L.relief.volcanoLava ? ' (з лавою)' : ''}, шпилі ${(L.relief.spires * 100).toFixed(0)} %, тераси ${(L.relief.terrace * 100).toFixed(0)} %, дюни ${(L.relief.dunes * 100).toFixed(0)} %`,
    `рельєф 3.1 ${land3(L)}`,
    `тут        ${((t) => (t.fam >= 0 ? FAM_NAMES[t.fam] : 'плавна') + (t.fx ? `, скелі до ${t.fx.toFixed(0)} бл.` : ''))(tile(L, tx, ty))}`,
    `породи     ${L.stones.length ? L.stones.map((st) => `${['завжди', 'g < ' + st.thr.toFixed(2), 'g > ' + st.thr.toFixed(2), 'поле > ' + st.thr.toFixed(2)][st.cond]}, підйом ${st.lift.toFixed(2)}${st.active ? (st.lift > 1 ? ' — ширяє' : ' — легша') : ' — ні'}${st.islands ? ', острови' : ''}`).join('; ') : 'левітуючих немає'}`,
    `поле       магнітне ${(L.mag.k * 100).toFixed(0)} %, аномалії гравітації ${(L.anom.freq * 100).toFixed(0)} %${L.anom.tilt ? ' (з нахилом)' : ''}, тут ×${(g.ph && g.ph.anom || 1).toFixed(2)}; рідина: в'язкість ${L.liquid.visc.toFixed(1)}${L.liquid.tension ? ', поверхневий натяг' : ''}`,
    `фізика     тертя ${L.phys.friction.toFixed(2)}${L.phys.friction < 1 ? ' (ковзко)' : ''}, пружність ${L.phys.bounce.toFixed(2)}, падіння до ${ph.vT.toFixed(1)} м/с, плин часу ×${L.phys.time.toFixed(2)}, радіус планети ${L.phys.planetR.toFixed(0)} км`,
    `небо       доба ${L.sky.lock ? 'вічна (припливне захоплення)' : (L.sky.dayMin / L.phys.time).toFixed(1) + ' хв'}, ${clockStr(dayPhase(L, g.clock || 0))}, сонць ${L.sky.suns.length}, місяців ${L.sky.moons.length}${L.sky.rings ? ', кільця' : ''}, широта ${(L.sky.lat * 180 / Math.PI).toFixed(0)}°`,
    `повітря    тиск ${L.air.pressure.toFixed(2)} атм, ${L.air.gasName}, радіація ${(L.air.rad * 100).toFixed(0)} %, серпанок ${(L.air.haze * 100).toFixed(0)} %, вітер ${(L.air.wind * 3.6).toFixed(0)} км/год (у грозу ×2,2)`,
    `погода     ${WEATHER_NAMES[weatherAt(L, g.clock || 0).kind]} (зміна раз на ${L.air.segMin.toFixed(1)} хв; ${Object.entries(L.air.w).filter(([, v]) => v > 0.05).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ')})`,
    `камера     ${cam.mode === 'iso' ? `згори, масштаб ${cam.zoom.toFixed(2)}` : cam.mode === 'first' ? `перша особа, око ${f2(g.eyeZ ?? 0)}` : `третя особа, відстань ${f1(g.camDist ?? cam.dist)} з ${f1(cam.dist)}`}${g.under ? ' · під рідиною' : ''}, азимут ${Math.round(cam.yaw * 180 / Math.PI) % 360}°, видно стовпців ${g.visible || 0}`,
    `зіткнення  секцій ${CST.secs}, трикутників ${(CST.tris / 1000).toFixed(1).replace('.', ',')} тис., побудов ${CST.builds} (${f1(CST.buildMs)} мс) · крок ${f1(g.stepUs || 0)} мкс${me.ground ? ` · підлога ${me.floorN ? (Math.acos(Math.min(1, me.floorN[2])) * 180 / Math.PI).toFixed(0) + '°' : '—'}` : ''}`,
    `поза       ${poseLine(me)}`,
    `ціль       ${aimLine(g.aim, g.ph ? g.ph.g : 1)}`,
    `у руках    ${g.carry ? `камінь ${Math.round(g.carry.b.mass)} кг (вага ${Math.round(g.carry.k * 100)} % найбільшої)` : '—'}`,
    `кадр       ${perf.fps.toFixed(0)} к/с · ${f1(perf.frameMs)} мс (p99 ${f1(perf.p99)}) · CPU ${perf.upd.toFixed(2).replace('.', ',')} + ${perf.drw.toFixed(2).replace('.', ',')} мс · GPU ${R && R.gpuMs !== null ? R.gpuMs.toFixed(2).replace('.', ',') + ' мс' : '—'}`,
    `рендер     викликів ${R ? R.stats.draws : 0} · трикутників ${R ? (R.stats.tris / 1e6).toFixed(2).replace('.', ',') : 0} млн · завантажено ${R ? (R.stats.up / 1024).toFixed(0) : 0} КБ/кадр · у GPU ${R ? ((R.stats.gpuBytes + R.stats.arenaUsed) / 1048576).toFixed(0) : 0} з ${R ? ((R.stats.gpuBytes + R.stats.arenaBytes) / 1048576).toFixed(0) : 0} МБ · секцій ${meshCount}${lod && LOD_ON ? ` · LOD увімкнено (0/1/2: ${lod[0]}/${lod[1]}/${lod[2]})` : ''}${R && !R.cullOn ? ' · відсікання вимкнено' : ''}${R && R.stats.over ? ' · бюджет GPU перевищено' : ''}${R && R.info ? ` · ${R.info.device} · тіні ${R.info.shadows === 'off' ? 'вимкнено' : R.info.shadows.toUpperCase()} · світел ${R.info.lights.dir} + ${R.info.lights.local}` : ''}`,
    `генерація  воркерів ${st.workers} · ${st.colsPerSec} стовпців/с · ${st.genMs.toFixed(2).replace('.', ',')} мс/робота · стовпців ${st.cols}, секцій ${st.secs}, у черзі ${st.pending} · стрімінг ${(g.streamMs || 0).toFixed(1).replace('.', ',')} мс`,
  ].join('\n');
}
