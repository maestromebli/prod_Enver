const DB_NAME = "enver-browser-folders";
const HANDLE_STORE = "handles";
const FILES_STORE = "files";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) {
        db.createObjectStore(HANDLE_STORE);
      }
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

export async function putBrowserFolderHandle(key, handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([HANDLE_STORE, FILES_STORE], "readwrite");
    tx.objectStore(HANDLE_STORE).put(handle, key);
    tx.objectStore(FILES_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBrowserFolderHandle(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLE_STORE, "readonly");
    const req = tx.objectStore(HANDLE_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function putBrowserFolderFiles(key, files) {
  const payload = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".txt")) continue;
    if (file.size > 3_000_000) continue;
    payload.push({
      name: file.webkitRelativePath || file.name,
      text: await file.text()
    });
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([FILES_STORE, HANDLE_STORE], "readwrite");
    tx.objectStore(FILES_STORE).put(payload, key);
    tx.objectStore(HANDLE_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getBrowserFolderFiles(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, "readonly");
    const req = tx.objectStore(FILES_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
