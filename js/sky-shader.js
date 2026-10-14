// js/sky-shader.js — небо гри: функція ecoSky(d) у GLSL і WGSL для engine/graphics/sky.js (skyboxPS PlayCanvas і запікання
// розсіяного світла). d — одиничний напрям у світі гри (z угору); результат — лінійний колір (кольори неба в законах —
// екранні, тож ^2,2). З ECO_BAKE (запікання): без дисків і ореолів сонць, місяців, зір, сяйва, спалаху; нижче обрію —
// колір обрію × 0,3 (земля відбиває менше за небо); не темніше 0,02 (чорне небо без повітря — не нуль); × eco_bakeK (калібрування сили розсіяного, js/scene.js).
// Уніформи — через dev.scope (js/scene.js): uZen, uHor, uDuskDir (напрям на сонце заходу — сяйво), uDusk (rgb, сила), uSun[3] (напрям, кутовий радіус),
// uSunCol[3] (колір прямого світла зорі — диск її кольору, яскравість), uSunSp[3] (світло зорі на тілах: колір × яскравість поза
// нашим повітрям, справжній кутовий радіус), uSunSh[3] (світло в тіні планети від цього сонця: заломлене повітрям; без повітря — 0), uMoon[4] (місяці й компаньйон), uMoonCol[4] (rgb, тип: 0 — місяць, 1 — газовий гігант,
// 2 — кам'яний, 3 — крижаний), uMoon2[4] (другий колір візерунка, радіус планети в радіусах тіла), uMoonA[4] / uMoonB[4]
// (вісь і нульовий меридіан тіла: візерунок компаньйона — у його системі — повернутий до нас одним боком чи крутиться;
// .w — масштаб розмірів тіла (10 — місяць, 1 — компаньйон) і відстань до тіла в його радіусах), uNSun, uNMoon, uDay, uStars (яскравість, відтінок),
// uCel (обертання зоряного неба), uRing (r0, r1, непрозорість, смуг), uRingCol, uPole, uCloud (хмарність, зсув x, y,
// темність), uCloudCol, uFlash, uAur (напрям на магнітний полюс x, y, сила, час), uAurCol, uAurG (відстань до середини овалу вздовж uAur.xy, км;
// радіус планети, км; півширина овалу, км), uFwd (погляд камери — диски світил у площині кадру), uCloudC
// (зсув камери від центру карти хмар x, y, стиснення карти A, висота шару хмар над камерою; м), uCloudMap (хмарність
// 64×64; точка шару хмар p — у клітинці q = p / (|p| + A): біля зеніту дрібно, до обрію — грубіше, край карти — обрій),
// uMet[4] / uMetB[4] (метеор: початок і поступ, кінець і яскравість), uNMet, eco_bakeK.
// Шум хмар і сяйва — value noise з хешем без синуса (Hoskins) за клітинкою mod 256, fBm з множником рівно 2: період 256,
// тож зсуви часу й вітру CPU загортає за ним (js/scene.js) — у шейдер не йдуть великі числа. Був хеш fract(sin(·)·43758):
// на аргументах у тисячі sin на GPU втрачає точність — сяйво й хмари розпадались на прямокутні панелі (11.10.2026)
// GLSL: уніформи — по одній на рядок

