import fs from "fs";
import { loadConfig, scanAll, moveFolder, archiveFolder, ensureRootLayout } from "./nas-scanner.js";
import { EnverClient } from "./enver-client.js";

const config = loadConfig();

if (!fs.existsSync(config.rootPath)) {
  fs.mkdirSync(config.rootPath, { recursive: true });
}
ensureRootLayout(config.rootPath);

const client = new EnverClient({
  baseUrl: config.enverUrl,
  token: config.enverToken,
  agentId: config.agentId,
  version: config.version
});

async function runCommands() {
  const { commands = [] } = await client.getCommands();
  for (const cmd of commands) {
    try {
      if (cmd.type === "archive" || cmd.toState === "archive") {
        archiveFolder(config.rootPath, cmd.folderKey, cmd.fromState || "done");
      } else {
        moveFolder(config.rootPath, cmd.folderKey, cmd.fromState, cmd.toState);
      }
      await client.ackCommand(cmd.id, true);
      console.log(`[agent] ✓ ${cmd.folderKey}: ${cmd.fromState} → ${cmd.toState}`);
    } catch (err) {
      console.error(`[agent] ✗ команда ${cmd.id}:`, err.message);
      await client.ackCommand(cmd.id, false, err.message);
    }
  }
}

async function tick() {
  try {
    const folders = scanAll(config.rootPath, config.states);
    if (folders.length) {
      const result = await client.sync(folders);
      console.log(`[agent] sync: ${result.synced} папок`);
    }
    await runCommands();
    await client.heartbeat(config.rootPath, { folders: folders.length });
  } catch (err) {
    console.error("[agent] помилка циклу:", err.message);
  }
}

console.log(`ENVER Folder Agent → ${config.enverUrl}`);
console.log(`Корінь NAS: ${config.rootPath}`);
tick();
setInterval(tick, config.pollIntervalMs || 15000);
