// input.js — шар дій над клавіатурою й мишею: гра питає «куди рухатись», «чи був стрибок», а не «чи натиснуто W».
// Так пізніше можна додати сенсорне керування без переробки гри. Клавіші — за e.code: не залежать від розкладки.

const held = new Set();
const pressed = [];                 // дії, що сталися з минулого кадру
let wheel = 0, dragX = 0, dragY = 0, dragging = false, downX = 0, downY = 0;

const ACTIONS = {
  Space: 'jump', KeyQ: 'jumpPrev', KeyE: 'jumpNext', KeyR: 'jumpRandom', KeyV: 'camera', Escape: 'menu', F3: 'debug', KeyH: 'help',
  KeyF: 'take', KeyL: 'lamp', F11: 'fullscreen',
};
const CTRL = ['ControlLeft', 'ControlRight'];
// Ctrl + клавіші гри — браузер своїх дій не робить (Ctrl+S, Ctrl+D, Ctrl+F…). Ctrl+W, Ctrl+T, Ctrl+N, Ctrl+Tab браузер
// не віддає сторінці — лише в повному екрані з Keyboard Lock (main.js toggleFull)
const GAME_KEY = /^(Key[WASDFREHQVZCL]|Space|Arrow|Shift)/;

// Клавіша натиснута (від клавіатури чи ?dev eco.key): дія — без повторів
function keyDown(code, shift, repeat) {
  held.add(code);
  const a = ACTIONS[code] && (shift && code === 'KeyR' ? 'jumpRandomDepth' : ACTIONS[code]);
  if (a && !repeat) pressed.push(a);
  if (CTRL.includes(code) && !repeat) pressed.push('crouchPress');
  return a;
}

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    // Ctrl+Shift+C — скопіювати панель F3 текстом (main.js)
    if (e.code === 'KeyC' && e.shiftKey && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!e.repeat) pressed.push('copyDebug'); return; }
    const a = keyDown(e.code, e.shiftKey, e.repeat);
    if (a || /^(Key[WASD]|Arrow)/.test(e.code) || ((e.ctrlKey || e.metaKey) && GAME_KEY.test(e.code))) e.preventDefault();
  });
  target.addEventListener('keyup', (e) => held.delete(e.code));
  target.addEventListener('blur', () => held.clear());
  target.addEventListener('wheel', (e) => { wheel += e.deltaY; }, { passive: true });
  // Права кнопка: із захопленою мишею — використати; без захоплення — обертати камеру, клацання без руху — використати
  target.addEventListener('mousedown', (e) => {
    const onMenu = e.target instanceof HTMLElement && e.target.closest('#menu');
    if (e.button === 2) {
      if (locked()) { if (!onMenu) pressed.push('use'); }
      else { dragging = true; downX = e.clientX; downY = e.clientY; }
    }
    if (e.button === 0 && !onMenu) pressed.push('hit');   // удар (ЛКМ)
  });
  target.addEventListener('mouseup', (e) => {
    if (e.button !== 2 || !dragging) return;
    dragging = false;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) < 4 && !(e.target instanceof HTMLElement && e.target.closest('#menu'))) pressed.push('use');
  });
  // Подія з величезним зсувом — збій захоплення миші (буває в момент захоплення): ігноруємо, інакше камеру «смикає»
  target.addEventListener('mousemove', (e) => {
    if ((dragging || locked()) && Math.abs(e.movementX) < 250 && Math.abs(e.movementY) < 250) { dragX += e.movementX; dragY += e.movementY; }
  });
  target.addEventListener('contextmenu', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
  target.addEventListener('blur', () => { dragging = false; });
}

// Рух на екрані: x — праворуч, y — униз (−1…1)
export function moveAxis() {
  const k = (...c) => c.some((x) => held.has(x)) ? 1 : 0;
  return [k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'), k('KeyS', 'ArrowDown') - k('KeyW', 'ArrowUp')];
}
// Захоплення миші (третя особа): рух миші повертає камеру без натискання кнопок; Esc — відпустити
export const locked = () => !!document.pointerLockElement;
export function lockPointer(el) { if (!locked()) try { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* не підтримується */ } }
export function unlockPointer() { if (locked()) document.exitPointerLock(); }
// Біг (Shift); присідання (Ctrl, утримувати); вертикаль польоту й під рідиною: пробіл — угору, Ctrl — униз
export const sprintHeld = () => held.has('ShiftLeft') || held.has('ShiftRight');
export const crouchHeld = () => held.has('ControlLeft') || held.has('ControlRight');
export const vertAxis = () => (held.has('Space') ? 1 : 0) - (crouchHeld() ? 1 : 0);
// Обертання камери клавішами: −1 (Z) … 1 (C)
export const turnAxis = () => (held.has('KeyC') ? 1 : 0) - (held.has('KeyZ') ? 1 : 0);
// Зсув миші з правою кнопкою з минулого кадру, px
export function takeDrag() { const d = [dragX, dragY]; dragX = dragY = 0; return d; }
// Дії з минулого кадру (кожну — один раз): jump — стрибок, jumpPrev / jumpNext — пристрій (номер −1 / +1),
// jumpRandom — у випадковий всесвіт (для перевірок), jumpRandomDepth (Shift+R) — і на іншу глибину, camera — вигляд,
// hit — удар (ЛКМ), use — використати (ПКМ), take — взяти / покласти (F), crouchPress — Ctrl натиснуто (відпустити
// стіну), lamp — ліхтарик (L), fullscreen — повний екран (F11)
export function takeActions() { return pressed.splice(0); }
export function takeWheel() { const w = wheel; wheel = 0; return w; }
export function clearInput() { held.clear(); pressed.length = 0; wheel = 0; dragX = dragY = 0; dragging = false; }
// ?dev: клавіша (e.code) натиснута / відпущена — як від клавіатури; Mouse0 / Mouse2 — ЛКМ (удар) / ПКМ (використати)
const DEV_MOUSE = { Mouse0: 'hitDev', Mouse2: 'use' };     // hitDev — удар і без захоплення миші
export function devKey(code, down = true) {
  if (DEV_MOUSE[code]) { if (down) pressed.push(DEV_MOUSE[code]); return; }
  if (down) keyDown(code, held.has('ShiftLeft'), held.has(code)); else held.delete(code);
}
