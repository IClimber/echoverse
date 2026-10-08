// rng.js — детерміновані хеші й генератор псевдовипадкових чисел для генерації світу.
// Лише цілочислова арифметика (Math.imul, зсуви) і ділення на 2^32: однаковий результат у будь-якому рушії JS.
// Math.random у генерації не вживати.

// ================= Хеші (murmur3) =================
export function fmix(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
function mix(h, k) {
  k = Math.imul(k | 0, 0xcc9e2d51);
  k = k << 15 | k >>> 17;
  h ^= Math.imul(k, 0x1b873593);
  h = h << 13 | h >>> 19;
  return Math.imul(h, 5) + 0xe6546b64 | 0;
}
// Окремі функції без rest-параметрів — вони в гарячих циклах шуму
export const hash2 = (a, b) => fmix(mix(mix(0, a), b) ^ 8);
export const hash3 = (a, b, c) => fmix(mix(mix(mix(0, a), b), c) ^ 12);
export const hash4 = (a, b, c, d) => fmix(mix(mix(mix(mix(0, a), b), c), d) ^ 16);

export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return fmix(h ^ s.length * 2);
}

export const unit = (h) => h / 4294967296;              // uint32 → [0, 1), точно (ділення на степінь двійки)

// ================= PRNG (sfc32) =================
export function rng(seed) {
  let a = hash2(seed, 1) | 0, b = hash2(seed, 2) | 0, c = hash2(seed, 3) | 0, d = 1;
  const next = () => {
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}
export const range = (r, lo, hi) => lo + (hi - lo) * r();
export const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const chance = (r, p) => r() < p;
