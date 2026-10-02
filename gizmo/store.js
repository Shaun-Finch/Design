// Storage: small settings in localStorage, large study material in IndexedDB. Everything stays in this browser.
const LS_KEY = 'gizmo.v2';

export function loadState(seed) {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') s = {};
  // fill any missing top-level keys from the seed (keeps older saves working)
  for (const k of Object.keys(seed)) if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(seed[k]));
  return s;
}
export function saveState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
}

// ---------- IndexedDB key/value with in-memory fallback ----------
let dbp = null;
const mem = new Map();
function open() {
  if (dbp) return dbp;
  dbp = new Promise(res => {
    try {
      const r = indexedDB.open('gizmo', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('kv'); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  if (!db) return fn(null);
  return new Promise((res, rej) => {
    try {
      const t = db.transaction('kv', mode), st = t.objectStore('kv');
      const out = fn(st);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    } catch (e) { rej(e); }
  });
}
export async function idbGet(key) {
  try {
    const db = await open();
    if (!db) return mem.get(key);
    return await new Promise(res => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => res(r.result); r.onerror = () => res(mem.get(key));
    });
  } catch (e) { return mem.get(key); }
}
export async function idbSet(key, val) {
  mem.set(key, val);
  try { await tx('readwrite', st => st && st.put(val, key)); } catch (e) { /* memory only */ }
}
export async function idbDel(key) {
  mem.delete(key);
  try { await tx('readwrite', st => st && st.delete(key)); } catch (e) { }
}
