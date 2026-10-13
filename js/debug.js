// debug.js — панель F3: зерно, адреса, клітинка, чанк і його відбиток, закони всесвіту, швидкодія.
import { CS, TYPE_NAMES, BLOCK_NAMES, O_ROCK, O_TREE, digest, tile } from './gen/chunk.js';
import { canLift } from './carry.js';
import { physOf, STRANGE_NAMES, TIER_NAMES, FAM_NAMES, LEVEL } from './universe.js';
import { BIOMES } from './gen/biomes.js';
import { regionAt, speciesOf, FORMS } from './gen/flora.js';
import { jumpHeight } from './player.js';
import { dayPhase, clockStr, yearPhase, starsText, heldText } from './sky.js';
import { weatherAt, WEATHER_NAMES } from './weather.js';
import { LOD_ON } from './camera.js';
import { LAMP } from './lamp.js';
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
const f0 = (v) => v.toFixed(0).replace('-', '−'), pc = (v) => (v >= 0.1 ? (v * 100).toFixed(0) : (v * 100).toPrecision(1)).replace('.', ',') + ' %';
const sg = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d).replace('.', ',');
const atm = (P) => (P < 0.01 ? P.toPrecision(1) : P < 0.1 ? P.toFixed(3) : P < 10 ? P.toFixed(2) : P.toFixed(0)).replace('.', ',');
const COMP = ['', 'газовий гігант', "кам'яна", 'крижана'], dg = (r) => (r * 180 / Math.PI).toFixed(0) + '°';
// Зорі: кожна — роль, клас, T, маса, радіус, світність (сонячні), відстань (а. о.), потік (земних і відносно найяскравішої);
// орбіта планети — відстань (земні для світності групи), велика піввісь, інсоляція, альбедо
function starLine(L) {
  const S = L.star;
  return `${starsText(L).join(' · ')} · орбіта ${f2(S.d)} (${f2(S.a)} а. о.), інсоляція ${f2(S.S)} земної, альбедо ${f2(S.albedo)}, активність ${f1(S.act)}`;
}
// Планета: радіус, густина, тяжіння (база й тут), маса, друга космічна, обертання (доба гри), нахил, широта, рік, сезон
function planetLine(L, g) {
  const P = L.planet, Y = L.sky.year, ph = Y && !P.lock ? yearPhase(L, g.clock || 0) : null, H = heldText(L);
  return `R ${f0(P.R * 6371)} км, ρ ${f2(P.rho * 5.51)} г/см³, g₀ ${f2(P.g0)} → ${f2(L.grav)} g (відцентрова ${pc(P.cent)}), M ${f2(P.M)} M⊕, v₂ ${f1(P.vEsc)} км/с`
    + ` · обертання ${f1(P.rot)} год (мін. ${f1(P.Pmin)}), нахил ${f0(P.obliq)}°, широта ${f0(P.lat)}°`
    + ` · рік ${f0(P.year)} хв${ph !== null ? `, фаза ${f2(ph)}` : ''}${H ? ' · ' + H : ''}`;
}
// Повітря: тиск, склад, μ, густина, висота однорідної атмосфери, парникова товща, температури, градієнт
function airLine(L) {
  const A = L.air, C = L.clim;
  if (A.vacuum) return `майже немає (${atm(A.pressure)} атм; утримання ${f2(A.keep)}) · T рівноважна ${f0(C.Teq - 273.15)} °C`;
  const cmp = Object.entries(A.comp).filter(([, v]) => v >= 0.0005).map(([k, v]) => `${k} ${pc(v)}`).join(' ');
  return `${atm(A.pressure)} атм (утримання ${f2(A.keep)}), ${cmp}, μ ${f1(A.mu)}, ρ ${f2(A.rho)} кг/м³, H ${f0(A.H)} м, τ ${f2(A.tau)}`
    + ` · T рівн. ${f0(C.Teq - 273.15)} / поверхні ${f0(C.Ts - 273.15)} / ділянки ${f0(C.Tpatch - 273.15)} °C, ${f0(C.lapse * 1000)} °C/км, доба ±${f0(C.Ad)}, сезон ±${f0(C.As)}`
    + ` · ${A.gasName}${A.ox ? ', горить' : ''} · серпанок τ ${f2(A.tauA)} (${['водяний', 'сірчаний', 'органічний', 'пиловий'][A.hazeKind]})`;
}
// Поле, радіація, буря, аномалії
function fieldLine(L, E) {
  const A = L.anom, T = L.tanom;
  return `B ${f2(L.mag.B)} (сяйва ${pc(L.mag.k)}), нахил ${dg(L.mag.tilt)} · радіація ${pc(L.air.rad)}${E ? `, зараз ${pc(E.rad)}${E.storm > 0.01 ? ` (буря зорі ${f2(E.storm)})` : ''}` : ''}`
    + ` · аномалії гравітації ${pc(A.freq)}${A.tilt ? ' з нахилом' : ''}${A.rev ? `, зворотні (k₀ ${f2(A.rev.k0)}, до ${f0(A.rev.Ha)} м)` : ''}`
    + (T ? ` · часові ${pc(T.freq)}: ×${f2(T.ks)} / ×${f2(T.kf)}` : '');
}
// Середовище тут і зараз (envHere у main.js)
function envLine(E) {
  const T = E.T, w = E.wind;
  return `${f0(T.T)} °C (ділянка ${f0(T.patch)} ${sg(T.biome, 0)} біом ${sg(T.height, 0)} висота ${sg(T.day, 0)} доба ${sg(T.season, 0)} сезон ${sg(T.weather, 0)} погода)`
    + ` · ${atm(E.P)} атм, ${f2(E.rho)} кг/м³ · g ${f2(E.g)}${E.tide ? ` (приплив ${sg(E.tide * 100, 1)} %)` : ''}${E.rev ? ' зворотна' : E.anom ? ` ×${f2(E.anom)}` : ''}${E.time !== 1 ? ` · час ×${f2(E.time)}` : ''}`
    + ` · вітер ${f1(w.here)} м/с (база ${f1(w.base)}, висота ×${f2(w.hk)}${w.lee < 1 ? `, затишок ×${f2(w.lee)}` : ''}${w.push ? ', зносить' : ''})`;
}
// Місяці й компаньйон
function moonsLine(L) {
  const M = L.sky.moons.map((m) => `${f0(m.Rkm)} км на ${f0(m.D)} R (${f1(m.period)} діб)`), C = L.comp;
  return `${M.length ? M.join(', ') : 'немає'}${C ? ` · компаньйон: ${COMP[C.type]}, приплив ${pc(C.f)} g, ρ ×${f2(C.rhoR)}, R ×${f2(C.Rr)}` : ''}${L.sky.rings ? ' · кільця' : ''}`;
}
// Світло неба: тут (блок тулуба) і поле всесвіту
// Ліхтарик (L): дальність, конус (від краю до краю), тінь — лише зі скла на лобі в третій особі
function lampLine(g, R) {
  if (!g.lamp) return 'вимкнено';
  const base = `увімкнено · ${LAMP.range} м · конус ${LAMP.inner + LAMP.outer}° · сила ${f1(LAMP.intensity)}`;
  if (g.lampEye) return `${base} · без тіні (з ока)`;
  if (R && R.info && R.info.shadows === 'off') return `${base} · тіні вимкнено`;
  return `${base} · тінь: ${f2((R ? R.stats.lampTris || 0 : 0) / 1e6)} млн трикутників, ${R ? R.stats.lampDraws || 0 : 0} викликів`;
}
function lightLine(g) {
  const { world, me } = g, s = world.lightAt(g.d, g.n, Math.floor(me.x), Math.floor(me.y), Math.floor((me.z ?? 0) / LEVEL + 1)), ls = world.lightStats(g.d, g.n);
  const here = s >= 0 ? `${s}/30 (рівень ${(s / 2).toFixed(1).replace('.', ',')}, яскравість ${Math.round(world.skyLight(g.d, g.n, me.x, me.y, (me.z ?? 0) + 0.5) * 100)} %)` : s === -2 ? 'в опаковому' : 'невідомо';
  return `тут ${here} · секцій зі світлом ${ls.store ?? 0} · черга ${ls.queued ?? 0}, брудних ${ls.dirty ?? 0} · перебудов: у черзі ${ls.relit}, зроблено ${ls.relitDone}, рослин ${ls.floraLit} · ${f1(ls.ms ?? 0)} мс усього`;
}

