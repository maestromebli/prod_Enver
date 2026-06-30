import { getDirectoryList } from "../../../shared/production/directories.js";
import { getDirectories } from "../directories-store.js";
import { one } from "../db.js";
import { updatePositionFull } from "../db/position-persistence.js";
import { enrichPositionRow } from "../position-logic.js";
import { logPositionUpdate, SYSTEM_ACTOR } from "../audit.js";
import { getAutomationSettings, saveAutomationSettings } from "./settings.js";
import { STAGE_STATUS_FIELD } from "../roles.js";

const DEFAULT_ASSIGN_DIRECTORY = "Збирачі";

function pickRoundRobin(list, stateKey, settings) {
  if (!list.length) return null;
  const state =
    settings.assignRulesState && typeof settings.assignRulesState === "object"
      ? { ...settings.assignRulesState }
      : {};
  const idx = Number(state[stateKey]) || 0;
  const name = list[idx % list.length];
  state[stateKey] = (idx + 1) % list.length;
  return { name, nextState: state };
}

/**
 * Призначає assembly_responsible з довідника (round-robin), якщо поле порожнє.
 */
export async function applyAssignRulesForPosition(
  positionId,
  stages = [],
  { actor = SYSTEM_ACTOR, settings: settingsIn } = {}
) {
  const settings = settingsIn || (await getAutomationSettings());
  if (!settings.assignRulesEnabled) {
    return { applied: false, reason: "disabled" };
  }

  const needsAssembler = (Array.isArray(stages) ? stages : []).some(
    (key) => STAGE_STATUS_FIELD[key] && ["drilling", "assembly"].includes(key)
  );
  if (!needsAssembler) {
    return { applied: false, reason: "no_assembler_stages" };
  }

  const row = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  if (!row) return { applied: false, reason: "not_found" };
  if (String(row.assembly_responsible || "").trim()) {
    return { applied: false, reason: "already_assigned" };
  }

  const rules = settings.assignRules || {};
  const rule = rules.assembly ||
    rules.default || {
      directory: DEFAULT_ASSIGN_DIRECTORY,
      strategy: "round_robin"
    };

  const directories = await getDirectories();
  const list = getDirectoryList(directories, rule.directory || DEFAULT_ASSIGN_DIRECTORY);
  if (!list.length) {
    return { applied: false, reason: "empty_directory" };
  }

  let assignee = null;
  let nextState = settings.assignRulesState || {};

  if (rule.strategy === "fixed" && rule.name) {
    assignee = String(rule.name).trim();
  } else {
    const picked = pickRoundRobin(list, rule.directory || DEFAULT_ASSIGN_DIRECTORY, settings);
    assignee = picked?.name || null;
    nextState = picked?.nextState || nextState;
  }

  if (!assignee) {
    return { applied: false, reason: "no_assignee" };
  }

  const before = { ...row };
  row.assembly_responsible = assignee;
  const enriched = enrichPositionRow(row);
  await updatePositionFull({ ...enriched, id: positionId });
  const afterRow = await one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
  await logPositionUpdate(before, afterRow, actor);

  if (nextState !== settings.assignRulesState) {
    await saveAutomationSettings({ assignRulesState: nextState });
  }

  console.info(`[automation] assign position=${positionId} assembler=${assignee}`);
  return { applied: true, assignee, stages };
}
