// fmt.js — числа в тексті гри (HUD, F3, стенди) українською: десяткова кома, справжній мінус (−)
export const fx = (v, d = 1) => v.toFixed(d).replace('.', ',').replace('-', '−');
export const fmtN = (n) => n > 0 ? '+' + n : n < 0 ? '−' + -n : '0';                // ціле зі знаком (номер всесвіту)
export const sg = (v, d = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d).replace('.', ',');
export const pc = (v) => (v >= 0.1 ? (v * 100).toFixed(0) : (v * 100).toPrecision(1)).replace('.', ',') + ' %';   // частка 0…1
export const atm = (P) => (P < 0.01 ? P.toPrecision(1) : P < 0.1 ? P.toFixed(3) : P < 10 ? P.toFixed(2) : P.toFixed(0)).replace('.', ',');   // тиск, атм
