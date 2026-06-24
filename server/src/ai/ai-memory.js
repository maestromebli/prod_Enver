import { all, one, run } from "../db.js";
import { parseJson, parseJsonObject } from "../json-utils.js";

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/,
  /api[_-]?key/i,
  /password/i,
  /secret/i,
  /bearer\s+/i
];

const POSITIVE_RATINGS = new Set(["good", "correct", "partial", "needs_fix"]);
const NEGATIVE_RATINGS = new Set(["bad", "incorrect", "wrong", "rejected"]);

export function containsSecret(text) {
  const s = String(text || "");
  return SECRET_PATTERNS.some((re) => re.test(s));
}

export function sanitizeLearningText(text, maxLen = 2000) {
  let s = String(text || "").trim();
  if (containsSecret(s)) return "";
  return s.slice(0, maxLen);
}

export function sanitizeLearningPayload(obj) {
  if (!obj || typeof obj !== "object") return {};
  try {
    const raw = JSON.stringify(obj);
    if (containsSecret(raw)) return {};
    return JSON.parse(raw.slice(0, 8000));
  } catch {
    return {};
  }
}

export function isPositiveLearningEvent(rating) {
  const r = String(rating || "").toLowerCase();
  if (NEGATIVE_RATINGS.has(r)) return false;
  return POSITIVE_RATINGS.has(r) || r === "";
}

function mapEventRow(row) {
  return {
    id: row.id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    orderNumber: row.order_number,
    itemName: row.item_name,
    itemType: row.item_type,
    material: row.material,
    source: row.source,
    inputSummary: row.input_summary,
    aiOutput: parseJsonObject(row.ai_output_json),
    correctedOutput: parseJsonObject(row.corrected_output_json),
    correctionText: row.correction_text,
    rating: row.rating,
    confidenceBefore: row.confidence_before,
    confidenceAfter: row.confidence_after,
    tags: parseJson(row.tags_json, []),
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

export async function saveLearningEvent(payload, userId = null) {
  const correctionText = sanitizeLearningText(payload.correctionText);
  if (containsSecret(correctionText)) {
    const err = new Error("Корекція містить заборонені дані");
    err.status = 400;
    throw err;
  }

  const row = await one(
    `INSERT INTO ai_learning_events (
      event_type, entity_type, entity_id, order_number, item_name, item_type, material,
      source, input_summary, ai_output_json, corrected_output_json, correction_text,
      rating, confidence_before, confidence_after, tags_json, created_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING *`,
    [
      String(payload.eventType || "constructive_analysis_feedback").slice(0, 80),
      String(payload.entityType || "").slice(0, 40),
      payload.entityId ?? null,
      sanitizeLearningText(payload.orderNumber, 120),
      sanitizeLearningText(payload.itemName, 200),
      sanitizeLearningText(payload.itemType, 120),
      sanitizeLearningText(payload.material, 120),
      String(payload.source || "ai_analysis").slice(0, 40),
      sanitizeLearningText(payload.inputSummary, 500),
      JSON.stringify(sanitizeLearningPayload(payload.aiOutput)),
      JSON.stringify(sanitizeLearningPayload(payload.correctedOutput)),
      correctionText,
      String(payload.rating || "").slice(0, 40),
      payload.confidenceBefore ?? null,
      payload.confidenceAfter ?? null,
      JSON.stringify(Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : []),
      userId
    ]
  );

  return mapEventRow(row);
}

export async function listLearningEvents({ limit = 50, eventType = null } = {}) {
  const params = [Math.min(limit, 200)];
  let sql = `SELECT * FROM ai_learning_events ORDER BY created_at DESC LIMIT $1`;
  if (eventType) {
    sql = `SELECT * FROM ai_learning_events WHERE event_type = $2 ORDER BY created_at DESC LIMIT $1`;
    params.push(eventType);
  }
  const rows = await all(sql, params);
  return rows.map(mapEventRow);
}

export async function getLearningEventsForMatching(limit = 100) {
  const rows = await all(
    `SELECT * FROM ai_learning_events
     WHERE rating IS NULL OR lower(rating) NOT IN ('bad', 'incorrect', 'wrong', 'rejected')
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(mapEventRow);
}

export async function listEnabledRules() {
  const rows = await all(
    `SELECT id, title, rule_text, applies_to, tags_json, enabled, created_at
     FROM ai_rules WHERE enabled = true ORDER BY created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    rule_text: r.rule_text,
    applies_to: r.applies_to,
    tags: parseJson(r.tags_json, []),
    enabled: r.enabled,
    createdAt: r.created_at
  }));
}

export async function listAllRules() {
  const rows = await all(
    `SELECT id, title, rule_text, applies_to, tags_json, enabled, created_at
     FROM ai_rules ORDER BY created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    rule_text: r.rule_text,
    applies_to: r.applies_to,
    tags: parseJson(r.tags_json, []),
    enabled: r.enabled,
    createdAt: r.created_at
  }));
}

export async function createAiRule({ title, ruleText, appliesTo, tags, userId }) {
  const row = await one(
    `INSERT INTO ai_rules (title, rule_text, applies_to, tags_json, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      sanitizeLearningText(title, 200),
      sanitizeLearningText(ruleText, 1000),
      sanitizeLearningText(appliesTo, 200),
      JSON.stringify(Array.isArray(tags) ? tags : []),
      userId
    ]
  );
  return {
    id: row.id,
    title: row.title,
    rule_text: row.rule_text,
    applies_to: row.applies_to,
    tags: parseJson(row.tags_json, []),
    enabled: row.enabled
  };
}

export async function updateAiRule(id, { title, ruleText, appliesTo, tags, enabled }) {
  const row = await one(
    `UPDATE ai_rules SET
      title = COALESCE($2, title),
      rule_text = COALESCE($3, rule_text),
      applies_to = COALESCE($4, applies_to),
      tags_json = COALESCE($5, tags_json),
      enabled = COALESCE($6, enabled)
     WHERE id = $1 RETURNING *`,
    [
      id,
      title != null ? sanitizeLearningText(title, 200) : null,
      ruleText != null ? sanitizeLearningText(ruleText, 1000) : null,
      appliesTo != null ? sanitizeLearningText(appliesTo, 200) : null,
      tags != null ? JSON.stringify(tags) : null,
      enabled != null ? Boolean(enabled) : null
    ]
  );
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    rule_text: row.rule_text,
    applies_to: row.applies_to,
    tags: parseJson(row.tags_json, []),
    enabled: row.enabled
  };
}

export async function deleteAiRule(id) {
  await run(`DELETE FROM ai_rules WHERE id = $1`, [id]);
}
