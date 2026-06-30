import { Router } from "express";
import { requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import {
  createMaterialLibraryItem,
  deactivateMaterialLibraryItem,
  getMaterialLibraryItem,
  listMaterialLibrary,
  updateMaterialLibraryItem
} from "../material-library-service.js";

const router = Router();
router.use(requireAuth);

router.get("/", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const items = await listMaterialLibrary({
    search: req.query.search || "",
    itemType: req.query.type || "",
    activeOnly: req.query.active !== "0" && req.query.active !== "false",
    limit: Number(req.query.limit) || 200
  });
  res.json(items);
});

router.get("/:id", requirePermissionOrAdmin("canViewProcurement"), async (req, res) => {
  const item = await getMaterialLibraryItem(Number(req.params.id));
  if (!item) {
    res.status(404).json({ error: "Матеріал не знайдено" });
    return;
  }
  res.json(item);
});

router.post("/", requirePermissionOrAdmin("canManageProcurement"), async (req, res) => {
  const item = await createMaterialLibraryItem(req.body);
  res.status(201).json(item);
});

router.patch("/:id", requirePermissionOrAdmin("canManageProcurement"), async (req, res) => {
  const item = await updateMaterialLibraryItem(Number(req.params.id), req.body);
  res.json(item);
});

router.delete("/:id", requirePermissionOrAdmin("canManageProcurement"), async (req, res) => {
  const item = await deactivateMaterialLibraryItem(Number(req.params.id));
  res.json(item);
});

export default router;
