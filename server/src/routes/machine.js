import { Router } from "express";
import { fetchMachineProgress } from "../machine-service.js";
import { requireAuth } from "../middleware/auth.js";
import { OPERATOR_STAGE_KEY_SET } from "../roles.js";

const router = Router();
router.use(requireAuth);

router.get("/progress/:stageKey", async (req, res, next) => {
  try {
    const { stageKey } = req.params;
    if (!OPERATOR_STAGE_KEY_SET.has(stageKey)) {
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
