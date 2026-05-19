import { db } from "./db.js";
import { STAGE_STATUS_FIELD } from "./roles.js";
import { enrichPositionRow } from "./position-logic.js";
import { extractTokens } from "./machine-log-parser.js";
import { getAiSettings } from "./app-settings.js";

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenOverlap(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hit = 0;
  for (const t of a) {
    if (setB.has(t)) hit += 1;
  }
  return hit / Math.max(a.length, b.length);
}

function positionSearchText(row) {
  return normalize(
    [row.order_number, row.object, row.item, row.item_type, row.note, row.problem].join(" ")
  );
}

function heuristicScore(parsed, row) {
  const logTokens = parsed.tokens || [];
  const posTokens = normalize(positionSearchText(row)).split(/\s+/).filter(Boolean);
  let score = tokenOverlap(logTokens, posTokens);

  const job = normalize(parsed.jobRef);
  const prog = normalize(parsed.programName);
  const blob = positionSearchText(row);

  if (job && blob.includes(job)) score += 0.35;
  if (prog && blob.includes(prog)) score += 0.3;

  const orderNum = normalize(row.order_number);
  for (const t of logTokens) {
    if (orderNum && (orderNum.includes(t) || t.includes(orderNum))) score += 0.2;
  }

  return Math.min(1, score);
}

export function getMatchCandidates(stageKey, { activeSessionPositionId } = {}) {
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!field) return { active: null, queue: [] };

  const active = activeSessionPositionId
    ? db.prepare("SELECT * FROM positions WHERE id = ?").get(activeSessionPositionId)
    : null;

  const queue = db
    .prepare(
      `SELECT p.*, o.priority AS order_priority, o.plan_date
       FROM positions p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.${field} IN ('Передано', 'В роботі')
       ORDER BY
         CASE p.${field} WHEN 'В роботі' THEN 0 ELSE 1 END,
         CASE WHEN p.problem != '' THEN 0 ELSE 1 END,
         CASE WHEN p.overdue_days > 0 THEN 0 ELSE 1 END,
         CASE o.priority WHEN 'Високий' THEN 0 WHEN 'Середній' THEN 1 ELSE 2 END,
         p.overdue_days DESC,
         p.id`
    )
    .all()
    .map((r) => enrichPositionRow(r, { planDate: r.plan_date }));

  return { active, queue };
}

