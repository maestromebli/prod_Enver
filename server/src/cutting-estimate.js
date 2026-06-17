/** Прогноз часу порізки на основі історії cutting_stats (евристика SaaS). */

export function median(values) {
  const nums = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

/**
 * @param {object} input
 * @param {Array<{ duration_sec, pieces_total, cut_length_mm, material }>} history
 */
export function estimateCuttingMinutes(input, history = []) {
  const pieces = Number(input.piecesTotal) || 0;
  const cutMm = Number(input.cutLengthMm) || 0;
  const material = String(input.material || "")
    .trim()
    .toLowerCase();

  const relevant = history.filter((row) => {
    if (!row.duration_sec) return false;
    if (
      material &&
      String(row.material || "")
        .toLowerCase()
        .includes(material)
    )
      return true;
    return !material;
  });

  const pool = relevant.length ? relevant : history.filter((r) => r.duration_sec > 0);

  if (!pool.length) {
    const fallbackPerPiece = 4;
    const minutes = pieces > 0 ? Math.max(15, Math.round(pieces * fallbackPerPiece)) : 60;
    return {
      estimatedMinutes: minutes,
      confidence: 0.25,
      method: "default",
      reason: "Недостатньо історії — базова оцінка 4 хв/деталь"
    };
  }

  const perPiece = pool
    .filter((r) => r.pieces_total > 0)
    .map((r) => r.duration_sec / r.pieces_total / 60);
  const perMm = pool
    .filter((r) => r.cut_length_mm > 0)
    .map((r) => r.duration_sec / r.cut_length_mm / 60);

  let minutes = median(perPiece.map((m) => m * (pieces || 1)));
  let method = "per_piece";
  let confidence = relevant.length >= 5 ? 0.75 : relevant.length >= 2 ? 0.55 : 0.4;

  if (cutMm > 0 && perMm.length) {
    const byLength = median(perMm) * cutMm;
    if (byLength > 0) {
      minutes = byLength;
      method = "per_length";
      confidence = Math.min(0.85, confidence + 0.1);
    }
  }

  if (!minutes || !Number.isFinite(minutes)) {
    minutes = median(pool.map((r) => r.duration_sec / 60)) || 60;
    method = "median_duration";
  }

  minutes = Math.max(5, Math.round(minutes));

  return {
    estimatedMinutes: minutes,
    confidence,
    method,
    reason: `На основі ${pool.length} завершених порізок${material ? ` (матеріал: ${input.material})` : ""}`,
    sampleSize: pool.length
  };
}

export function formatEstimateLabel(estimate) {
  if (!estimate?.estimatedMinutes) return "";
  const h = Math.floor(estimate.estimatedMinutes / 60);
  const m = estimate.estimatedMinutes % 60;
  if (h > 0) return `~${h} год ${m} хв`;
  return `~${m} хв`;
}
