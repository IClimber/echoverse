// save.js — збереження світів у IndexedDB і експорт/імпорт файлом.
// Світ = зерно + зміни: незмінені чанки не зберігаються (генеруються знову). Сховище chunks — під зміни (етап 3).
// Запис світу: {id, name, seedText, seed, gen, created, played, player: {d, n, x, y}, history: [[d, n], …]}.

const DB = 'echoverse', VER = 1;
export const FORMAT = 'echoverse', FILE_V = 1;

let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((ok, fail) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: 'key' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((ok, fail) => {
    const t = d.transaction(store, mode), res = fn(t.objectStore(store));
    t.oncomplete = () => ok(res && 'result' in res ? res.result : undefined);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
  }));
}

export async function listWorlds() {
  try {
    const all = await tx('worlds', 'readonly', (s) => s.getAll());
    return (all || []).sort((a, b) => b.played - a.played);
  } catch (e) { console.warn('збереження недоступне', e); return []; }
}
export async function putWorld(w) {
  try { await tx('worlds', 'readwrite', (s) => s.put(w)); return true; }
  catch (e) { console.warn('не вдалося зберегти світ', e); return false; }
}
export async function deleteWorld(id) {
  try {
    await tx('worlds', 'readwrite', (s) => s.delete(id));
    await tx('chunks', 'readwrite', (s) => s.delete(IDBKeyRange.bound(id + ':', id + ':￿')));
  } catch (e) { console.warn('не вдалося видалити світ', e); }
}

// ================= Файл =================
export function serialize(w, chunks = []) {
  return JSON.stringify({ format: FORMAT, v: FILE_V, world: w, chunks });
}
const isInt = (v) => Number.isInteger(v);
// Текст файлу → {world, chunks}; некоректний — виняток з поясненням
export function deserialize(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('це не JSON'); }
  if (!o || o.format !== FORMAT) throw new Error('це не збереження «Відлуння»');
  if (!isInt(o.v) || o.v > FILE_V) throw new Error('збереження з новішої версії гри');
  const w = o.world, p = w && w.player;
  if (!w || typeof w.seedText !== 'string' || !isInt(w.seed) || w.seed < 0 || w.seed > 0xffffffff
    || !p || !isInt(p.d) || !isInt(p.n) || !Number.isFinite(p.x) || !Number.isFinite(p.y))
    throw new Error('пошкоджене збереження');
  const history = Array.isArray(w.history) ? w.history.filter((h) => Array.isArray(h) && isInt(h[0]) && isInt(h[1])) : [];
  return {
    world: {
      id: typeof w.id === 'string' ? w.id : newId(), name: String(w.name || w.seedText), seedText: w.seedText, seed: w.seed,
      gen: isInt(w.gen) ? w.gen : 1, created: Number(w.created) || Date.now(), played: Number(w.played) || Date.now(),
      player: { d: p.d, n: p.n, x: p.x, y: p.y, ...(Number.isFinite(p.z) ? { z: p.z } : {}) }, history,
    },
    chunks: Array.isArray(o.chunks) ? o.chunks : [],
  };
}
export function newId() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}
