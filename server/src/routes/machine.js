import { Router } from "express";
import { fetchMachineProgress } from "../machine-service.js";
import { requireAuth } from "../middleware/auth.js";
import { OPERATOR_STAGES } from "../roles.js";

const router = Router();
router.use(requireAuth);

const validStages = new Set(OPERATOR_STAGES.map((s) => s.key));

router.get("/progress/:stageKey", async (req, res, next) => {
  try {
    const { stageKey } = req.params;
    if (!validStages.has(stageKey)) {
      res.status(400).json({ error: "Невідомий етап" });
      return;
    }
    const data = await fetchMachineProgress(stageKey);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

export default router;
