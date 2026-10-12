// js/engine/graphics/occluder.js — програмне відсікання закритого (як «Culling the Battlefield» Frostbite, Intel Masked
// Occlusion Culling, програмне відсікання Unreal на мобільних): заслони — опуклі пласкі багатокутники всередині
// непрозорого, яке малюється, — растеризуються на процесорі в грубий буфер оберненої глибини (1/w); коробки
// перевіряються проти піраміди мінімумів. Без затримки кадру й без зчитування з відеокарти. Обережно (не сховає
// видимого): коробка закрита, лише якщо її найближча точка далі за найдальший заслін над усім її прямокутником.
// Заслони лежать усередині непрозорого з запасом margin по кожній осі: коробка навколо будь-якої точки заслону з
// півсторонами margin — уся в непрозорому. Клітинка буфера отримує глибину заслону двома способами:
// – ближче безпечної відстані — за центром клітинки (без щілин між сусідніми заслонами): промінь через будь-яку точку
//   клітинки на глибині центрального влучання зсунутий від нього менше за запас — усередині непрозорого, тож уже
//   перекритий. Безпечна відстань — де клітинка на глибині d вужча за запас;
// – далі — лише якщо заслін покриває клітинку цілком, найдальшим значенням над нею (на стику сусідніх заслонів
//   клітинка не записується — тож заслони краще великі, js/gen/vis.js).
// Кривизна (вершинний шейдер опускає світ на c·d², d — відстань по горизонталі від цілі камери): вершини заслонів
// опускаємо так само (великі заслони ділимо, щоб прогин між вершинами був малий), коробки — нижній край на c·d²max,
// верхній — на c·d²min; запас по вертикалі менший на прогин заслонів (SAG), прогин трикутників, що малюються (edge —
// найдовше їхнє ребро: між вершинами шейдер опускає лінійно), і для центру клітинки — на різницю опускання в її межах.
// Без залежностей від гри.
const NEAR = 0.01;                  // площина відсічення (м перед оком): ближче — коробка видима, заслін обрізано
const SAG = 0.01;                   // найбільший прогин заслону від кривизни між його вершинами (м); більший — ділимо
const TOL = 1e-7;                   // центр на спільному ребрі двох заслонів — у обох (без щілин)
const TS = 3;                       // плитки 8 × 8 клітинок (зсув)

