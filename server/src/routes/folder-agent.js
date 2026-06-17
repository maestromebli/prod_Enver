import { Router } from "express";
import {
  ackFolderCommand,
  getPendingCommands,
  recordAgentHeartbeat,
  syncFoldersFromAgent
} from "../folder-sync.js";
import { requireAgentAuth } from "../middleware/agent-auth.js";

const router = Router();
router.use(requireAgentAuth);

router.post("/sync", async (req, res) => {
  const folders = Array.isArray(req.body?.folders) ? req.body.folders : [];
  if (!folders.length) {
    res.status(400).json({ error: "Передайте масив folders" });
    return;
  }
  try {
    const results = await syncFoldersFromAgent(folders);
    res.json({ synced: results.length, results });
  } catch (err) {
    if (err.code === "DB_UNAVAILABLE" || err.status === 503) {
      res.status(503).json({ error: err.message || "База даних недоступна" });
      return;
    }
    throw err;
  }
});

router.post("/heartbeat", async (req, res) => {
  const { version = "", rootPath = "", payload = {} } = req.body || {};
  await recordAgentHeartbeat(req.agentId, version, rootPath, payload);
  res.json({ ok: true });
});

router.get("/commands", async (_req, res) => {
  const commands = await getPendingCommands();
  res.json({
    commands: commands.map((c) => ({
      id: c.id,
      type: c.command_type,
      folderKey: c.folder_key,
      positionId: c.position_id,
      fromState: c.from_state,
      toState: c.to_state,
      payload: JSON.parse(c.payload_json || "{}")
    }))
  });
});

router.post("/commands/:id/ack", async (req, res) => {
  const id = Number(req.params.id);
  const { ok = true, error = "" } = req.body || {};
  await ackFolderCommand(id, { ok, error });
  res.json({ ok: true });
});

export default router;
