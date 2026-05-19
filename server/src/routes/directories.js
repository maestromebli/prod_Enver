import { Router } from "express";
import { getDirectories, saveDirectories } from "../directories-store.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth);

router.get("/", (_req, res) => {
  res.json(getDirectories());
});

router.put("/", requireAdmin, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object") {
    res.status(400).json({ error: "Некоректні дані довідників" });
    return;
  }
  res.json(saveDirectories(body));
});

export default router;
