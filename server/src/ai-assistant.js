import { getAiSettings } from "./app-settings.js";
import { getRecentAiFeedback } from "./constructive-ai.js";
import { callOpenAiChat } from "./ai/openai-client.js";
import { buildActionsPromptBlock, validateAssistantActions } from "./ai/assistant-actions.js";
import { parseAiJsonContent } from "./ai/validate-analysis.js";

function assertAiReady(ai) {
  if (!ai.enabled) {
    const err = new Error("ШІ вимкнено в налаштуваннях");
    err.status = 400;
    throw err;
  }
  if (!ai.openaiApiKey?.trim()) {
    const err = new Error("Не налаштовано OpenAI API ключ");
    err.status = 400;
    throw err;
  }
}

function formatContext(ctx = {}) {
  const lines = [
    `Роль: ${ctx.role || "користувач"}`,
    `Ім'я: ${ctx.userName || "—"}`,
    `Екран: ${ctx.view || "main"} / вкладка «${ctx.tab || "—"}»`
  ];

  if (ctx.kpis) {
    const k = ctx.kpis;
    lines.push(
      `KPI: активні ${k.activeOrders ?? "—"}, у виробництві ${k.inProduction ?? "—"}, прострочені ${k.overdueCount ?? "—"}, до монтажу ${k.readyInstall ?? "—"}`
    );
  }

  if (ctx.selectedOrderId) {
    lines.push(`Обране замовлення id: ${ctx.selectedOrderId}`);
  }
  if (ctx.selectedOrderNumber) {
    lines.push(`Обране замовлення: ${ctx.selectedOrderNumber}`);
  }
  if (ctx.selectedPosition) {
    const p = ctx.selectedPosition;
    lines.push(
      `Обрана позиція id: ${p.id ?? "—"}, ${p.orderNumber || "—"} / ${p.item || "—"}, статус ${p.status || "—"}, прогрес ${p.progress ?? "—"}%`
    );
  }
  if (ctx.operatorStage) {
    lines.push(`Етап оператора: ${ctx.operatorStage}`);
  }
  if (ctx.filters?.status) {
    lines.push(`Фільтр статусу: ${ctx.filters.status}`);
  }
  if (ctx.filters?.search) {
    lines.push(`Пошук: ${ctx.filters.search}`);
  }
  if (ctx.counts) {
    const c = ctx.counts;
    lines.push(
      `Позиції: прострочені ${c.overdue ?? 0}, проблеми ${c.problems ?? 0}, без конструктива ${c.withoutConstructive ?? 0}`
    );
  }
  if (Array.isArray(ctx.problemItems) && ctx.problemItems.length) {
    lines.push(`Проблемні позиції: ${ctx.problemItems.slice(0, 5).join("; ")}`);
  }
  if (Array.isArray(ctx.overdueItems) && ctx.overdueItems.length) {
    lines.push(`Прострочені: ${ctx.overdueItems.slice(0, 5).join("; ")}`);
  }

  return lines.join("\n");
}

function buildHintsPrompt(context, feedback) {
  const examples =
    feedback.length > 0
      ? `\n\nПриклади корекцій від адміністратора:\n${feedback
          .map((f, i) => `${i + 1}. ${f.correction_text}`)
          .join("\n")}`
      : "";

  return `Ти — ШІ-помічник системи ENVER (меблеве виробництво). Користувач зараз у інтерфейсі.

Контекст:
${formatContext(context)}

Дай 3–5 коротких практичних підказок українською — що перевірити, що зробити далі, на що звернути увагу.
Враховуй роль користувача. Не вигадуй дані, яких немає в контексті.

Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "hints": [
    { "priority": "high|normal", "text": "підказка", "action": "опційна дія (напр. відкрити позиції з проблемою)" }
  ],
  "summary": "одне речення — головний фокус зараз"
}${examples}`;
}

function buildChatPrompt(context, message, history = []) {
  const hist =
    history.length > 0
      ? `\n\nПопередній діалог:\n${history
          .slice(-6)
          .map((m) => `${m.role === "user" ? "Користувач" : "Помічник"}: ${m.content}`)
          .join("\n")}`
      : "";

  return `Ти — ШІ-помічник ENVER (меблеве виробництво: замовлення, позиції, етапи порізка→кромка→присадка→збірка→монтаж).

Контекст екрану:
${formatContext(context)}
${hist}

Питання користувача: ${message}

Правила:
- Не вигадуй замовлення, позиції, клієнтів, дати або статуси.
- Якщо даних немає в контексті — скажи, що потрібно відкрити відповідний екран.
- Дії пропонуй тільки з дозволеного списку.
- Не обіцяй виконати дію, якщо немає action.
- Не показуй технічні деталі користувачу.
- Усі зміни тільки через safe endpoint і підтвердження людини.

${buildActionsPromptBlock()}`;
}

async function callOpenAi({ ai, system, user, temperature = 0.3 }) {
  const { content, tokens } = await callOpenAiChat({
    apiKey: ai.openaiApiKey,
    model: ai.openaiModel,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });
  return { content, tokens };
}

function parseJsonContent(content, fallback) {
  const parsed = parseAiJsonContent(content);
  return parsed.ok ? parsed.data : fallback;
}

export async function getAiAvailability() {
  const ai = await getAiSettings();
  return {
    enabled: ai.enabled,
    hasApiKey: Boolean(ai.openaiApiKey?.trim()),
    model: ai.openaiModel,
    useLearningMemory: ai.useLearningMemory !== false
  };
}

export async function fetchAssistantHints(context) {
  const ai = await getAiSettings();
  assertAiReady(ai);

  const feedback = await getRecentAiFeedback(3);
  const prompt = buildHintsPrompt(context, feedback);
  const { content, tokens } = await callOpenAi({
    ai,
    system:
      "Ти експерт з меблевого виробництва та системи ENVER. Відповідай українською. Повертай лише JSON.",
    user: prompt,
    temperature: 0.25
  });

  const parsed = parseJsonContent(content, { hints: [], summary: "" });
  const hints = Array.isArray(parsed.hints)
    ? parsed.hints
        .filter((h) => h && typeof h.text === "string" && h.text.trim())
        .map((h) => ({
          priority: h.priority === "high" ? "high" : "normal",
          text: h.text.trim(),
          action: typeof h.action === "string" ? h.action.trim() : ""
        }))
        .slice(0, 6)
    : [];

  return {
    hints,
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    aiPowered: true,
    tokens
  };
}

export async function chatWithAssistant({ message, context, history = [] }) {
  const ai = await getAiSettings();
  assertAiReady(ai);

  const prompt = buildChatPrompt(context, message, history);
  const { content, tokens } = await callOpenAi({
    ai,
    system:
      "Ти дружній помічник ENVER. Відповідай українською. Для chat повертай JSON з reply, actions, warnings.",
    user: prompt,
    temperature: 0.35
  });

  const parsed = parseJsonContent(content, null);
  if (parsed?.reply) {
    const actions = validateAssistantActions(parsed.actions);
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings
          .map((w) => String(w).trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    return {
      reply: String(parsed.reply).trim(),
      actions,
      warnings,
      aiPowered: true,
      tokens
    };
  }

  return {
    reply: content.trim(),
    actions: [],
    warnings: [],
    aiPowered: true,
    tokens
  };
}
