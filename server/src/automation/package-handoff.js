import { getAutomationSettings } from "./settings.js";
import { loadLatestAiAnalysisForPosition } from "./analysis-loader.js";
import { tryAutoCreateTasksFromAnalysis } from "./auto-create-tasks.js";
import { applyAssignRulesForPosition } from "./assign-rules.js";
import { notifyPositionReadyForProduction } from "./dispatch.js";
import { logAutomationEvent } from "./event-log.js";
import { getPackageDetail } from "../constructive/constructive-package-service.js";
import { evaluatePackageReadiness } from "../../../shared/production/package-readiness.js";

/**
 * Після підтвердження пакета начальником — автостворення задач і webhook.
 */
export async function onPackageApprovedByProduction(pkg, { actor } = {}) {
  if (!pkg?.position_id) return { skipped: true, reason: "no_position" };

  const settings = await getAutomationSettings();
  if (!settings.autoCreateTasksOnPackageApprove) {
    return { skipped: true, reason: "disabled" };
  }

  const positionId = pkg.position_id;

  if (settings.blockAutoHandoffOnPartialB3d) {
    const detail = await getPackageDetail(pkg.id);
    const readiness = evaluatePackageReadiness(detail);
    if (!readiness.readyForAutoHandoff) {
      await logAutomationEvent("auto_create_tasks", {
        entityType: "position",
        entityId: positionId,
        outcome: "blocked_readiness",
        detail: { packageId: pkg.id, blockReason: readiness.blockReason }
      });
      return { skipped: true, reason: "readiness", readiness };
    }
  }

  const latest = await loadLatestAiAnalysisForPosition(positionId);
  if (!latest?.analysis) {
    return { skipped: true, reason: "no_ai_analysis" };
  }

  const result = await tryAutoCreateTasksFromAnalysis(positionId, latest.analysis, {
    source: `package_approve:${latest.source}`,
    actor,
    settings
  });

  if (result.applied) {
    await applyAssignRulesForPosition(positionId, result.stages, { actor, settings });
    await notifyPositionReadyForProduction(positionId, {
      stages: result.stages,
      source: result.source,
      packageId: pkg.id
    });
  }

  return result;
}