export function rankCandidates(parsed, candidates) {
  const scored = candidates.map((row) => ({
    row,
    score: heuristicScore(parsed, row),
    reason: buildHeuristicReason(parsed, row)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function buildHeuristicReason(parsed, row) {
  const bits = [];
  if (parsed.jobRef && positionSearchText(row).includes(normalize(parsed.jobRef))) {
    bits.push(`збіг job: ${parsed.jobRef}`);
  }
  if (parsed.programName && positionSearchText(row).includes(normalize(parsed.programName))) {
    bits.push(`збіг програми: ${parsed.programName}`);
  }
  if (row.order_number) bits.push(`замовлення ${row.order_number}`);
  return bits.join("; ") || "токени в логу та позиції";
}

async function matchWithOpenAI(parsed, candidates) {
  const ai = getAiSettings();
  if (!ai.enabled || !ai.openaiApiKey?.trim()) return null;

  const statusField = STAGE_STATUS_FIELD[stageKey];
  const list = candidates.slice(0, 12).map((c, i) => ({
    index: i,
    id: c.id,
    order_number: c.order_number,
    object: c.object,
    item: c.item,
    stage_status: statusField ? c[statusField] : ""
  }));

  const prompt = `Ти асистент виробництва меблів. Зістав рядок логу станка з однією позицією замовлення.
Лог: ${JSON.stringify({
    program: parsed.programName,
    job: parsed.jobRef,
    type: parsed.eventType,
    progress: parsed.progress,
    tokens: (parsed.tokens || []).slice(0, 20)
  })}
Кандидати: ${JSON.stringify(list)}
Відповідай ТІЛЬКИ JSON: {"positionId": number|null, "confidence": 0-1, "reason": "українською коротко"}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ai.openaiApiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: ai.openaiModel,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Відповідай лише валідним JSON без markdown." },
          { role: "user", content: prompt }
        ]
      }),
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsedAi = JSON.parse(text);
    const id = Number(parsedAi.positionId);
    if (!id) return null;
    const row = candidates.find((c) => c.id === id);
    if (!row) return null;
    return {
      positionId: id,
      confidence: Math.max(0, Math.min(1, Number(parsedAi.confidence) || 0.7)),
      method: "openai",
      reason: String(parsedAi.reason || "AI-зіставлення")
    };
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * @param {object} parsed — результат parseLogLine + stageKey
 */
export async function matchLogToTask(stageKey, parsed, logEventId, { operatorSessionId } = {}) {
  parsed.stageKey = stageKey;

  const session = operatorSessionId
    ? db.prepare("SELECT * FROM operator_sessions WHERE id = ?").get(operatorSessionId)
    : db
        .prepare(
          `SELECT * FROM operator_sessions
           WHERE stage_key = ? AND finished_at IS NULL
           ORDER BY started_at DESC LIMIT 1`
        )
        .get(stageKey);

  const activeId = session?.position_id;
  const { active, queue } = getMatchCandidates(stageKey, { activeSessionPositionId: activeId });

  const candidates = [];
  if (active) candidates.push(active);
  for (const q of queue) {
    if (!candidates.some((c) => c.id === q.id)) candidates.push(q);
  }

  if (!candidates.length) return null;

  const config = db.prepare("SELECT ai_matching_enabled FROM machine_config WHERE stage_key = ?").get(stageKey);
  const aiAllowed = config?.ai_matching_enabled !== 0;

  let best = null;

  if (aiAllowed) {
    const aiResult = await matchWithOpenAI(parsed, candidates);
    if (aiResult) {
      best = { ...aiResult, row: candidates.find((c) => c.id === aiResult.positionId) };
    }
  }

  if (!best) {
    const ranked = rankCandidates(parsed, candidates);
    const top = ranked[0];
    if (!top || top.score < 0.12) return null;
    best = {
      positionId: top.row.id,
      confidence: top.score,
      method: "heuristic",
      reason: top.reason,
      row: top.row
    };
  }

  if (activeId && best.positionId === activeId) {
    best.confidence = Math.min(1, best.confidence + 0.15);
    best.reason = `${best.reason}; активна сесія оператора`;
  }

  const status = best.confidence >= 0.55 ? "auto" : "suggested";

  const result = db
    .prepare(
      `INSERT INTO machine_task_matches (
        stage_key, log_event_id, position_id, operator_session_id,
        confidence, method, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      stageKey,
      logEventId,
      best.positionId,
      session?.id ?? null,
      best.confidence,
      best.method,
      best.reason,
      status
    );

  db.prepare(
    `UPDATE machine_config SET
      last_match_position_id = ?,
      last_match_confidence = ?,
      last_match_summary = ?,
      updated_at = datetime('now')
     WHERE stage_key = ?`
  ).run(
    best.positionId,
    best.confidence,
    `${best.row.order_number} — ${best.row.item}`.slice(0, 200),
    stageKey
  );

  return {
    matchId: result.lastInsertRowid,
    positionId: best.positionId,
    orderNumber: best.row.order_number,
    item: best.row.item,
    object: best.row.object,
    confidence: best.confidence,
    method: best.method,
    reason: best.reason,
    status
  };
}

export function getLatestMatch(stageKey) {
  const row = db
    .prepare(
      `SELECT m.*, p.order_number, p.item, p.object
       FROM machine_task_matches m
       JOIN positions p ON p.id = m.position_id
       WHERE m.stage_key = ?
       ORDER BY m.created_at DESC LIMIT 1`
    )
    .get(stageKey);

  if (!row) return null;
  return {
    id: row.id,
    positionId: row.position_id,
    orderNumber: row.order_number,
    item: row.item,
    object: row.object,
    confidence: row.confidence,
    method: row.method,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at
  };
}