export function debugText(g, perf, meshCount, cam, R, lod) {
  const { world, rec, me } = g, L = world.laws(g.d, g.n);
  const tx = Math.floor(me.x), ty = Math.floor(me.y), c = world.column(g.d, g.n, tx, ty);
  const kf = Math.floor((me.z ?? 0) / LEVEL + 1e-4), under = me.floorB ?? -1;
  const cx = Math.floor(tx / CS), cy = Math.floor(ty / CS), C = world.col(g.d, g.n, cx, cy), st = world.stats(), ph = physOf(L), E = g.envHere ? g.envHere() : null;
  return [
    `зерно      «${rec.seedText}» (${rec.seed})  генератор v${rec.gen}`,
    `адреса     глибина ${g.d}, всесвіт ${fmtN(g.n)}`,
    `позиція    ${me.x.toFixed(2)}, ${me.y.toFixed(2)}  z ${me.z.toFixed(2)}${me.air ? '  у повітрі' : ''}`,
    `гравітація ${L.grav.toFixed(L.grav < 0.1 ? 3 : 2).replace('.', ',')} g: стрибок ${f2(jumpHeight(L.grav, ph.vT))} м, крок угору ${ph.up}, хода ×${f2(ph.speed)}`,
    `зоря       ${starLine(L)}`,
    `планета    ${planetLine(L, g)}`,
    `повітря    ${airLine(L)}`,
    `поле       ${fieldLine(L, E)}`,
    `середовище ${E ? envLine(E) : '—'}`,
    `місяці     ${moonsLine(L)}`,
    `клітинка   ${c ? `поверхня ${c.h}, ${TYPE_NAMES[c.t]}; під ногами — ${me.ground && under > 0 ? BLOCK_NAMES[under] : '—'}${me.ground ? '' : me.swim ? ', пливе' : ', у повітрі'}` : '—'}`,
    `чанк       ${cx}, ${cy}, секція ${Math.floor(kf / 16)}  відбиток стовпця ${C ? digest(C) : '—'}`,
    `дивність   ${STRANGE_NAMES[L.strange.cls]} (qs ${L.strange.qs.toFixed(2)})${Object.keys(L.tiers).length ? '; ' + Object.entries(L.tiers).map(([k, t]) => `${k} — ${TIER_NAMES[t]}`).join(', ') : ''}`,
    `закони     море ${L.seaE.toFixed(2)}, рельєф ${L.amp}, t ${L.temp.toFixed(2)}, вологість ${L.wet.toFixed(2)}`,
    `рідина     ${L.liquid.name}, ${L.liquid.tC} °C, густина ${L.liquid.density}${L.liquid.swim ? ', тримає' : ', не тримає'}${L.liquid.danger ? ' — небезпечна: ' + L.liquid.danger : ''}${me.swim ? '  (пливе)' : ''}, в'язкість ${L.liquid.visc.toFixed(1)}${L.liquid.tension ? ', поверхневий натяг' : ''}`,
    `біом       ${c ? BIOMES[c.bm].name : '—'}  (у всесвіті: ${L.biomes.flat().map(([id]) => BIOMES[id].name).filter((v, i, a) => a.indexOf(v) === i).length} біомів)`,
    `види       ${c && c.bm ? speciesLine(L, tx, ty, c.bm) : '—'}`,
    `рослини    густота ${(L.flora * 100).toFixed(1)} %, розмір ×${L.treeH.toFixed(2)}, каміння ${(L.rocks * 100).toFixed(1)} %`,
    `рельєф     річки ${(L.relief.rivers * 100).toFixed(0)} %, каньйони ${(L.relief.canyons * 100).toFixed(0)} %, кратери ${(L.relief.craters * 100).toFixed(0)} %, вулкани ${(L.relief.volcano * 100).toFixed(0)} %${L.relief.volcanoLava ? ' (з лавою)' : ''}, шпилі ${(L.relief.spires * 100).toFixed(0)} %, тераси ${(L.relief.terrace * 100).toFixed(0)} %, дюни ${(L.relief.dunes * 100).toFixed(0)} %`,
    `рельєф 3.1 ${land3(L)}`,
    `рельєф тут ${((t) => (t.fam >= 0 ? FAM_NAMES[t.fam] : 'плавна') + (t.fx ? `, скелі до ${t.fx.toFixed(0)} бл.` : ''))(tile(L, tx, ty))}`,
    `породи     ${L.stones.length ? L.stones.map((st) => `${['завжди', 'g < ' + st.thr.toFixed(2), 'g > ' + st.thr.toFixed(2), 'поле > ' + st.thr.toFixed(2)][st.cond]}, підйом ${st.lift.toFixed(2)}${st.active ? (st.lift > 1 ? ' — ширяє' : ' — легша') : ' — ні'}${st.islands ? ', острови' : ''}`).join('; ') : 'левітуючих немає'}`,
    `фізика     тертя ${L.phys.friction.toFixed(2)}${L.phys.friction < 1 ? ' (ковзко)' : ''}, пружність ${L.phys.bounce.toFixed(2)}, падіння до ${ph.vT.toFixed(1)} м/с, плин часу ×${L.phys.time.toFixed(2)}`,
    `небо       доба ${L.sky.lock ? 'вічна (припливне захоплення)' : (L.sky.dayMin / L.phys.time).toFixed(1) + ' хв'}, ${clockStr(dayPhase(L, g.clock || 0))}, сонць ${L.sky.suns.length}, місяців ${L.sky.moons.length}${L.comp ? ' і компаньйон' : ''}${L.sky.rings ? ', кільця' : ''} · вітер у ясну ${f1(L.air.wind)} м/с`,
    `погода     ${WEATHER_NAMES[(g.wPrev || weatherAt(L, g.clock || 0, me.x, me.y)).kind]} (плями ${(L.air.cS / 1000).toFixed(1)} км, зміна ${(L.air.cT / 60).toFixed(0)} хв; ${Object.entries(L.air.w).filter(([, v]) => v > 0.05).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ')})`,
    `камера     ${cam.mode === 'first' ? `перша особа, око ${f2(g.eyeZ ?? 0)}` : `третя особа, відстань ${f1(g.camDist ?? cam.dist)} з ${f1(cam.dist)}`}${g.under ? ' · під рідиною' : ''}, азимут ${Math.round(cam.yaw * 180 / Math.PI) % 360}°, видно стовпців ${g.visible || 0}`,
    `зіткнення  секцій ${CST.secs}, трикутників ${(CST.tris / 1000).toFixed(1).replace('.', ',')} тис., побудов ${CST.builds} (${f1(CST.buildMs)} мс) · крок ${f1(g.stepUs || 0)} мкс${me.ground ? ` · підлога ${me.floorN ? (Math.acos(Math.min(1, me.floorN[2])) * 180 / Math.PI).toFixed(0) + '°' : '—'}` : ''}`,
    `поза       ${poseLine(me)}`,
    `ціль       ${aimLine(g.aim, g.ph ? g.ph.g : 1)}`,
    `у руках    ${g.carry ? `камінь ${Math.round(g.carry.b.mass)} кг (вага ${Math.round(g.carry.k * 100)} % найбільшої)` : '—'}`,
    `кадр       ${perf.fps.toFixed(0)} к/с · ${f1(perf.frameMs)} мс (p99 ${f1(perf.p99)}) · CPU ${perf.upd.toFixed(2).replace('.', ',')} + ${perf.drw.toFixed(2).replace('.', ',')} мс · GPU ${R && R.gpuMs !== null ? R.gpuMs.toFixed(2).replace('.', ',') + ' мс' : '—'}`,
    `рендер     викликів ${R ? R.stats.draws : 0} · трикутників ${R ? (R.stats.tris / 1e6).toFixed(2).replace('.', ',') : 0} млн${R && R.stats.shTris ? ` (тіні ${(R.stats.shTris / 1e6).toFixed(2).replace('.', ',')})` : ''} · завантажено ${R ? (R.stats.up / 1024).toFixed(0) : 0} КБ/кадр · у GPU ${R ? ((R.stats.gpuBytes + R.stats.arenaUsed) / 1048576).toFixed(0) : 0} з ${R ? ((R.stats.gpuBytes + R.stats.arenaBytes) / 1048576).toFixed(0) : 0} МБ · секцій ${meshCount}${lod && LOD_ON ? ` · LOD увімкнено (0/1/2: ${lod[0]}/${lod[1]}/${lod[2]})` : ''}${R && !R.cullOn ? ' · відсікання вимкнено' : ''}${R && R.stats.full ? ` · арена повна: ${R.stats.full}` : ''}${R && R.info ? ` · ${R.info.device} · тіні ${R.info.shadows === 'off' ? 'вимкнено' : R.info.shadows.toUpperCase()} · світел ${R.info.lights.dir} + ${R.info.lights.local}` : ''}`,
    `закрите    ${!g.occ || !g.occ.enabled ? 'відсікання вимкнено' : !g.occ.stats.on ? `не відсікається (${g.occ.stats.why})` : `заслони з ${g.occ.stats.secs} секцій (${g.occ.stats.polys} прямокутників, на екрані ${g.occ.stats.drawn}; ${g.occ.stats.ms.toFixed(2).replace('.', ',')} мс) · поза кадром і закрито ${g.occ.stats.culled} з ${g.occ.stats.boxes} коробок`}`,
    `світло     ${lightLine(g)}`,
    `ліхтарик   ${lampLine(g, R)}`,
    `генерація  воркерів ${st.workers} · ${st.colsPerSec} стовпців/с · ${st.genMs.toFixed(2).replace('.', ',')} мс/робота · стовпців ${st.cols}, секцій ${st.secs}, у черзі ${st.pending}${st.failed ? ` · робіт з винятком ${st.failed} (консоль)` : ''} · стрімінг ${(g.streamMs || 0).toFixed(1).replace('.', ',')} мс`,
  ].join('\n');
}
