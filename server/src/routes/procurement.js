import { Router } from "express";
import { requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import {
  getProcurementRequest,
  listProcurementRequests
} from "../constructive/procurement-service.js";

const router = Router();
router.use(requireAuth, requirePermissionOrAdmin("canManageProcurement"));

router.get("/", async (req, res) => {
  const statusFilter = req.query.status || "all";
  const items = await listProcurementRequests({ statusFilter });
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const detail = await getProcurementRequest(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Заявку не знайдено" });
    return;
  }
  res.json(detail);
});

export default router;