// margin — запас заслонів усередині непрозорого по осях x, y, z (м); edge — найдовше ребро трикутників, що малюються (м)
export function createOccluder({ width = 256, maxHeight = 256, margin = [0, 0, 0], edge = 0 } = {}) {
  let GW = width, GH = 128, buf = new Float32Array(GW * GH);
  const lv = [];                    // піраміда: [{w, h, a}] — рівень 0 — сам buf
  let O = null, BC = 0, TX = 0, TY = 0, on = false, iwSafe = Infinity;
  const M = new Float64Array(16);
  // плитки 8 × 8 клітинок (TS): найдальший заслін у плитці (перевірка секцій і заслонів під час растеризації — спереду
  // назад; дрібніші плитки — точніше, а перерахунок зміненої дешевший: на 16 × 16 заслонів растеризувалось на 5–10 % більше)
  let TW = 0, TH = 0, tmin = new Float32Array(0), tdirty = new Uint8Array(0);
  const st = { polys: 0, hid: 0, drawn: 0, texels: 0, boxes: 0, culled: 0, ms: 0, safe: 0 };   // hid — заслони, уже закриті
  // багатокутник (до 8 вершин) у кліпі: 0…7 — вершини, 8…16 — після відсічення (на одну більше); на екрані; ребра
  const CX = new Float64Array(17), CY = new Float64Array(17), CW = new Float64Array(17);
  const SX = new Float64Array(9), SY = new Float64Array(9), SW = new Float64Array(9);
  const LP = new Float64Array(9), LQ = new Float64Array(9), LF = new Float64Array(9), RP = new Float64Array(9), RQ = new Float64Array(9), RF = new Float64Array(9), EB = new Float64Array(9), EC = new Float64Array(9);

  // Коробка світу (з кривизною) → прямокутник NDC і найменша глибина в BX = [x0, y0, x1, y1, w]: 1 — у кадрі, 0 — поза
  // кадром (усі 8 кутів з одного боку якоїсь площини піраміди: у кліп-просторі площини лінійні, тож і для кутів за
  // оком), −1 — частина ближче NEAR (біля ока); only — лише код, без прямокутника
  const BX = new Float64Array(5);
  // Код за кутом (X0, Y0, W0) і ребрами коробки в кліп-просторі (кут — кут (x0, y0, z0) плюс ребра): поза кадром —
  // X + W < 0 (ліворуч), W − X < 0, Y + W < 0, W − Y < 0 чи W < NEAR у всіх кутах; найбільше й найменше лінійної функції
  // по кутах — без перебору (основа плюс додатні чи від'ємні внески ребер)
  function code(X0, Y0, W0, Xx, Yx, Wx, Xy, Yy, Wy, Xz, Yz, Wz) {
    let a = Xx + Wx, b = Xy + Wy, c = Xz + Wz;
    if (X0 + W0 + (a > 0 ? a : 0) + (b > 0 ? b : 0) + (c > 0 ? c : 0) < 0) return 0;
    a = Wx - Xx; b = Wy - Xy; c = Wz - Xz;
    if (W0 - X0 + (a > 0 ? a : 0) + (b > 0 ? b : 0) + (c > 0 ? c : 0) < 0) return 0;
    a = Yx + Wx; b = Yy + Wy; c = Yz + Wz;
    if (Y0 + W0 + (a > 0 ? a : 0) + (b > 0 ? b : 0) + (c > 0 ? c : 0) < 0) return 0;
    a = Wx - Yx; b = Wy - Yy; c = Wz - Yz;
    if (W0 - Y0 + (a > 0 ? a : 0) + (b > 0 ? b : 0) + (c > 0 ? c : 0) < 0) return 0;
    if (W0 + (Wx > 0 ? Wx : 0) + (Wy > 0 ? Wy : 0) + (Wz > 0 ? Wz : 0) < NEAR) return 0;
    return W0 + (Wx < 0 ? Wx : 0) + (Wy < 0 ? Wy : 0) + (Wz < 0 ? Wz : 0) < NEAR ? -1 : 1;
  }
  function rectOf(x0, y0, z0, x1, y1, z1, only = false) {
    if (BC > 0) {
      const ax = x0 - TX, bx = x1 - TX, ay = y0 - TY, by = y1 - TY;
      const nx = ax > 0 ? ax : bx < 0 ? -bx : 0, ny = ay > 0 ? ay : by < 0 ? -by : 0, fx = ax < -bx ? -ax : bx, fy = ay < -by ? -ay : by;
      z0 -= BC * (fx * fx + fy * fy); z1 -= BC * (nx * nx + ny * ny);
    }
    const x = x0 - O[0], y = y0 - O[1], z = z0 - O[2], dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const X0 = M[0] * x + M[4] * y + M[8] * z + M[12], Y0 = M[1] * x + M[5] * y + M[9] * z + M[13], W0 = M[3] * x + M[7] * y + M[11] * z + M[15];
    const Xx = M[0] * dx, Yx = M[1] * dx, Wx = M[3] * dx, Xy = M[4] * dy, Yy = M[5] * dy, Wy = M[7] * dy, Xz = M[8] * dz, Yz = M[9] * dz, Wz = M[11] * dz;
    const r = code(X0, Y0, W0, Xx, Yx, Wx, Xy, Yy, Wy, Xz, Yz, Wz);
    if (r <= 0 || only) return r;
    let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      let X = X0, Y = Y0, W = W0;
      if (k & 1) { X += Xx; Y += Yx; W += Wx; }
      if (k & 2) { X += Xy; Y += Yy; W += Wy; }
      if (k & 4) { X += Xz; Y += Yz; W += Wz; }
      const iw = 1 / W, sx = X * iw, sy = Y * iw;
      if (sx < sx0) sx0 = sx; if (sx > sx1) sx1 = sx; if (sy < sy0) sy0 = sy; if (sy > sy1) sy1 = sy;
    }
    if (sx1 < -1 || sx0 > 1 || sy1 < -1 || sy0 > 1) return 0;
    BX[0] = sx0; BX[1] = sy0; BX[2] = sx1; BX[3] = sy1; BX[4] = W0 + (Wx < 0 ? Wx : 0) + (Wy < 0 ? Wy : 0) + (Wz < 0 ? Wz : 0);
    return 1;
  }

  // Усі клітинки [i0, i1] × [j0, j1] записані ближче за 1/w = iw (за плитками; мінімум зміненої плитки — перерахунок)
  function tilesOver(i0, j0, i1, j1, iw) {
    for (let tj = j0 >> TS; tj <= j1 >> TS; tj++) for (let ti = i0 >> TS; ti <= i1 >> TS; ti++) {
      const t = tj * TW + ti;
      if (tdirty[t]) {
        let v = Infinity;
        rows: for (let j = tj << TS, je = Math.min(GH, j + (1 << TS)); j < je; j++) for (let i = ti << TS, ie = Math.min(GW, i + (1 << TS)), r = j * GW; i < ie; i++) {
          const u = buf[r + i];
          if (u < v) { v = u; if (v === 0) break rows; }   // незаписана — мінімум 0
        }
        tmin[t] = v; tdirty[t] = 0;
      }
      if (tmin[t] <= iw) return false;
    }
    return true;
  }

  // Растеризація опуклого плаского багатокутника (n ≤ 8 вершин); прямокутник (вершини по колу) з прогином від
  // кривизни понад SAG — сіткою ns × ns менших (прогин ∝ квадрату розміру; кути менших — білінійно, тож спільні). Уже
  // закритий раніше записаними (спереду назад) — пропускаємо
  const QX = new Float64Array(4), QY = new Float64Array(4), QZ = new Float64Array(4);
  function raster(n, xs, ys, zs) {
    if (BC > 0 && n === 4) {
      const a2 = (xs[1] - xs[0]) ** 2 + (ys[1] - ys[0]) ** 2, b2 = (xs[3] - xs[0]) ** 2 + (ys[3] - ys[0]) ** 2, sg = BC * (a2 + b2) / 4;
      if (sg > SAG) {
        const ns = Math.ceil(Math.sqrt(sg / SAG));
        const ax = xs[1] - xs[0], ay = ys[1] - ys[0], az = zs[1] - zs[0], bx = xs[3] - xs[0], by = ys[3] - ys[0], bz = zs[3] - zs[0];
        for (let i = 0; i < ns; i++) for (let j = 0; j < ns; j++) {
          for (let k = 0; k < 4; k++) {
            const u = (k === 1 || k === 2 ? i + 1 : i) / ns, v = (k >= 2 ? j + 1 : j) / ns;
            QX[k] = xs[0] + u * ax + v * bx; QY[k] = ys[0] + u * ay + v * by; QZ[k] = zs[0] + u * az + v * bz;
          }
          poly(4, QX, QY, QZ);
        }
        return;
      }
    }
    poly(n, xs, ys, zs);
  }
  function poly(n, xs, ys, zs) {
    st.polys++;
    // кліп-координати (з кривизною); усі вершини з одного боку площини піраміди — поза кадром
    const ox = O[0], oy = O[1], oz = O[2];
    let oL = 0, oR = 0, oB = 0, oT = 0, oN = 0;
    for (let k = 0; k < n; k++) {
      let x = xs[k], y = ys[k], z = zs[k];
      if (BC > 0) z -= BC * ((x - TX) * (x - TX) + (y - TY) * (y - TY));
      x -= ox; y -= oy; z -= oz;
      const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], W = M[3] * x + M[7] * y + M[11] * z + M[15];
      CX[k] = X; CY[k] = Y; CW[k] = W;
      if (X < -W) oL++; if (X > W) oR++; if (Y < -W) oB++; if (Y > W) oT++; if (W < NEAR) oN++;
    }
    if (oL === n || oR === n || oB === n || oT === n || oN === n) return;
    // відсічення площиною W = NEAR (Сазерленд — Ходжман; лише коли є вершини ближче), екран у клітинках буфера,
    // обернена глибина
    let m = n;
    if (oN) {
      m = 0;
      for (let k = 0; k < n; k++) {
        const j = k + 1 < n ? k + 1 : 0, wk = CW[k] - NEAR, wj = CW[j] - NEAR;
        if (wk >= 0) { CX[8 + m] = CX[k]; CY[8 + m] = CY[k]; CW[8 + m] = CW[k]; m++; }
        if ((wk < 0) !== (wj < 0)) { const t = wk / (wk - wj); CX[8 + m] = CX[k] + t * (CX[j] - CX[k]); CY[8 + m] = CY[k] + t * (CY[j] - CY[k]); CW[8 + m] = NEAR; m++; }
      }
      if (m < 3) return;
    }
    const q0 = oN ? 8 : 0, hx = 0.5 * GW, hy = 0.5 * GH;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, wlo = Infinity, whi = 0;
    for (let k = 0; k < m; k++) {
      const iw = 1 / CW[q0 + k], sx = (CX[q0 + k] * iw + 1) * hx, sy = (CY[q0 + k] * iw + 1) * hy;
      SX[k] = sx; SY[k] = sy; SW[k] = iw;
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; if (iw < wlo) wlo = iw; if (iw > whi) whi = iw;
    }
    // рядки з центрами клітинок усередині
    const j0 = Math.max(0, Math.ceil(y0 - 0.5)), j1 = Math.min(GH - 1, Math.floor(y1 - 0.5));
    if (j1 < j0 || Math.min(GW - 1, Math.floor(x1 - 0.5)) < Math.max(0, Math.ceil(x0 - 0.5))) return;
    if (tilesOver(Math.max(0, Math.floor(x0)), j0, Math.min(GW - 1, Math.floor(x1)), j1, whi)) { st.hid++; return; }
    // орієнтація (знак площі) і площина 1/w = a·x + b·y + c — з трійки вершин найбільшої площі
    let area = 0, bi = 1, bj = 2, bd = 0;
    for (let k = 0; k < m; k++) { const j = k + 1 < m ? k + 1 : 0; area += SX[k] * SY[j] - SX[j] * SY[k]; }
    if (area < 1e-6 && area > -1e-6) return;
    for (let i = 1; i < m - 1; i++) for (let j = i + 1; j < m; j++) {
      const d = (SX[i] - SX[0]) * (SY[j] - SY[0]) - (SX[j] - SX[0]) * (SY[i] - SY[0]);
      if ((d < 0 ? -d : d) > (bd < 0 ? -bd : bd)) { bd = d; bi = i; bj = j; }
    }
    if (bd < 1e-9 && bd > -1e-9) return;
    const dx1 = SX[bi] - SX[0], dy1 = SY[bi] - SY[0], dx2 = SX[bj] - SX[0], dy2 = SY[bj] - SY[0], dw1 = SW[bi] - SW[0], dw2 = SW[bj] - SW[0];
    const a = (dw1 * dy2 - dw2 * dy1) / bd, b = (dx1 * dw2 - dx2 * dw1) / bd, c = SW[0] - a * SX[0] - b * SY[0];
    const ax = a < 0 ? 1 : 0, by = b < 0 ? 1 : 0, sg = area > 0 ? 1 : -1;
    // 1/w лінійна на екрані — крайні значення у вершинах: ближчі за безпечну відстань — за центром, далі — цілком
    // покриті; лише ближчі чи лише дальші — межі одного виду
    const cent = whi >= iwSafe, full = wlo < iwSafe;
    st.drawn++;
    // ребро k → k + 1: усередині — sg · ((x₁ − x₀)(y − y₀) − (y₁ − y₀)(x − x₀)) ≥ 0, тобто A·x + B·y + C ≥ 0. Межа
    // ребра в рядку j — x = P + Q·j: лівий край (A > 0: x ≥ межі) — масиви L*, правий (A < 0: x ≤ межі) — R*; P — для
    // центру рядка (з допуском TOL: центр на спільному ребрі — в обох заслонах), F — для найгіршого краю клітинки
    // (y = j при B > 0, інакше j + 1; похибку округлення — у бік «не покрито»). Горизонтальні ребра (A ≈ 0) — EB, EC
    let nl = 0, nr = 0, nh = 0;
    for (let k = 0; k < m; k++) {
      const q = k + 1 < m ? k + 1 : 0, A = -sg * (SY[q] - SY[k]), B = sg * (SX[q] - SX[k]), C = -(A * SX[k] + B * SY[k]);
      const ia = 1 / A, Q = -B * ia, P = -(B * 0.5 + C) * ia, F = -(B * (B > 0 ? 0 : 1) + C) * ia;
      if (A > 1e-12) { LQ[nl] = Q; LP[nl] = P - 0.5 - TOL; LF[nl] = F + 1e-9; nl++; }
      else if (A < -1e-12) { RQ[nr] = Q; RP[nr] = P - 0.5 + TOL; RF[nr] = F - 1e-9; nr++; }
      else { EB[nh] = B; EC[nh] = C; nh++; }
    }
    const B0 = buf, td = tdirty, tw = TW, gw1 = GW - 1;
    for (let j = j0; j <= j1; j++) {
      // [lo, hi] — центри клітинок усередині; [ilo, ihi] — клітинки всередині цілком
      let lo = 0, hi = gw1, ilo = 0, ihi = gw1;
      if (cent) {
        for (let k = 0; k < nl; k++) { const v = Math.ceil(LP[k] + LQ[k] * j); if (v > lo) lo = v; }
        for (let k = 0; k < nr; k++) { const v = Math.floor(RP[k] + RQ[k] * j); if (v < hi) hi = v; }
      }
      if (full) {
        for (let k = 0; k < nl; k++) { const v = Math.ceil(LF[k] + LQ[k] * j); if (v > ilo) ilo = v; }
        for (let k = 0; k < nr; k++) { const v = Math.floor(RF[k] + RQ[k] * j) - 1; if (v < ihi) ihi = v; }
      }
      for (let k = 0; k < nh; k++) {
        const B = EB[k], C = EC[k];
        if (-(B * (j + 0.5) + C) > TOL) { lo = 1; hi = 0; }
        if (-(B * (B > 0 ? j : j + 1) + C) > 0) { ilo = 1; ihi = 0; }
      }
      if (!cent) { lo = ilo; hi = ihi; }
      if (lo > hi) continue;
      const row = j * GW;
      let ch = 0;
      if (!full) { let v = a * (lo + 0.5) + b * (j + 0.5) + c; for (let i = row + lo, e = row + hi; i <= e; i++, v += a) if (v > B0[i]) { B0[i] = v; ch = 1; } }
      else if (!cent) { let v = a * (lo + ax) + b * (j + by) + c; for (let i = row + lo, e = row + hi; i <= e; i++, v += a) if (v > B0[i]) { B0[i] = v; ch = 1; } }
      else {
        const cc = b * (j + 0.5) + c, cy = b * (j + by) + c;
        for (let i = lo; i <= hi; i++) {
          let v = a * (i + 0.5) + cc;                    // 1/w у центрі
          if (v < iwSafe) {                               // далі безпечної відстані — лише цілком покрита, найдальшим
            if (i < ilo || i > ihi) continue;
            v = a * (i + ax) + cy;
          }
          if (v > B0[row + i]) { B0[row + i] = v; ch = 1; }
        }
      }
      st.texels += hi - lo + 1;
      // плитки рядка — змінені, якщо заслін десь ближчий за записаний
      if (ch) { const tr = (j >> TS) * tw; for (let t = lo >> TS; t <= hi >> TS; t++) td[tr + t] = 1; }
    }
  }

  const O8 = {
    stats: st,
    get on() { return on; },
    get size() { return [GW, GH]; },
    // Початок кадру: m — «камера × проєкція» (стовпці, як у WebGL; перспектива) відносно org; aspect — ширина / висота
    // кадру; bend — [c, x, y]: кривизна й ціль камери чи null; eye — око (світ)
    begin(m, org, aspect, bend = null, eye = org) {
      const h = Math.max(8, Math.min(maxHeight, Math.round(width / aspect)));
      if (h !== GH || buf.length !== GW * h) { GH = h; buf = new Float32Array(GW * GH); lv.length = 0; }
      buf.fill(0);
      TW = (GW + (1 << TS) - 1) >> TS; TH = (GH + (1 << TS) - 1) >> TS;
      if (tmin.length !== TW * TH) { tmin = new Float32Array(TW * TH); tdirty = new Uint8Array(TW * TH); }
      tmin.fill(0); tdirty.fill(0);
      M.set(m); O = org; BC = bend ? bend[0] : 0; TX = bend ? bend[1] : 0; TY = bend ? bend[2] : 0;
      st.polys = st.hid = st.drawn = st.texels = st.boxes = st.culled = 0; st.ms = 0;
      // безпечна відстань: зсув у межах клітинки на глибині d — d·k по осі (k — з осей камери r, up і масштабу проєкції)
      const fx = Math.hypot(m[0], m[4], m[8]), f = Math.hypot(m[1], m[5], m[9]), k = [0, 0, 0];
      for (let a = 0; a < 3; a++) k[a] = Math.abs(m[a * 4]) / (fx * fx * GW) + Math.abs(m[a * 4 + 1]) / (f * f * GH);
      const lim = (mz) => Math.min(margin[0] / k[0], margin[1] / k[1], mz / k[2]);
      // запас по вертикалі з кривизною: менший на прогин заслонів і трикутників, що малюються (хорда c·L²/4)
      const mz = BC > 0 ? margin[2] - SAG - BC * edge * edge / 4 : margin[2];
      let d = lim(mz);
      if (BC > 0) {
        // зсув по вертикалі між точками на відстані запасу по горизонталі: c·(2·D·mxy + mxy²), D — найдальша від цілі
        // точка в межах безпечної відстані (кут кадру — √(1 + 1/fx² + 1/f²) глибини від ока)
        const mh = Math.hypot(margin[0], margin[1]), De = Math.hypot(eye[0] - TX, eye[1] - TY) + d * Math.sqrt(1 + 1 / (fx * fx) + 1 / (f * f));
        d = lim(mz - BC * (2 * De * mh + mh * mh));
      }
      st.safe = d > 0 ? d : 0;
      iwSafe = d > 0 ? 1 / d : Infinity;
      on = true;
    },
    off() { on = false; },
    // Опуклий плаский багатокутник з n ≤ 8 вершин (світ: масиви x, y, z) — заслін
    poly: raster,
    // Чи закрита коробка світу вже растеризованими заслонами (за плитками; заслони в закритій — марні)
    hidden(x0, y0, z0, x1, y1, z1) {
      if (!on || rectOf(x0, y0, z0, x1, y1, z1) <= 0) return false;
      return tilesOver(Math.max(0, Math.floor((BX[0] + 1) * 0.5 * GW)), Math.max(0, Math.floor((BX[1] + 1) * 0.5 * GH)), Math.min(GW - 1, Math.floor((BX[2] + 1) * 0.5 * GW)), Math.min(GH - 1, Math.floor((BX[3] + 1) * 0.5 * GH)), 1 / BX[4]);
    },
    // Кінець заслонів: піраміда мінімумів (у клітинці рівня — найдальший заслін над її клітинками рівня 0)
    end() {
      if (!lv.length || lv[0].a !== buf) {
        lv.length = 0;
        lv.push({ w: GW, h: GH, a: buf });
        for (let w = GW, h = GH; w > 2 || h > 2;) { w = Math.ceil(w / 2); h = Math.ceil(h / 2); lv.push({ w, h, a: new Float32Array(w * h) }); }
      }
      for (let L = 1; L < lv.length; L++) {
        const { w, h, a: src } = lv[L - 1], { w: W2, h: H2, a: dst } = lv[L], pw = w >> 1;
        for (let j = 0; j < H2; j++) {
          const r0 = 2 * j * w, r1 = Math.min(h - 1, 2 * j + 1) * w, o = j * W2;
          for (let i = 0; i < pw; i++) {
            const s0 = r0 + 2 * i, s1 = r1 + 2 * i, p = src[s0], q = src[s0 + 1], r = src[s1], u = src[s1 + 1], pq = p < q ? p : q, ru = r < u ? r : u;
            dst[o + i] = pq < ru ? pq : ru;
          }
          if (pw < W2) { const p = src[r0 + w - 1], r = src[r1 + w - 1]; dst[o + pw] = p < r ? p : r; }
        }
      }
    },
    // Чи може бути видно щось у коробці світу (без відсікання — так)
    box(x0, y0, z0, x1, y1, z1) {
      if (!on) return true;
      st.boxes++;
      const r = rectOf(x0, y0, z0, x1, y1, z1);
      if (r < 0) return true;                           // біля ока чи за ним
      if (r === 0) { st.culled++; return false; }       // поза кадром
      const i0 = Math.max(0, Math.floor((BX[0] + 1) * 0.5 * GW)), i1 = Math.min(GW - 1, Math.floor((BX[2] + 1) * 0.5 * GW));
      const j0 = Math.max(0, Math.floor((BX[1] + 1) * 0.5 * GH)), j1 = Math.min(GH - 1, Math.floor((BX[3] + 1) * 0.5 * GH));
      const iw = 1 / BX[4];
      // рівень піраміди, де прямокутник — не більше 4 × 4 клітинок
      let L = 0;
      while (L < lv.length - 1 && ((i1 >> L) - (i0 >> L) > 3 || (j1 >> L) - (j0 >> L) > 3)) L++;
      const { w, a } = lv[L];
      for (let j = j0 >> L; j <= j1 >> L; j++) for (let i = i0 >> L; i <= i1 >> L; i++) if (a[j * w + i] <= iw) return true;
      st.culled++;
      return false;
    },
    // Чи потрапляє коробка світу в кадр (заслони поза кадром не растеризуємо)
    inView(x0, y0, z0, x1, y1, z1) { return !on || rectOf(x0, y0, z0, x1, y1, z1, true) !== 0; },
    // Буфер (діагностика, тести): [ширина, висота, Float32Array 1/w]
    buffer: () => [GW, GH, buf],
  };
  return O8;
}
