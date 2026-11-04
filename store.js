// Saves everything in this browser on this device. Nothing here sends data anywhere.
let db;

function open() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('ce-study', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('questions', { keyPath: 'id' });
      r.result.createObjectStore('bookmarks', { keyPath: 'id' });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => {
      db = r.result;
      resolve(db);
    };
    r.onerror = () => reject(r.error);
  });
}

async function run(store, mode, act) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = act(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const put = (store, item) => run(store, 'readwrite', (s) => s.put(item));
export const kvGet = (key) => run('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => run('kv', 'readwrite', (s) => s.put(value, key));
export const kvDel = (key) => run('kv', 'readwrite', (s) => s.delete(key));

// Asks the browser not to clear this tool's data when the device runs low on space.
export async function askToKeep() {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return false;
  }
}
