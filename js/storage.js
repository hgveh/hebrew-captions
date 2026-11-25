// IndexedDB פשוט – לשמירת גופנים ופרויקטים במכשיר
const DB = 'kt_db', VER = 1;
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('fonts')) d.createObjectStore('fonts', { keyPath: 'name' });
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'key' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    const r = fn(s); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error);
  });
};
export const putFont = f => tx('fonts', 'readwrite', s => s.put(f));
export const delFont = name => tx('fonts', 'readwrite', s => s.delete(name));
export const allFonts = () => tx('fonts', 'readonly', s => s.getAll());
export const putProject = p => tx('projects', 'readwrite', s => s.put(p));
export const getProject = key => tx('projects', 'readonly', s => s.get(key));
export const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
export const kvGet = k => tx('kv', 'readonly', s => s.get(k));
