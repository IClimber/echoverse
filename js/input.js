// input.js — шар дій над клавіатурою й мишею: гра питає «куди рухатись», «чи був стрибок», а не «чи натиснуто W».
// Так пізніше можна додати сенсорне керування без переробки гри. Клавіші — за e.code: не залежать від розкладки.

const held = new Set();
const pressed = [];                 // дії, що сталися з минулого кадру
let wheel = 0, dragX = 0, dragY = 0, dragging = false;

const ACTIONS = {
  Space: 'jump', KeyQ: 'jumpPrev', KeyE: 'jumpNext', KeyR: 'jumpRandom', KeyV: 'camera', Escape: 'menu', F3: 'debug', KeyH: 'help',
};

export function initInput(target = window) {
  target.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    held.add(e.code);
    const a = ACTIONS[e.code] && (e.shiftKey && e.code === 'KeyR' ? 'jumpRandomDepth' : ACTIONS[e.code]);
    if (a && !e.repeat) pressed.push(a);
    if (a || /^(Key[WASD]|Arrow)/.test(e.code)) e.preventDefault();
  });
  target.addEventListener('keyup', (e) => held.delete(e.code));
  target.addEventListener('blur', () => held.clear());
  target.addEventListener('wheel', (e) => { wheel += e.deltaY; }, { passive: true });
  // Обертання камери — права кнопка миші
  target.addEventListener('mousedown', (e) => { if (e.button === 2) dragging = true; });
  target.addEventListener('mouseup', (e) => { if (e.button === 2) dragging = false; });
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
// Біг (Shift) і вертикаль польоту: пробіл — угору, Shift — униз
export const sprintHeld = () => held.has('ShiftLeft') || held.has('ShiftRight');
export const vertAxis = () => (held.has('Space') ? 1 : 0) - (sprintHeld() ? 1 : 0);
// Обертання камери клавішами: −1 (Z) … 1 (C)
export const turnAxis = () => (held.has('KeyC') ? 1 : 0) - (held.has('KeyZ') ? 1 : 0);
// Зсув миші з правою кнопкою з минулого кадру, px
export function takeDrag() { const d = [dragX, dragY]; dragX = dragY = 0; return d; }
// Дії з минулого кадру (кожну — один раз): jump — стрибок, jumpPrev / jumpNext — пристрій (номер −1 / +1),
// jumpRandom — у випадковий всесвіт (для перевірок), jumpRandomDepth (Shift+R) — і на іншу глибину, camera — вигляд
export function takeActions() { return pressed.splice(0); }
export function takeWheel() { const w = wheel; wheel = 0; return w; }
export function clearInput() { held.clear(); pressed.length = 0; wheel = 0; dragX = dragY = 0; dragging = false; }
