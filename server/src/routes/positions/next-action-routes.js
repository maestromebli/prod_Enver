import { recordHistory, SYSTEM_ACTOR } from "../../audit.js";
import { auditActor, requirePositionWrite } from "../../middleware/auth.js";
import { enrichPositionRow } from "../../position-logic.js";
import { canRunNextAction, getPositionNextAction } from "../../../../shared/production/godmode.js";
import { STAGE_STATUS_FIELD as GODMODE_STAGE_FIELD } from "../../../../shared/production/stages.js";

const HANDOFF_MUTATIONS = {
  handoff_to_cutting: { checkConstructive: true, target: "cutting", value: "Передано" },
  handoff_to_edging: { prerequisite: "cutting", target: "edging", value: "Передано" },
  handoff_to_drilling: { prerequisite: "edging", target: "drilling", value: "Передано" },
  handoff_to_assembly: { prerequisite: "drilling", target: "assembly", value: "Передано" },
  handoff_to_packaging: { prerequisite: "assembly", target: "packaging", value: "Передано" },
  ready_for_install: { prerequisite: "packaging", target: null, value: null }
};

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
    const planDate = planMap.get(beforeRow.order_number);
    const enriched = enrichPositionRow(beforeRow, { planDate });
    const ctx = {
      planDate,
      hasAiAnalysis: Number(beforeRow.ai_analysis_count) > 0,
      hasActiveOperatorSession: Number(beforeRow.active_operator_sessions) > 0
    };
    const nextAction = getPositionNextAction(enriched, ctx);
    const requestedType = req.body?.actionType || nextAction.type;

    if (requestedType !== nextAction.type) {
      res.status(400).json({
        error: "Зараз доступна інша дія.",
        nextAction
      });
      return;
    }

    const permission = canRunNextAction(enriched, nextAction, req.user, ctx);
    if (!permission.allowed) {
      res.status(permission.code === "ACTION_REQUIRES_INPUT" ? 422 : 403).json({
        code: permission.code || "NOT_ALLOWED",
        error: permission.reason || "Цю дію зараз неможливо виконати."
      });
      return;
    }

    const mutation = HANDOFF_MUTATIONS[requestedType];
    if (!mutation) {
      res.status(422).json({
        code: "ACTION_REQUIRES_INPUT",
        error: permission.reason || "Для цього потрібно виконати дію в інтерфейсі."
      });
      return;
    }

    const existing = { ...beforeRow };
    if (mutation.checkConstructive && !existing.has_constructive_file) {
      res.status(400).json({ error: "Потрібно завантажити конструктив." });
      return;
    }

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
        res.status(400).json({ error: "Спочатку завершіть пакування." });
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
          assembly: "Збірку",
          packaging: "Пакування"
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
