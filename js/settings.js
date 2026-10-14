// settings.js — налаштування графіки гравця (на браузер): графічний пристрій (WebGL2 / WebGPU), тіні (без тіней / PCF3 / PCSS),
// дальність (8–32 чанки), вид (перша / третя особа). Типово — WebGL2 · PCF3 · 16 (рішення користувача 10.10.2026). URL перевизначає:
// ?gpu=webgl2|webgpu, ?shadows=off|pcf3|pcss. Сховище може бути недоступне (приватне вікно, заблоковані дані) — тоді типові
export const KEYS = { gpu: 'echoverse-gpu', shadows: 'echoverse-shadows', view: 'echoverse-view', camera: 'echoverse-camera' };
const OK = { gpu: ['webgl2', 'webgpu'], shadows: ['off', 'pcf3', 'pcss'], camera: ['third', 'first'] };
export const DEFAULTS = { gpu: 'webgl2', shadows: 'pcf3', view: 16, camera: 'third' };
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export function loadSettings(QS = new URLSearchParams(location.search)) {
  const s = { ...DEFAULTS };
  for (const k of ['gpu', 'shadows']) { const v = QS.get(k) || get(KEYS[k]); if (OK[k].includes(v)) s[k] = v; }
  const v = +get(KEYS.view);
  if (v >= 8 && v <= 32) s.view = Math.round(v);
  { const c = get(KEYS.camera); if (OK.camera.includes(c)) s.camera = c; }   // збережене 'iso' (вид згори прибрано) — типова
  return s;
}
export function saveSetting(k, v) { try { localStorage.setItem(KEYS[k], String(v)); } catch { /* сховище недоступне */ } }
