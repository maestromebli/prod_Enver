import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { computeKpiSnapshot, getKpiTrends, recordTodaySnapshot } from "../kpi-snapshots.js";

const router = Router();
router.use(requireAuth);

router.get("/", async (_req, res) => {
  await recordTodaySnapshot();
  const k = await computeKpiSnapshot();
  res.json({
    activeOrders: k.activeOrders,
    inProduction: k.inProduction,
    inWork: k.inWork,
    overdueCount: k.overdueCount,
    readyInstall: k.readyInstall,
    installs: k.installs,
    constructors: k.constructors,
    assemblers: k.assemblers
  });
});

router.get("/trends", async (req, res) => {
  await recordTodaySnapshot();
  const days = Number(req.query.days) || 14;
  res.json({ trends: await getKpiTrends(days) });
});

export default router;
