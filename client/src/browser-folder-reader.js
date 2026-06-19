import { getBrowserFolderHandle } from "./browser-folder-store.js";

const MAX_FILE_BYTES = 3_000_000;

async function readTextFilesRecursive(dirHandle, chunks) {
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === "directory") {
      await readTextFilesRecursive(entry, chunks);
      continue;
    }
    if (entry.kind !== "file" || !name.toLowerCase().endsWith(".txt")) continue;
    const file = await entry.getFile();
    if (file.size > MAX_FILE_BYTES) continue;
    chunks.push(await file.text());
  }
}

/** Зчитує всі .txt з папки, обраної через браузер (збережений handle у IndexedDB). */
export async function readBrowserFolderLogText(storageKey) {
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

  const chunks = [];
  await readTextFilesRecursive(handle, chunks);
  if (!chunks.length) {
    throw new Error("У папці немає файлів .txt");
  }
  return chunks.join("\n");
}