export const SKY_GLSL = `
uniform vec3 uZen;
uniform vec3 uHor;
uniform vec3 uDuskDir;
uniform vec4 uDusk;
uniform vec4 uSun[3];
uniform vec4 uSunCol[3];
uniform vec4 uSunSp[3];
uniform vec4 uSunSh[3];
uniform vec4 uMoon[4];
uniform vec4 uMoonCol[4];
uniform vec4 uMoon2[4];
uniform vec4 uMoonA[4];
uniform vec4 uMoonB[4];
uniform int uNSun;
uniform int uNMoon;
uniform float uDay;
uniform vec2 uStars;
uniform mat3 uCel;
uniform vec4 uRing;
uniform vec3 uRingCol;
uniform vec3 uPole;
uniform vec4 uCloud;
uniform vec3 uCloudCol;
uniform float uFlash;
uniform vec4 uAur;
uniform vec3 uAurCol;
uniform vec4 uAurG;
uniform vec3 uFwd;
uniform vec4 uCloudC;
uniform sampler2D uCloudMap;
uniform vec4 uMet[4];
uniform vec4 uMetB[4];
uniform int uNMet;
uniform float eco_bakeK;
uniform vec4 uHz[4];
float ecoHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float ecoHashN(vec2 p) { vec3 q = fract(mod(p, 256.0).xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float ecoNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = ecoHashN(i), b = ecoHashN(i + vec2(1, 0)), c = ecoHashN(i + vec2(0, 1)), d = ecoHashN(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float ecoFbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * ecoNoise(p); p = p * 2.0 + 17.0; a *= 0.5; } return v; }
float ecoN1(float x) { float i = floor(x), f = fract(x); return mix(ecoHashN(vec2(i, 3.7)), ecoHashN(vec2(i + 1.0, 3.7)), f * f * (3.0 - 2.0 * f)); }
// Диск світила (o — центр, s — кутовий радіус): xyz — напрям e, у якому шукати точку тіла, w — l2 = sin²θ / sin²s (θ — кут
// e від центру; 1 — край, > 1 — поза). Великі тіла (компаньйон, s > 0,25) — справжня куля: e = d, вигляд не залежить від
// того, куди дивишся (13.10.2026, скарга: смуги й освітлена частина компаньйона радіусом 54° «пливли» з поглядом —
// білборд такого розміру росте й ковзає відносно ландшафту). Малі (сонця, місяці, s < 0,15) — «білборд», паралельний
// площині кадру (uFwd — погляд камери): прямолінійна перспектива на краях кадру розтягує диск за кутом у 1/cos θ разів
// уздовж радіуса екрана, а білборд у кадрі — завжди коло; e — напрям, що дав би той самий зсув, якби дивились прямо на
// тіло (зсув у площині, повернутий з uFwd на o). Центр далі ~65° від осі (поза кадром) — плавно до справжньої кулі.
// Білборд не виходить за кутовий радіус диска (упоперек — рівно s, уздовж — менше), тож далі 1,3·s — одразу «поза»
vec4 ecoDisk(vec3 d, vec3 o, float s) {
  float co = dot(d, o), fo = dot(o, uFwd);
  if (co < cos(min(s * 1.3, 1.55))) return vec4(d, 2.0);
  vec3 e = d;
  float w = smoothstep(0.2, 0.45, fo) * (1.0 - smoothstep(0.15, 0.25, s));
  if (w > 0.0) {
    vec3 q = d * (fo / max(dot(d, uFwd), 1e-4)) - o;
    q -= dot(q, o) / (1.0 + fo) * (uFwd + o);
    e = normalize(mix(d, normalize(o + q), w));
  }
  float ce = dot(e, o), ss = sin(s);
  return vec4(e, ce > 0.0 ? (1.0 - ce * ce) / (ss * ss) : 2.0);
}
// Нормаль кулі в точці, де її перетинає промінь e (l2 < 1): відстань до центру D = 1 / sin s (радіусів), перетин
// t = D·cos θ − √(1 − l2) — видно лише ковпак до 90° − s від центру (у велетня — не півкулю)
vec3 ecoBodyN(vec3 e, vec3 o, float s, float l2) { float D = 1.0 / sin(s); return normalize((D * dot(e, o) - sqrt(max(0.0, 1.0 - l2))) * e - D * o); }
// Край тіла: згладжування на 5 % радіуса, не ширше 0,0075 рад (до 13.10.2026 — частка радіуса: край компаньйона в 54° —
// розмитий на ~4°)
float ecoEdge(float l2, float s) { return smoothstep(0.0, 0.05 * min(s, 0.15), s - asin(min(1.0, sqrt(l2) * sin(s)))); }
// Справжній обрій (js/horizon.js): sin кута під горизонталлю в напрямку d — 16 азимутів від +x, лінійно між ними
float ecoHzK(int k) { vec4 q = uHz[k / 4]; int j = k - k / 4 * 4; return j == 0 ? q.x : j == 1 ? q.y : j == 2 ? q.z : q.w; }
float ecoHz(vec3 d) {
  float a = atan(d.y, abs(d.x) + abs(d.y) < 1e-7 ? 1.0 : d.x) * 2.5464791 + 16.0, i = floor(a);   // 16 / 2π; a ∈ [8, 24]
  int k = int(i) - int(i) / 16 * 16;
  return mix(ecoHzK(k), ecoHzK(k == 15 ? 0 : k + 1), a - i);
}
vec3 ecoSky(vec3 d) {
  // uph — висота над справжнім обрієм: з висоти він нижче горизонталі (кривизна), до нього — небо, світила й тіла;
  // хмари й сяйво — шари над оком, від горизонталі (up); запікання розсіяного — від горизонталі, як і було
  float up = d.z;
#ifdef ECO_BAKE
  float uph = up;
#else
  float uph = up + ecoHz(d);
#endif
  float above = smoothstep(-0.02, 0.01, uph);
  vec3 c = uph < 0.0 ? uHor * (1.0 + uph * 0.35) : mix(uHor, uZen, smoothstep(0.0, 0.55, uph));
  float g = max(dot(d, uDuskDir), 0.0);
  c += uDusk.rgb * uDusk.a * (pow(g, 5.0) * 0.6 + pow(g, 40.0) * 0.4) * smoothstep(-0.25, 0.05, uph);
#ifndef ECO_BAKE
  vec3 c0 = c;                                   // небо перед світилами (без зір)
#endif
  float cover = 0.0;
  if (uCloud.x > 0.01 && up > 0.0) {
    // хмарність — з карти погоди в точці шару хмар (uCloudC.w над камерою); карта стиснена з відстанню й сягає обрію
    vec2 p = uCloudC.xy + d.xy * (uCloudC.w / max(up, 0.03));
    float cov = texture2D(uCloudMap, p / (length(p) + uCloudC.z) * 0.5 + 0.5).r;
    vec2 uv = d.xy / (up + 0.08) * 0.9 + uCloud.yz;
    float f = ecoFbm(uv);
    cover = cov > 0.01 ? smoothstep(1.02 - cov * 0.75, 1.25 - cov * 0.7, f + 0.25) * smoothstep(0.0, 0.12, up) : 0.0;
  }
#ifndef ECO_BAKE
  if (uStars.x > 0.01 && uph > -0.05) {
    vec3 q = d * uCel, aq = abs(q);
    vec2 uv; float f;
    if (aq.x >= aq.y && aq.x >= aq.z) { uv = q.yz / aq.x; f = sign(q.x); }
    else if (aq.y >= aq.z) { uv = q.xz / aq.y; f = 2.0 + sign(q.y); }
    else { uv = q.xy / aq.z; f = 4.0 + sign(q.z); }
    uv *= 90.0;
    vec2 cell = floor(uv);
    if (ecoHash(vec3(cell, f)) > 1.0 - 0.07 * uStars.x) {
      vec2 ctr = cell + 0.25 + 0.5 * vec2(ecoHash(vec3(cell, f + 7.0)), ecoHash(vec3(cell, f + 13.0)));
      float br = (1.0 - smoothstep(0.0, 0.34, length(uv - ctr))) * (0.35 + 0.65 * ecoHash(vec3(cell, f + 3.0)));
      vec3 sc = mix(vec3(1.0), 0.55 + 0.45 * cos(6.2831 * (uStars.y + ecoHash(vec3(cell, f + 5.0)) * 0.3 + vec3(0.0, 0.33, 0.67))), 0.5);
      c += sc * br * uStars.x * smoothstep(-0.05, 0.12, uph);
    }
  }
#endif
#ifndef ECO_BAKE
  // Сонця — за всім, потім місяці й компаньйон (з CPU — від дальшого до ближчого) — непрозорі: закривають сонця, зорі
  // й одне одного; перед тілом — лише світло неба (c0: розсіяне повітрям між оком і тілом — удень тіло бліде). Ореол
  // сонця — розсіяння в атмосфері, тож поверх тіл (сила — яскравість сонця з затемненням: закрите — без ореолу); кільця
  // планети, сяйва й метеори — теж ближче, далі. До 13.10.2026 тіло вдень було напівпрозорим, а на диску сонця —
  // непрозорим: крізь компаньйон проступав контур сонця
  vec3 glow = vec3(0.0);
  float hide = 1.0 - cover * 0.85;
  for (int i = 0; i < 3; i++) {
    if (i >= uNSun) break;
    float cs = dot(d, uSun[i].xyz), s = uSun[i].w, th2 = max(0.0, 2.0 * (1.0 - cs));
    float disk = 1.0 - smoothstep(0.85, 1.1, ecoDisk(d, uSun[i].xyz, s).w);
    vec3 sc = uSunCol[i].rgb;
    c = mix(c, sc / max(max(sc.r, sc.g), max(sc.b, 0.001)), disk * hide);
    glow += sc * uSunCol[i].a * (exp(-th2 / (s * s * 9.0)) * 0.45 * hide + exp(-th2 / (s * s * 90.0)) * 0.12);
  }
  for (int i = 0; i < 4; i++) {
    if (i >= uNMoon) break;
    vec4 e = ecoDisk(d, uMoon[i].xyz, uMoon[i].w);
    if (e.w < 1.0) {
      vec3 n = ecoBodyN(e.xyz, uMoon[i].xyz, uMoon[i].w, e.w), fa = uMoonA[i].xyz, fb = uMoonB[i].xyz;
      vec3 nb = vec3(dot(n, fb), dot(n, cross(fa, fb)), dot(n, fa));   // нормаль у системі тіла: візерунок обертається з ним
      float ty = uMoonCol[i].a;
      vec3 mc = uMoonCol[i].rgb;
      if (ty > 0.5 && ty < 1.5) mc = mix(mc, uMoon2[i].rgb, smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(nb.z * 16.0 + ecoFbm(nb.xy * 4.0 + nb.z * 3.0) * 2.5)));
      else if (ty > 1.5 && ty < 2.5) mc = mix(mc, uMoon2[i].rgb, smoothstep(0.48, 0.56, ecoFbm(nb.xy * 3.0 + nb.z * 5.0 + 3.0)));
      else if (ty > 2.5) mc = mix(mc, uMoon2[i].rgb, 0.4 * smoothstep(0.45, 0.65, ecoFbm(nb.xy * 6.0 + nb.z * 2.0)));
      // освітлення всіма сонцями (14.10.2026): кожне — своїм кольором і яскравістю поза нашим повітрям (uSunSp) зі свого
      // боку; тінь планети від кожного — циліндр радіусом Rp уздовж напряму на сонце. Точка тіла (у радіусах тіла від ока)
      // — Dm·o + n, центр планети — під оком на Rp; t — глибина за планетою, r — відстань від осі тіні; півтінь —
      // ±t·(масштаб тіла × справжній кутовий радіус сонця) (не вужча за піксель); затемнення — від краю півтіні до тіні,
      // глибше за вершину конуса тіні — частка (Rp / w)²; світло в тіні — заломлене повітрям (uSunSh). Внески — лінійна
      // сума (одне біле сонце — як до 14.10.2026). Rp, Dm — з CPU (uMoon2.a, uMoonB.w): на піксель і сонце — кілька множень
      float Dm = uMoonB[i].w, Rp = uMoon2[i].a;
      vec3 Q = Dm * uMoon[i].xyz + n + vec3(0.0, 0.0, Rp), E = vec3(0.0);
      for (int k = 0; k < 3; k++) {
        if (k >= uNSun) break;
        vec3 sd = uSun[k].xyz;
        float lit = smoothstep(-0.05, 0.15, dot(n, sd));
        if (lit <= 0.0) continue;
        float t = -dot(Q, sd), r = length(Q + t * sd), w = max(t * uMoonA[i].w * uSunSp[k].w, 0.002 * Dm);
        float sha = t > 0.0 ? smoothstep(0.0, 1.0, (Rp + w - r) / (2.0 * max(min(Rp, w), 1e-6))) * min(1.0, Rp * Rp / (w * w)) : 0.0;
        E += pow(uSunSp[k].rgb * lit * mix(vec3(1.0), uSunSh[k].rgb, sha), vec3(2.2));
      }
      c = mix(c, mix(c0, mc * (0.14 + 0.86 * pow(E, vec3(1.0 / 2.2))), 1.0 - 0.45 * uDay), ecoEdge(e.w, uMoon[i].w));
    }
  }
  c += glow;
#endif
  if (uRing.z > 0.0) {
    float dp = dot(d, uPole);
    if (abs(dp) > 1e-4) {
      float t = -uPole.z / dp;
      if (t > 0.0) {
        float r = length(vec3(0.0, 0.0, 1.0) + t * d);
        if (r > uRing.x && r < uRing.y) {
          float u = (r - uRing.x) / (uRing.y - uRing.x);
          float band = 0.5 + 0.5 * sin(u * uRing.w * 6.2831 + 1.3) * (0.6 + 0.4 * sin(u * uRing.w * 2.3));
          float al = uRing.z * band * smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.94, 1.0, u)) * smoothstep(-0.03, 0.04, uph);
          c = mix(c, uRingCol * (0.3 + 0.7 * uDay) + uDusk.rgb * uDusk.a * 0.2, al);
        }
      }
    }
  }
#ifndef ECO_BAKE
  if (uAur.z > 0.01 && up > 0.0) {
    // Завіси в шарі ~100–255 км над планетою радіуса uAurG.y (км): промінь з ока перетинає сферу R + h на відстані
    // t(h) = √(b² + 2Rh + h²) − b, b = R·up. Візерунок задано на «підніжжі» — точці, звідки силова лінія (нахил ~78°:
    // на висоті h зсув 0,2·h до екватора) піднялась на h, тож вертикальні промені завіс у перспективі сходяться до
    // магнітного зеніту (корона над головою), а не в зеніті. Поперек овалу (s, км від середини, + до полюса) — дуги
    // кожні 90 км у межах півширини uAurG.z, зігнуті складками (~300–700 км); уздовж (w) — яскравість дуг (~250 км),
    // нижній край (100–118 км) і промені (~2 км). Вигин, яскравість і край — раз на промінь у підніжжі на 120 км (великі
    // масштаби); 10 кроків по висоті з тремтінням, густіше внизу (h = 95 + 160·u²: світіння — біля нижнього краю);
    // довжина шляху в шарі — dt/dh = (R + h)/√…, ≤ 6 (біля обрію сяйво яскравіше). Дуга чи промінь, які промінь за крок
    // проходить наскрізь, — їхнім середнім (0,161 і 0,38): без цього тонкі завіси на пологих променях — зерно тремтіння.
    // Промінь, що на висотах 95, 150 і 255 км далі від овалу, ніж 1,5 півширини + 30 км, — без кроків (сяйво — смуга неба). До 13.10.2026 — візерунок за азимутом і висотою на небі: над головою сектори
    // сходились в ідеальну зірку в зеніті, на азимуті ±π — шов
    vec2 pd = uAur.xy, qd = vec2(-pd.y, pd.x);
    float R = uAurG.y, W = uAurG.z, b = R * up, tm = uAur.w;
    vec2 f0 = d.xy * (sqrt(b * b + 240.0 * R + 14400.0) - b) + pd * 4.0;
    float w0 = dot(f0, qd);
    float warp = (ecoNoise(vec2(w0 / 700.0 + tm * 0.01, 5.3)) * 0.65 + ecoNoise(vec2(w0 / 300.0 - tm * 0.02, 9.1)) * 0.35 - 0.5) * W;
    float bright = 0.25 + 0.75 * smoothstep(0.25, 0.7, ecoNoise(vec2(w0 / 250.0 + tm * 0.02, 2.1)));
    float hb = 100.0 + 18.0 * ecoN1(w0 / 40.0 + tm * 0.05), j = ecoHashN(d.xy * 1543.0 + d.z * 3571.0), acc = 0.0, top = 0.0;
    float pp = dot(d.xy, pd), s0 = pp * (sqrt(b * b + 190.0 * R + 9025.0) - b) - uAurG.x, s1 = pp * (sqrt(b * b + 300.0 * R + 22500.0) - b) + 10.0 - uAurG.x;
    float s2 = pp * (sqrt(b * b + 510.0 * R + 65025.0) - b) + 31.0 - uAurG.x, sm = W * 1.5 + 30.0;
    if (min(min(s0, s1), s2) < sm && max(max(s0, s1), s2) > -sm) for (int i = 0; i < 10; i++) {
      float u = (float(i) + j) * 0.1, h = 95.0 + 160.0 * u * u, dh = 32.0 * u, q = sqrt(b * b + 2.0 * R * h + h * h);
      vec2 f = d.xy * (q - b) + pd * (h - 100.0) * 0.2;
      float sc = dot(f, pd) - uAurG.x, env = 1.0 - smoothstep(W * 0.5, W * 1.5, abs(sc));
      if (env <= 0.0) continue;
      float dt = (R + h) / q, ray = ecoN1(dot(f, qd) / 2.0 + tm * 0.1);
      float arc = mix(pow(0.5 + 0.5 * cos((sc + warp) * 0.0698), 12.0), 0.161, smoothstep(6.0, 25.0, abs((pp * dt + 0.2) * dh)));
      ray = mix(0.12 + 0.88 * ray * ray, 0.38, smoothstep(2.0, 8.0, abs(dot(d.xy, qd) * dt * dh)));
      float e = env * arc * ray * smoothstep(hb - 5.0, hb + 5.0, h) * exp(-(h - hb) / 45.0) * min(dt, 6.0) * dh * 0.1;
      acc += e; top += e * smoothstep(170.0, 240.0, h);
    }
    float a = (1.0 - exp(-acc * 2.0)) * bright * uAur.z * smoothstep(0.0, 0.06, up);
    c += mix(uAurCol, uAurCol.gbr * 0.8, top / max(acc, 1e-4)) * a * 0.9;
  }
  for (int i = 0; i < 4; i++) {
    if (i >= uNMet || uph < 0.0) break;
    vec3 a = normalize(uMet[i].xyz), b = normalize(uMetB[i].xyz);
    float t = uMet[i].w;
    vec3 hd = normalize(mix(a, b, t)), tl = normalize(mix(a, b, max(0.0, t - 0.35))), ab = hd - tl;
    float s = clamp(dot(d - tl, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0), dist = length(d - (tl + ab * s));
    c += vec3(1.0, 0.95, 0.85) * uMetB[i].w * s * (1.0 - t * t) * (1.0 - smoothstep(0.0, 0.003, dist)) * smoothstep(0.0, 0.1, uph);
  }
  // нижче справжнього обрію — планета за краєм далечі, у тумані (колір туману — обрій, js/sky.js): закриває все небо разом —
  // і тіла (до 14.10.2026 кожне тіло окремо: у смузі обрію крізь напівпрозорий компаньйон світило сонце), і заграву
  c = mix(uHor, c, above);
#endif
  if (cover > 0.0) {
    float sh = 1.0 - uCloud.w * smoothstep(0.3, 1.0, cover);
    c = mix(c, uCloudCol * sh + uDusk.rgb * uDusk.a * 0.25, cover * 0.92);
  }
#ifdef ECO_BAKE
  if (up < 0.0) c = uHor * 0.3;
  return pow(max(c, vec3(0.02)), vec3(2.2)) * eco_bakeK;   // не нуль: чорне небо без повітря — розсіяне з калібрування (scene.js)
#else
  c += vec3(0.85, 0.88, 1.0) * uFlash * (0.5 + 0.5 * cover);
  return pow(max(c, vec3(0.0)), vec3(2.2));
#endif
}
`;

