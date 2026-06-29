import { Router } from "express";
import { requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import {
  addMtoProcurementItem,
  getProcurementRequest,
  listCalendarEvents,
  listMtoItems,
  listPositionSummaries,
  listProcurementRequests,
  receiveProcurementItem,
  updateProcurementItem,
  updateProcurementStatus
} from "../constructive/procurement-service.js";
import {
  createReturnClaim,
  getReturnClaim,
  listReturnClaims,
  updateReturnStatus
} from "../procurement/returns-service.js";
import {
  issueItemToProduction,
  listPendingReceipts,
  listWarehouseMovements
} from "../warehouse/warehouse-service.js";

const router = Router();
router.use(requireAuth);

function auditActor(req) {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}

router.get("/", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const statusFilter = req.query.status || "all";
  const items = await listProcurementRequests({ statusFilter });
  res.json(items);
});

router.get("/summaries", requirePermissionOrAdmin("canViewProcurement"), async (_req, res) => {
  res.json(await listPositionSummaries());
});

router.get("/calendar", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const events = await listCalendarEvents({ from: req.query.from, to: req.query.to });
  res.json(events);
});

router.get("/mto", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const items = await listMtoItems({ filter: req.query.filter || "open" });
  res.json(items);
});

router.get(
  "/warehouse/pending",
  requirePermissionOrAdmin("canViewProcurement"),
  async (req, res) => {
    const items = await listPendingReceipts({ days: Number(req.query.days) || 7 });
    res.json(items);
  }
);

router.get(
  "/warehouse/movements",
  requirePermissionOrAdmin("canViewProcurement"),
  async (req, res) => {
    const items = await listWarehouseMovements({
      positionId: req.query.positionId ? Number(req.query.positionId) : null,
      limit: Number(req.query.limit) || 50
    });
    res.json(items);
  }
);

router.get("/returns", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  res.json(await listReturnClaims({ statusFilter: req.query.status || "active" }));
});

router.get("/:id", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const detail = await getProcurementRequest(Number(req.params.id));
  if (!detail) {
    res.status(404).json({ error: "Заявку не знайдено" });
    return;
  }
  res.json(detail);
});

router.post(
  "/positions/:positionId/mto",
  requirePermissionOrAdmin("canManageProcurement"),
  async (req, res) => {
    const item = await addMtoProcurementItem(
      Number(req.params.positionId),
      req.body,
      auditActor(req)
    );
    res.status(201).json(item);
  }
);

router.patch(
  "/items/:itemId",
  requirePermissionOrAdmin("canManageProcurement"),
  async (req, res) => {
    const item = await updateProcurementItem(Number(req.params.itemId), req.body, auditActor(req));
    res.json(item);
  }
);

router.post(
  "/items/:itemId/receive",
  requirePermissionOrAdmin("canReceiveWarehouse"),
  async (req, res) => {
    const detail = await receiveProcurementItem(
      Number(req.params.itemId),
      {
        qty: req.body?.qty,
        location: req.body?.location,
        notes: req.body?.notes
      },
      auditActor(req)
    );
    res.json(detail);
  }
);

router.post(
  "/items/:itemId/issue",
  requirePermissionOrAdmin("canReceiveWarehouse"),
  async (req, res) => {
    const movement = await issueItemToProduction(
      {
        procurementItemId: Number(req.params.itemId),
        positionId: Number(req.body.positionId),
        qty: Number(req.body.qty) || 1,
        notes: req.body?.notes
      },
      auditActor(req)
    );
    res.json(movement);
  }
);

router.patch(
  "/requests/:requestId/status",
  requirePermissionOrAdmin("canManageProcurement"),
  async (req, res) => {
    const proc = await updateProcurementStatus(
      Number(req.params.requestId),
      req.body?.status,
      auditActor(req),
      { actualPrices: req.body?.actualPrices }
    );
    res.json(proc);
  }
);

router.post("/returns", requirePermissionOrAdmin("canManageProcurement"), async (req, res) => {
  const claim = await createReturnClaim(req.body, auditActor(req));
  res.status(201).json(claim);
});

router.get("/returns/:id", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const claim = await getReturnClaim(Number(req.params.id));
  if (!claim) {
    res.status(404).json({ error: "Рекламацію не знайдено" });
    return;
  }
  res.json(claim);
});

router.patch(
  "/returns/:id/status",
  requirePermissionOrAdmin("canManageProcurement"),
  async (req, res) => {
    const claim = await updateReturnStatus(
      Number(req.params.id),
      req.body?.status,
      auditActor(req),
      { orderReplacement: Boolean(req.body?.orderReplacement) }
    );
    res.json(claim);
  }
);

export default router;
