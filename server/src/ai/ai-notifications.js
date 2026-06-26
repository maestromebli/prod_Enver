import { parseJsonObject } from "../json-utils.js";
import { getAiSettings } from "../app-settings.js";

const CRITICAL_PATTERNS = [/критичн/i, /блокер/i, /ризик/i, /небезпеч/i];

/** Типи сповіщень, які бачить лише admin. */
const ADMIN_ONLY_TYPES = new Set(["ai_key_missing", "ai_learning_insight", "ai_rule_available"]);

/** Типи для production / admin (не operator). */
const PRODUCTION_TYPES = new Set([
  "ai_analysis_needs_review",
  "ai_risk_found",
  "ai_ready_create_tasks",
  "tasks_not_created",
  "run_ai_analysis",
  "ai_analysis_low_quality"
]);

function parseLatestAnalysis(row) {
  const raw = row?.latest_ai_summary_json ?? row?.latestAiSummaryJson;
  if (!raw) return null;
  const parsed = typeof raw === "string" ? parseJsonObject(raw) : raw;
  const quality = parsed.quality || parsed._meta?.quality;
  return {
    summary: parsed.summary || "",
    warnings: parsed.warnings || [],
    suggestedTasks: parsed.suggestedTasks || [],
    quality,
    missingInfo: parsed.missingInfo || []
  };
}

function hasCriticalWarnings(warnings = []) {
  return warnings.some((w) => CRITICAL_PATTERNS.some((re) => re.test(String(w))));
}

function entityLabel(row) {
  const orderNumber = row.order_number || row.orderNumber || "";
  const item = row.item || "";
  return orderNumber && item ? `${orderNumber} / ${item}` : orderNumber || item || "—";
}

function productionStagesActive(row) {
  const fields = ["cutting_status", "edging_status", "drilling_status", "assembly_status"];
  return fields.some((f) => {
    const v = row[f];
    return v && v !== "Не розпочато";
  });
}

/**
 * Генерує AI-сповіщення з позицій (потрібен latest_ai_summary_json у row).
 */
export function buildAiNotifications({ positions = [], now = new Date() } = {}) {
  const ts = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const notifications = [];

  for (const row of positions) {
    if (row.parent_id || row.parentId) continue;
    const id = row.id;
    const label = entityLabel(row);
    const hasFile = Boolean(row.has_constructive_file || row.hasConstructiveFile);
    const aiCount = Number(row.ai_analysis_count ?? row.aiAnalysisCount) || 0;
    const analysis = parseLatestAnalysis(row);
    const tasksExist = productionStagesActive(row);

    if (hasFile && aiCount === 0) {
      notifications.push({
        id: `position-${id}-ai-not-run`,
        type: "run_ai_analysis",
        level: "info",
        title: "ШІ-аналіз не запускався",
        message: `Позиція ${label}: запустіть аналіз конструктива.`,
        entityType: "position",
        entityId: id,
        actionType: "run_ai_analysis",
        audience: ["admin", "production", "manager"],
        createdAt: ts
      });
      continue;
    }

    if (!analysis) continue;

    const quality = analysis.quality || {};

    if (quality.needsHumanReview) {
      notifications.push({
        id: `position-${id}-ai-review`,
        type: "ai_analysis_needs_review",
        level: "warning",
        title: "AI-аналіз потребує перевірки",
        message: `Позиція ${label}: ${quality.reasons?.[0] || "перевірте рекомендації вручну"}.`,
        entityType: "position",
        entityId: id,
        actionType: "create_tasks_from_ai",
        audience: ["admin", "production", "manager"],
        createdAt: ts
      });
    }

    if (hasCriticalWarnings(analysis.warnings)) {
      notifications.push({
        id: `position-${id}-ai-risk`,
        type: "ai_risk_found",
        level: "warning",
        title: "AI знайшов ризик у конструктиві",
        message: `Позиція ${label}: ${analysis.warnings[0]}`,
        entityType: "position",
        entityId: id,
        actionType: "run_ai_analysis",
        audience: ["admin", "production", "manager"],
        createdAt: ts
      });
    }

    if (quality.score != null && quality.score < 0.5) {
      notifications.push({
        id: `position-${id}-ai-low-quality`,
        type: "ai_analysis_low_quality",
        level: "warning",
        title: "Низька якість AI-аналізу",
        message: `Позиція ${label}: перевірте файл конструктива та корекції.`,
        entityType: "position",
        entityId: id,
        actionType: "run_ai_analysis",
        audience: ["admin", "production"],
        createdAt: ts
      });
    }

    if (quality.safeToCreateTasks && !tasksExist) {
      notifications.push({
        id: `position-${id}-ai-ready-tasks`,
        type: "ai_ready_create_tasks",
        level: "info",
        title: "AI готовий створити задачі",
        message: `Позиція ${label}: можна створити рекомендовані задачі після підтвердження.`,
        entityType: "position",
        entityId: id,
        actionType: "create_tasks_from_ai",
        audience: ["admin", "production"],
        createdAt: ts
      });
    }
  }

  return notifications;
}

export async function buildGlobalAiNotifications({ now = new Date() } = {}) {
  const ts = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const ai = await getAiSettings();
  const items = [];

  if (!ai.openaiApiKey?.trim()) {
    items.push({
      id: "global-ai-key-missing",
      type: "ai_key_missing",
      level: "warning",
      title: "Ключ OpenAI не налаштовано",
      message: "Додайте API ключ у налаштуваннях ШІ для аналізу конструктивів.",
      entityType: "settings",
      entityId: 0,
      actionType: "open_settings_ai",
      audience: ["admin"],
      createdAt: ts
    });
  }

  if (ai.enabled === false) {
    items.push({
      id: "global-ai-disabled",
      type: "ai_disabled",
      level: "info",
      title: "ШІ вимкнено",
      message: "Увімкніть ШІ в налаштуваннях для аналізу конструктивів.",
      entityType: "settings",
      entityId: 0,
      actionType: "open_settings_ai",
      audience: ["admin"],
      createdAt: ts
    });
  }

  return items;
}

export function mergeAiNotifications(baseNotifications, aiNotifications) {
  const seen = new Set(baseNotifications.map((n) => n.id));
  const merged = [...baseNotifications];
  for (const n of aiNotifications) {
    if (!seen.has(n.id)) {
      merged.push(n);
      seen.add(n.id);
    }
  }
  const levelRank = { blocker: 0, warning: 1, info: 2 };
  return merged.sort((a, b) => (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9));
}

/** Фільтр сповіщень за роллю користувача. */
export function filterNotificationsForRole(notifications, role) {
  const r = String(role || "manager").toLowerCase();
  if (r === "admin") return notifications;

  return notifications.filter((n) => {
    if (Array.isArray(n.audience) && n.audience.length) {
      return n.audience.includes(r) || (r === "manager" && n.audience.includes("manager"));
    }
    if (ADMIN_ONLY_TYPES.has(n.type)) return false;
    if (r === "operator") {
      return n.type === "operator_note" || n.type === "operator_task_note";
    }
    if (r === "manager") {
      return (
        !ADMIN_ONLY_TYPES.has(n.type) &&
        (PRODUCTION_TYPES.has(n.type) ||
          ["overdue", "ready_for_install", "missing_constructive", "install"].some((t) =>
            String(n.type).includes(t)
          ) ||
          n.level === "blocker")
      );
    }
    if (r === "production") {
      return !ADMIN_ONLY_TYPES.has(n.type);
    }
    return true;
  });
}
