import { Router } from "express";
import { requireAuth, requireOperatorPanelView } from "../middleware/auth.js";
import { getCuttingHistory } from "../folder-sync.js";
import { estimateCuttingMinutes, formatEstimateLabel } from "../cutting-estimate.js";
import { one } from "../db.js";

const router = Router();
router.use(requireAuth);

function parseGiblab(row) {
  try {
    return JSON.parse(row?.giblab_summary_json || "{}");
  } catch {
    return {};
  }
}

router.post("/estimate-cutting", requireOperatorPanelView, async (req, res) => {
  const { positionId, material, piecesTotal, cutLengthMm } = req.body || {};

  let input = {
    material: material || "",
    piecesTotal: Number(piecesTotal) || 0,
    cutLengthMm: Number(cutLengthMm) || 0
  };

  if (positionId) {
    const row = await one("SELECT * FROM positions WHERE id = $1", [Number(positionId)]);
    if (row) {
      const giblab = parseGiblab(row);
      input = {
        material: row.material || giblab.material || input.material,
        piecesTotal: giblab.piecesTotal || input.piecesTotal,
        cutLengthMm: giblab.cutLengthMm || input.cutLengthMm
      };
    }
  }

  const history = await getCuttingHistory(input.material);
  const estimate = estimateCuttingMinutes(input, history);

  res.json({
    ...estimate,
    label: formatEstimateLabel(estimate),
    input
  });
});

export default router;
