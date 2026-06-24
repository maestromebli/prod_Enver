import { getAiSettings } from "./app-settings.js";
import { getRecentAiFeedback } from "./constructive-ai.js";

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

  if (ctx.selectedOrderNumber) {
    lines.push(`Обране замовлення: ${ctx.selectedOrderNumber}`);
  }
  if (ctx.selectedPosition) {
    const p = ctx.selectedPosition;
    lines.push(
      `Обрана позиція: ${p.orderNumber || "—"} / ${p.item || "—"}, статус ${p.status || "—"}, прогрес ${p.progress ?? "—"}%`
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

  return `Ти — ШІ-помічник ENVER (меблеве виробництво: замовлення, позиції, етапи порізка→кромка→присадка→збірка→пакування→монтаж).

Контекст екрану:
${formatContext(context)}
${hist}

Питання користувача: ${message}

Відповідай українською, коротко й по суті. Пояснюй кроки в інтерфейсі ENVER. Якщо не вистачає даних — скажи, що перевірити.`;
}

async function callOpenAi({ ai, system, user, temperature = 0.3 }) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ai.openaiApiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ai.openaiModel,
      temperature,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    const err = new Error(`OpenAI: ${response.status} ${errBody.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || "",
    tokens: data.usage?.total_tokens || 0
  };
}

function parseJsonContent(content, fallback) {
  try {
    const cleaned = String(content)
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return fallback;
  }
}

export async function getAiAvailability() {
  const ai = await getAiSettings();
  return {
    enabled: ai.enabled,
    hasApiKey: Boolean(ai.openaiApiKey?.trim()),
    model: ai.openaiModel
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
    system: "Ти дружній помічник ENVER. Відповідай українською, структуровано, без зайвої води.",
    user: prompt,
    temperature: 0.4
  });

  return {
    reply: content.trim(),
    aiPowered: true,
    tokens
  };
}