// WGSL: ecoSs — smoothstep, що допускає зворотні межі (вбудований при edge0 ≥ edge1 невизначений — у GLSL-гілці
// там 1 − smoothstep з прямими межами)
export const SKY_WGSL = `
uniform uZen: vec3f;
uniform uHor: vec3f;
uniform uDuskDir: vec3f;
uniform uDusk: vec4f;
uniform uSun: array<vec4f, 3>;
uniform uSunCol: array<vec4f, 3>;
uniform uSunSp: array<vec4f, 3>;
uniform uSunSh: array<vec4f, 3>;
uniform uMoon: array<vec4f, 4>;
uniform uMoonCol: array<vec4f, 4>;
uniform uMoon2: array<vec4f, 4>;
uniform uMoonA: array<vec4f, 4>;
uniform uMoonB: array<vec4f, 4>;
uniform uNSun: i32;
uniform uNMoon: i32;
uniform uDay: f32;
uniform uStars: vec2f;
uniform uCel: mat3x3f;
uniform uRing: vec4f;
uniform uRingCol: vec3f;
uniform uPole: vec3f;
uniform uCloud: vec4f;
uniform uCloudCol: vec3f;
uniform uFlash: f32;
uniform uAur: vec4f;
uniform uAurCol: vec3f;
uniform uAurG: vec4f;
uniform uFwd: vec3f;
uniform uCloudC: vec4f;
uniform uMet: array<vec4f, 4>;
uniform uMetB: array<vec4f, 4>;
uniform uNMet: i32;
uniform eco_bakeK: f32;
uniform uHz: array<vec4f, 4>;
var uCloudMap: texture_2d<f32>;
var uCloudMapSampler: sampler;
fn ecoHash(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 45.164))) * 43758.5453); }
fn ecoHashN(p: vec2f) -> f32 {
  let m = p - floor(p / 256.0) * 256.0;
  var q = fract(m.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn ecoNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = ecoHashN(i);
  let b = ecoHashN(i + vec2f(1.0, 0.0));
  let c = ecoHashN(i + vec2f(0.0, 1.0));
  let d = ecoHashN(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn ecoFbm(p0: vec2f) -> f32 {
  var p = p0;
  var v = 0.0;
  var a = 0.5;
  for (var i = 0; i < 5; i++) { v += a * ecoNoise(p); p = p * 2.0 + 17.0; a *= 0.5; }
  return v;
}
fn ecoSs(e0: f32, e1: f32, x: f32) -> f32 { let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn ecoN1(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  return mix(ecoHashN(vec2f(i, 3.7)), ecoHashN(vec2f(i + 1.0, 3.7)), f * f * (3.0 - 2.0 * f));
}
// Диск світила (o — центр, s — кутовий радіус): xyz — напрям e, у якому шукати точку тіла, w — l2 = sin²θ / sin²s (θ — кут
// e від центру; 1 — край, > 1 — поза). Великі тіла (компаньйон, s > 0,25) — справжня куля: e = d, вигляд не залежить від
// того, куди дивишся (13.10.2026, скарга: смуги й освітлена частина компаньйона радіусом 54° «пливли» з поглядом —
// білборд такого розміру росте й ковзає відносно ландшафту). Малі (сонця, місяці, s < 0,15) — «білборд», паралельний
// площині кадру (uFwd — погляд камери): прямолінійна перспектива на краях кадру розтягує диск за кутом у 1/cos θ разів
// уздовж радіуса екрана, а білборд у кадрі — завжди коло; e — напрям, що дав би той самий зсув, якби дивились прямо на
// тіло (зсув у площині, повернутий з uFwd на o). Центр далі ~65° від осі (поза кадром) — плавно до справжньої кулі.
// Білборд не виходить за кутовий радіус диска (упоперек — рівно s, уздовж — менше), тож далі 1,3·s — одразу «поза»
fn ecoDisk(d: vec3f, o: vec3f, s: f32) -> vec4f {
  let co = dot(d, o);
  let fo = dot(o, uniform.uFwd);
  if (co < cos(min(s * 1.3, 1.55))) { return vec4f(d, 2.0); }
  var e = d;
  let w = ecoSs(0.2, 0.45, fo) * ecoSs(0.25, 0.15, s);
  if (w > 0.0) {
    var q = d * (fo / max(dot(d, uniform.uFwd), 1e-4)) - o;
    q -= dot(q, o) / (1.0 + fo) * (uniform.uFwd + o);
    e = normalize(mix(d, normalize(o + q), w));
  }
  let ce = dot(e, o);
  let ss = sin(s);
  return vec4f(e, select(2.0, (1.0 - ce * ce) / (ss * ss), ce > 0.0));
}
// Нормаль кулі в точці, де її перетинає промінь e (l2 < 1): відстань до центру D = 1 / sin s (радіусів), перетин
// t = D·cos θ − √(1 − l2) — видно лише ковпак до 90° − s від центру (у велетня — не півкулю)
fn ecoBodyN(e: vec3f, o: vec3f, s: f32, l2: f32) -> vec3f {
  let D = 1.0 / sin(s);
  return normalize((D * dot(e, o) - sqrt(max(0.0, 1.0 - l2))) * e - D * o);
}
fn ecoEdge(l2: f32, s: f32) -> f32 { return ecoSs(0.0, 0.05 * min(s, 0.15), s - asin(min(1.0, sqrt(l2) * sin(s)))); }
// справжній обрій (як у GLSL)
fn ecoHzK(k: i32) -> f32 { return uniform.uHz[k / 4][k % 4]; }
fn ecoHz(d: vec3f) -> f32 {
  let a = atan2(d.y, select(d.x, 1.0, abs(d.x) + abs(d.y) < 1e-7)) * 2.5464791 + 16.0;
  let i = floor(a);
  let k = i32(i) % 16;
  return mix(ecoHzK(k), ecoHzK((k + 1) % 16), a - i);
}
fn ecoSky(d: vec3f) -> vec3f {
  let up = d.z;
#ifdef ECO_BAKE
  let uph = up;
#else
  let uph = up + ecoHz(d);
#endif
  let above = ecoSs(-0.02, 0.01, uph);
  var c: vec3f = select(mix(uniform.uHor, uniform.uZen, ecoSs(0.0, 0.55, uph)), uniform.uHor * (1.0 + uph * 0.35), uph < 0.0);
  let g = max(dot(d, uniform.uDuskDir), 0.0);
  c += uniform.uDusk.rgb * uniform.uDusk.a * (pow(g, 5.0) * 0.6 + pow(g, 40.0) * 0.4) * ecoSs(-0.25, 0.05, uph);
#ifndef ECO_BAKE
  let c0 = c;
#endif
  var cover = 0.0;
  if (uniform.uCloud.x > 0.01 && up > 0.0) {
    let cp = uniform.uCloudC.xy + d.xy * (uniform.uCloudC.w / max(up, 0.03));
    let cov = textureSampleLevel(uCloudMap, uCloudMapSampler, cp / (length(cp) + uniform.uCloudC.z) * 0.5 + 0.5, 0.0).r;
    let cuv = d.xy / (up + 0.08) * 0.9 + uniform.uCloud.yz;
    let f = ecoFbm(cuv);
    cover = select(0.0, ecoSs(1.02 - cov * 0.75, 1.25 - cov * 0.7, f + 0.25) * ecoSs(0.0, 0.12, up), cov > 0.01);
  }
#ifndef ECO_BAKE
  if (uniform.uStars.x > 0.01 && uph > -0.05) {
    let q = d * uniform.uCel;
    let aq = abs(q);
    var uv: vec2f;
    var f: f32;
    if (aq.x >= aq.y && aq.x >= aq.z) { uv = q.yz / aq.x; f = sign(q.x); }
    else if (aq.y >= aq.z) { uv = q.xz / aq.y; f = 2.0 + sign(q.y); }
    else { uv = q.xy / aq.z; f = 4.0 + sign(q.z); }
    uv *= 90.0;
    let cell = floor(uv);
    if (ecoHash(vec3f(cell, f)) > 1.0 - 0.07 * uniform.uStars.x) {
      let ctr = cell + 0.25 + 0.5 * vec2f(ecoHash(vec3f(cell, f + 7.0)), ecoHash(vec3f(cell, f + 13.0)));
      let br = ecoSs(0.34, 0.0, length(uv - ctr)) * (0.35 + 0.65 * ecoHash(vec3f(cell, f + 3.0)));
      let sc = mix(vec3f(1.0), 0.55 + 0.45 * cos(6.2831 * (uniform.uStars.y + ecoHash(vec3f(cell, f + 5.0)) * 0.3 + vec3f(0.0, 0.33, 0.67))), 0.5);
      c += sc * br * uniform.uStars.x * ecoSs(-0.05, 0.12, uph);
    }
  }
#endif
#ifndef ECO_BAKE
  // сонця за всім, тіла непрозорі над небом без зір (c0), ореол сонця — поверх (як у GLSL)
  var glow = vec3f(0.0);
  let hide = 1.0 - cover * 0.85;
  for (var i = 0; i < 3; i++) {
    if (i >= uniform.uNSun) { break; }
    let su = uniform.uSun[i];
    let cs = dot(d, su.xyz);
    let s = su.w;
    let th2 = max(0.0, 2.0 * (1.0 - cs));
    let disk = ecoSs(1.1, 0.85, ecoDisk(d, su.xyz, s).w);
    let sc = uniform.uSunCol[i].rgb;
    c = mix(c, sc / max(max(sc.r, sc.g), max(sc.b, 0.001)), disk * hide);
    glow += sc * uniform.uSunCol[i].a * (exp(-th2 / (s * s * 9.0)) * 0.45 * hide + exp(-th2 / (s * s * 90.0)) * 0.12);
  }
  for (var i = 0; i < 4; i++) {
    if (i >= uniform.uNMoon) { break; }
    let mo = uniform.uMoon[i];
    let e = ecoDisk(d, mo.xyz, mo.w);
    if (e.w < 1.0) {
      let n = ecoBodyN(e.xyz, mo.xyz, mo.w, e.w);
      let fa = uniform.uMoonA[i].xyz;
      let fb = uniform.uMoonB[i].xyz;
      let nb = vec3f(dot(n, fb), dot(n, cross(fa, fb)), dot(n, fa));
      let ty = uniform.uMoonCol[i].a;
      let m2 = uniform.uMoon2[i];
      var mc = uniform.uMoonCol[i].rgb;
      if (ty > 0.5 && ty < 1.5) { mc = mix(mc, m2.rgb, ecoSs(0.3, 0.7, 0.5 + 0.5 * sin(nb.z * 16.0 + ecoFbm(nb.xy * 4.0 + nb.z * 3.0) * 2.5))); }
      else if (ty > 1.5 && ty < 2.5) { mc = mix(mc, m2.rgb, ecoSs(0.48, 0.56, ecoFbm(nb.xy * 3.0 + nb.z * 5.0 + 3.0))); }
      else if (ty > 2.5) { mc = mix(mc, m2.rgb, 0.4 * ecoSs(0.45, 0.65, ecoFbm(nb.xy * 6.0 + nb.z * 2.0))); }
      // освітлення всіма сонцями й тінь планети від кожного (як у GLSL)
      let Dm = uniform.uMoonB[i].w;
      let Rp = m2.a;
      let Q = Dm * mo.xyz + n + vec3f(0.0, 0.0, Rp);
      var E = vec3f(0.0);
      for (var k = 0; k < 3; k++) {
        if (k >= uniform.uNSun) { break; }
        let sd = uniform.uSun[k].xyz;
        let lit = ecoSs(-0.05, 0.15, dot(n, sd));
        if (lit <= 0.0) { continue; }
        let t = -dot(Q, sd);
        let r = length(Q + t * sd);
        let w = max(t * uniform.uMoonA[i].w * uniform.uSunSp[k].w, 0.002 * Dm);
        var sha = 0.0;
        if (t > 0.0) { sha = smoothstep(0.0, 1.0, (Rp + w - r) / (2.0 * max(min(Rp, w), 1e-6))) * min(1.0, Rp * Rp / (w * w)); }
        E += pow(uniform.uSunSp[k].rgb * lit * mix(vec3f(1.0), uniform.uSunSh[k].rgb, sha), vec3f(2.2));
      }
      c = mix(c, mix(c0, mc * (0.14 + 0.86 * pow(E, vec3f(1.0 / 2.2))), 1.0 - 0.45 * uniform.uDay), ecoEdge(e.w, mo.w));
    }
  }
  c += glow;
#endif
  if (uniform.uRing.z > 0.0) {
    let dp = dot(d, uniform.uPole);
    if (abs(dp) > 1e-4) {
      let t = -uniform.uPole.z / dp;
      if (t > 0.0) {
        let r = length(vec3f(0.0, 0.0, 1.0) + t * d);
        if (r > uniform.uRing.x && r < uniform.uRing.y) {
          let u = (r - uniform.uRing.x) / (uniform.uRing.y - uniform.uRing.x);
          let band = 0.5 + 0.5 * sin(u * uniform.uRing.w * 6.2831 + 1.3) * (0.6 + 0.4 * sin(u * uniform.uRing.w * 2.3));
          let al = uniform.uRing.z * band * ecoSs(0.0, 0.06, u) * ecoSs(1.0, 0.94, u) * ecoSs(-0.03, 0.04, uph);
          c = mix(c, uniform.uRingCol * (0.3 + 0.7 * uniform.uDay) + uniform.uDusk.rgb * uniform.uDusk.a * 0.2, al);
        }
      }
    }
  }
#ifndef ECO_BAKE
  if (uniform.uAur.z > 0.01 && up > 0.0) {
    // Завіси в шарі ~100–255 км над планетою радіуса uAurG.y (км): промінь з ока перетинає сферу R + h на відстані
    // t(h) = √(b² + 2Rh + h²) − b, b = R·up. Візерунок задано на «підніжжі» — точці, звідки силова лінія (нахил ~78°:
    // на висоті h зсув 0,2·h до екватора) піднялась на h, тож вертикальні промені завіс у перспективі сходяться до
    // магнітного зеніту (корона над головою), а не в зеніті. Поперек овалу (s, км від середини, + до полюса) — дуги
    // кожні 90 км у межах півширини uAurG.z, зігнуті складками (~300–700 км); уздовж (w) — яскравість дуг (~250 км),
    // нижній край (100–118 км) і промені (~2 км). Вигин, яскравість і край — раз на промінь у підніжжі на 120 км (великі
    // масштаби); 10 кроків по висоті з тремтінням, густіше внизу (h = 95 + 160·u²: світіння — біля нижнього краю);
    // довжина шляху в шарі — dt/dh = (R + h)/√…, ≤ 6 (біля обрію сяйво яскравіше). Дуга чи промінь, які промінь за крок
    // проходить наскрізь, — їхнім середнім (0,161 і 0,38): без цього тонкі завіси на пологих променях — зерно тремтіння.
    // Промінь, що на висотах 95, 150 і 255 км далі від овалу, ніж 1,5 півширини + 30 км, — без кроків (сяйво — смуга неба). До 13.10.2026 — візерунок за азимутом і висотою на небі: над головою сектори
    // сходились в ідеальну зірку в зеніті, на азимуті ±π — шов
    let pd = uniform.uAur.xy;
    let qd = vec2f(-pd.y, pd.x);
    let R = uniform.uAurG.y;
    let W = uniform.uAurG.z;
    let b = R * up;
    let tm = uniform.uAur.w;
    let f0 = d.xy * (sqrt(b * b + 240.0 * R + 14400.0) - b) + pd * 4.0;
    let w0 = dot(f0, qd);
    let warp = (ecoNoise(vec2f(w0 / 700.0 + tm * 0.01, 5.3)) * 0.65 + ecoNoise(vec2f(w0 / 300.0 - tm * 0.02, 9.1)) * 0.35 - 0.5) * W;
    let bright = 0.25 + 0.75 * ecoSs(0.25, 0.7, ecoNoise(vec2f(w0 / 250.0 + tm * 0.02, 2.1)));
    let hb = 100.0 + 18.0 * ecoN1(w0 / 40.0 + tm * 0.05);
    let j = ecoHashN(d.xy * 1543.0 + d.z * 3571.0);
    var acc = 0.0;
    var top = 0.0;
    let pp = dot(d.xy, pd);
    let s0 = pp * (sqrt(b * b + 190.0 * R + 9025.0) - b) - uniform.uAurG.x;
    let s1 = pp * (sqrt(b * b + 300.0 * R + 22500.0) - b) + 10.0 - uniform.uAurG.x;
    let s2 = pp * (sqrt(b * b + 510.0 * R + 65025.0) - b) + 31.0 - uniform.uAurG.x;
    let sm = W * 1.5 + 30.0;
    if (min(min(s0, s1), s2) < sm && max(max(s0, s1), s2) > -sm) {
      for (var i = 0; i < 10; i++) {
        let u = (f32(i) + j) * 0.1;
        let h = 95.0 + 160.0 * u * u;
        let dh = 32.0 * u;
        let q = sqrt(b * b + 2.0 * R * h + h * h);
        let f = d.xy * (q - b) + pd * (h - 100.0) * 0.2;
        let sc = dot(f, pd) - uniform.uAurG.x;
        let env = ecoSs(W * 1.5, W * 0.5, abs(sc));
        if (env <= 0.0) { continue; }
        let dt = (R + h) / q;
        let arc = mix(pow(0.5 + 0.5 * cos((sc + warp) * 0.0698), 12.0), 0.161, ecoSs(6.0, 25.0, abs((pp * dt + 0.2) * dh)));
        let r0 = ecoN1(dot(f, qd) / 2.0 + tm * 0.1);
        let ray = mix(0.12 + 0.88 * r0 * r0, 0.38, ecoSs(2.0, 8.0, abs(dot(d.xy, qd) * dt * dh)));
        let e = env * arc * ray * ecoSs(hb - 5.0, hb + 5.0, h) * exp(-(h - hb) / 45.0) * min(dt, 6.0) * dh * 0.1;
        acc += e;
        top += e * ecoSs(170.0, 240.0, h);
      }
    }
    let a = (1.0 - exp(-acc * 2.0)) * bright * uniform.uAur.z * ecoSs(0.0, 0.06, up);
    c += mix(uniform.uAurCol, uniform.uAurCol.gbr * 0.8, top / max(acc, 1e-4)) * a * 0.9;
  }
  for (var i = 0; i < 4; i++) {
    if (i >= uniform.uNMet || uph < 0.0) { break; }
    let a = normalize(uniform.uMet[i].xyz);
    let b = normalize(uniform.uMetB[i].xyz);
    let t = uniform.uMet[i].w;
    let hd = normalize(mix(a, b, t));
    let tl = normalize(mix(a, b, max(0.0, t - 0.35)));
    let ab = hd - tl;
    let s = clamp(dot(d - tl, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    let dist = length(d - (tl + ab * s));
    c += vec3f(1.0, 0.95, 0.85) * uniform.uMetB[i].w * s * (1.0 - t * t) * ecoSs(0.003, 0.0, dist) * ecoSs(0.0, 0.1, uph);
  }
  c = mix(uniform.uHor, c, above);        // нижче справжнього обрію — планета в тумані (як у GLSL)
#endif
  if (cover > 0.0) {
    let sh = 1.0 - uniform.uCloud.w * ecoSs(0.3, 1.0, cover);
    c = mix(c, uniform.uCloudCol * sh + uniform.uDusk.rgb * uniform.uDusk.a * 0.25, cover * 0.92);
  }
#ifdef ECO_BAKE
  if (up < 0.0) { c = uniform.uHor * 0.3; }
  return pow(max(c, vec3f(0.02)), vec3f(2.2)) * uniform.eco_bakeK;
#else
  c += vec3f(0.85, 0.88, 1.0) * uniform.uFlash * (0.5 + 0.5 * cover);
  return pow(max(c, vec3f(0.0)), vec3f(2.2));
#endif
}
`;
