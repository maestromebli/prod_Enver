import { recordHistory, SYSTEM_ACTOR } from "../../audit.js";
import { auditActor, requirePositionWrite } from "../../middleware/auth.js";
import { enrichPositionRow, hasConstructive } from "../../position-logic.js";
import { godmodeContextFromRow } from "../../godmode-enrich.js";
import { canRunNextAction, getPositionNextAction } from "../../../../shared/production/godmode.js";
import { validateHandoffToCutting } from "../../../../shared/production/constructive-package.js";
import { STAGE_STATUS_FIELD as GODMODE_STAGE_FIELD } from "../../../../shared/production/stages.js";

const HANDOFF_MUTATIONS = {
  handoff_to_cutting: { checkConstructive: true, target: "cutting", value: "Передано" },
  handoff_to_edging: { prerequisite: "cutting", target: "edging", value: "Передано" },
  handoff_to_drilling: { prerequisite: "edging", target: "drilling", value: "Передано" },
  handoff_to_assembly: { prerequisite: "drilling", target: "assembly", value: "Передано" },
  ready_for_install: { prerequisite: "assembly", target: null, value: null }
};

function buildGodmodeContext(beforeRow, planDate) {
  const ctx = godmodeContextFromRow(beforeRow, {
    planDate,
    hasActiveOperatorSession: Number(beforeRow.active_operator_sessions) > 0
  });
  if (!ctx.packageStatus && beforeRow.constructive_package_status) {
    ctx.packageStatus = beforeRow.constructive_package_status;
  }
  if (ctx.hasConstructivePackage == null && beforeRow.has_constructive_package != null) {
    ctx.hasConstructivePackage = Boolean(beforeRow.has_constructive_package);
  }
  if (!ctx.constructivePartsCount && beforeRow.constructive_parts_count != null) {
    ctx.constructivePartsCount = Number(beforeRow.constructive_parts_count) || 0;
  }
  return ctx;
}

/** Godmode next-action handoff для позиції. */
export function registerNextActionRoutes(
  router,
  { loadRow, saveRow, planDateByOrderNumber, mapEnrichedRow }
) {
  router.post("/:id/run-next-action", requirePositionWrite, async (req, res) => {
    const id = Number(req.params.id);
    const beforeRow = await loadRow(id);
    if (!beforeRow) {
      res.status(404).json({ error: "Позицію не знайдено" });
      return;
    }

    const planMap = await planDateByOrderNumber();
    const planDate = planMap.forRow(beforeRow);
    const enriched = enrichPositionRow(beforeRow, { planDate });
    const ctx = buildGodmodeContext(beforeRow, planDate);
    const nextAction = getPositionNextAction(enriched, ctx);
    const requestedType = req.body?.actionType || nextAction.type;
    const mutation = HANDOFF_MUTATIONS[requestedType];

    if (mutation) {
      if (requestedType === "handoff_to_cutting") {
        const handoffCheck = validateHandoffToCutting(beforeRow, ctx);
        if (!handoffCheck.ok) {
          res.status(400).json({ error: handoffCheck.error });
          return;
        }
      } else if (mutation.checkConstructive && !hasConstructive(beforeRow)) {
        res.status(400).json({ error: "Потрібно завантажити конструктив." });
        return;
      }
    } else if (requestedType !== nextAction.type) {
      res.status(400).json({
        error: `Зараз доступна інша дія: ${nextAction.label || nextAction.type}.`,
        nextAction
      });
      return;
    }

    const actionForPermission = mutation
      ? { ...nextAction, type: requestedType, allowed: true, reason: null }
      : nextAction;

    const permission = canRunNextAction(enriched, actionForPermission, req.user, ctx);
    if (!permission.allowed) {
      res.status(permission.code === "ACTION_REQUIRES_INPUT" ? 422 : 403).json({
        code: permission.code || "NOT_ALLOWED",
        error: permission.reason || "Цю дію зараз неможливо виконати."
      });
      return;
    }

    if (!mutation) {
      res.status(422).json({
        code: "ACTION_REQUIRES_INPUT",
        error: permission.reason || "Для цього потрібно виконати дію в інтерфейсі."
      });
      return;
    }

    const existing = { ...beforeRow };

    if (mutation.target) {
      const field = GODMODE_STAGE_FIELD[mutation.target];
      if (mutation.prerequisite) {
        const prereqField = GODMODE_STAGE_FIELD[mutation.prerequisite];
        const prereqStatus = existing[prereqField];
        if (prereqStatus !== "Готово" && prereqStatus !== "Не потрібно") {
          res.status(400).json({
            error: `Спочатку завершіть етап «${mutation.prerequisite}».`
          });
          return;
        }
      }
      if (!existing[field] || existing[field] === "Не розпочато") {
        existing[field] = mutation.value;
      }
    } else if (mutation.prerequisite) {
      const prereqField = GODMODE_STAGE_FIELD[mutation.prerequisite];
      const prereqStatus = existing[prereqField];
      if (prereqStatus !== "Готово" && prereqStatus !== "Не потрібно") {
        res.status(400).json({ error: "Спочатку завершіть збірку." });
        return;
      }
    }

    await saveRow(id, existing, planDate);
    const afterRow = await loadRow(id);
    const stageLabel = mutation.target
      ? {
          cutting: "Порізку",
          edging: "Крайкування",
          drilling: "Присадку",
          assembly: "Збірку"
        }[mutation.target] || mutation.target
      : "встановлення";

    await recordHistory({
      entityType: "position",
      entityId: id,
      action: requestedType === "ready_for_install" ? "update" : "auto_handoff",
      changes: mutation.target
        ? [
            {
              field: mutation.target,
              label: stageLabel,
              oldValue: beforeRow[GODMODE_STAGE_FIELD[mutation.target]] || "Не розпочато",
              newValue: mutation.value
            }
          ]
        : [],
      meta: {
        orderNumber: afterRow.order_number,
        item: afterRow.item,
        summary:
          requestedType === "ready_for_install"
            ? `Позиція #${id} готова до встановлення.`
            : `Позиція #${id} передана на ${stageLabel.toLowerCase()}.`
      },
      actor: auditActor(req) || SYSTEM_ACTOR
    });

    res.json(mapEnrichedRow(afterRow, planMap));
  });
}
