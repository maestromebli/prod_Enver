import express from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = express.Router();

function requestBaseUrl(req) {
  const proto = req.get("x-forwarded-proto") || req.protocol;
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

router.get("/info", requireAuth, requireAdmin, (req, res) => {
  const base = requestBaseUrl(req);

  res.json({
    operatorUrl: `${base}/operator.html`,
    androidInstallUrl: `${base}/android-install.html`,
    androidHint: "Chrome → «Встановити застосунок» або «Додати на головний екран»"
  });
});

export default router;
