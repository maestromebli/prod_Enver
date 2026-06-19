import { getBrowserFolderFiles, getBrowserFolderHandle } from "./browser-folder-store.js";

const MAX_FILE_BYTES = 3_000_000;

async function readTextFilesRecursiveEntries(dirHandle, basePath, out) {
  for await (const [name, entry] of dirHandle.entries()) {
    const rel = basePath ? `${basePath}/${name}` : name;
    if (entry.kind === "directory") {
      await readTextFilesRecursiveEntries(entry, rel, out);
      continue;
    }
    if (entry.kind !== "file" || !name.toLowerCase().endsWith(".txt")) continue;
    const file = await entry.getFile();
    if (file.size > MAX_FILE_BYTES) continue;
    out.push({ name: rel, text: await file.text() });
  }
}

/** Рекурсивно зчитує всі .txt з папки, обраної в браузері. */
export async function readBrowserFolderLogFiles(storageKey) {
  const cachedFiles = await getBrowserFolderFiles(storageKey);
  if (cachedFiles?.length) {
    return cachedFiles.map((f) => ({ name: f.name, text: f.text }));
  }

  const handle = await getBrowserFolderHandle(storageKey);
  if (!handle) {
    throw new Error("Папку не знайдено. Оберіть її знову кнопкою «Обрати папку» у цьому браузері.");
  }

  const perm = await handle.queryPermission?.({ mode: "read" });
  if (perm !== "granted") {
    const next = await handle.requestPermission({ mode: "read" });
    if (next !== "granted") {
      throw new Error("Немає доступу до папки. Дозвольте читання в діалозі браузера.");
    }
  }

  const files = [];
  await readTextFilesRecursiveEntries(handle, "", files);
  if (!files.length) {
    throw new Error("У папці та підпапках немає файлів .txt");
  }
  return files;
}

/** Зворотна сумісність: один текстовий blob. */
export async function readBrowserFolderLogText(storageKey) {
  const files = await readBrowserFolderLogFiles(storageKey);
  return files.map((f) => f.text).join("\n");
}
