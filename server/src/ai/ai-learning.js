import { getAiSettings } from "../app-settings.js";
import {
  getLearningEventsForMatching,
  isPositiveLearningEvent,
  listEnabledRules,
  listLearningEvents
} from "./ai-memory.js";
import { combinedSimilarity, jaccardSimilarity } from "./similarity.js";

const STAGE_LABELS = {
  cutting: "порізка",
  edging: "крайкування",
  drilling: "присадка",
  assembly: "збірка",
  packaging: "пакування"
};

function parseCorrectedTasks(event) {
  const out = event.correctedOutput || {};
  const tasks = out.suggestedTasks || out.correctedTasks || out.tasks || [];
  if (Array.isArray(tasks)) {
    return tasks.map((t) => (typeof t === "string" ? t : t?.stage)).filter(Boolean);
  }
  return [];
}

function eventLesson(event) {
  if (event.correctionText?.trim()) return event.correctionText.trim();
  const tasks = parseCorrectedTasks(event);
  if (tasks.length) {
    const labels = tasks.map((s) => STAGE_LABELS[s] || s).join(", ");
    return `Для «${event.itemName || "виріб"}» часто потрібні етапи: ${labels}`;
  }
  return "";
}

/**
 * Перетворює сирі події в короткі уроки для prompt.
 */
export function buildLearningSummary(events = []) {
  if (!events.length) return "";

  const byItemType = new Map();
  const stageAdditions = new Map();

  for (const ev of events) {
    if (!isPositiveLearningEvent(ev.rating)) continue;
    const key = (ev.itemType || ev.itemName || "загальне").toLowerCase();
    const bucket = byItemType.get(key) || [];
    bucket.push(ev);
    byItemType.set(key, bucket);

    const aiTasks = (ev.aiOutput?.suggestedTasks || []).map((t) => t.stage || t);
    const corrected = parseCorrectedTasks(ev);
    for (const stage of corrected) {
      if (!aiTasks.includes(stage)) {
        stageAdditions.set(stage, (stageAdditions.get(stage) || 0) + 1);
      }
    }
  }

  const lines = [];
  for (const [, group] of byItemType) {
    if (group.length < 2) continue;
    const lesson = eventLesson(group[0]);
    if (lesson) lines.push(lesson);
  }

  for (const [stage, count] of stageAdditions) {
    if (count >= 2) {
      const label = STAGE_LABELS[stage] || stage;
      lines.push(
        `Для схожих виробів частіше додавали етап ${label}. Якщо AI не бачить ${stage} у файлі — додай warning і знизь confidence.`
      );
    }
  }

  return lines.slice(0, 8).join("\n");
}

function ruleMatches(rule, { itemName, itemType, material }) {
  const applies = String(rule.applies_to || "")
    .trim()
    .toLowerCase();
  if (!applies || applies === "*") return true;
  const hay = `${itemName} ${itemType} ${material}`.toLowerCase();
  return hay.includes(applies) || jaccardSimilarity(applies, hay) > 0.3;
}

/**
 * Релевантний контекст для AI-аналізу конструктива.
 */
export async function getRelevantLearningContext({
  itemName = "",
  itemType = "",
  material = "",
  extractedText: _extractedText = "",
  limit = 5
} = {}) {
  const aiSettings = await getAiSettings();
  const useMemory = aiSettings.useLearningMemory !== false;
  if (!useMemory) {
    return { examples: [], rules: [], summary: "", conflicting: false, frequentMistakeCount: 0 };
  }

  const [events, rules] = await Promise.all([getLearningEventsForMatching(80), listEnabledRules()]);

  const scored = events
    .map((ev) => ({
      event: ev,
      score: combinedSimilarity({ itemName, itemType, material }, ev)
    }))
    .filter((x) => x.score >= 0.25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit * 2);

  const positiveExamples = [];
  const mistakeCount = { count: 0 };
  const stageSets = [];

  for (const { event, score } of scored) {
    if (!isPositiveLearningEvent(event.rating)) {
      if (event.rating === "bad" || event.rating === "incorrect") {
        mistakeCount.count += 1;
      }
      continue;
    }

    const lesson = eventLesson(event);
    if (!lesson) continue;

    positiveExamples.push({
      reason: score >= 0.7 ? "Схожий виріб" : "Частково схожий виріб",
      lesson,
      correctedTasks: parseCorrectedTasks(event),
      warning: event.correctedOutput?.warning || "",
      score
    });

    if (positiveExamples.length >= limit) break;
    stageSets.push(new Set(parseCorrectedTasks(event)));
  }

  const matchedRules = rules.filter((r) => ruleMatches(r, { itemName, itemType, material }));

  let conflicting = false;
  if (stageSets.length >= 2) {
    const first = stageSets[0];
    for (let i = 1; i < stageSets.length; i++) {
      const other = stageSets[i];
      const diff = [...first].some((s) => !other.has(s)) || [...other].some((s) => !first.has(s));
      if (diff) {
        conflicting = true;
        break;
      }
    }
  }

  const summaryParts = [];
  if (positiveExamples.length) {
    summaryParts.push(positiveExamples.map((e, i) => `${i + 1}. ${e.lesson}`).join("\n"));
  }
  const patternSummary = buildLearningSummary(scored.map((s) => s.event));
  if (patternSummary) summaryParts.push(patternSummary);

  return {
    examples: positiveExamples.slice(0, limit),
    rules: matchedRules.slice(0, 8),
    summary: summaryParts.join("\n").slice(0, 3000),
    conflicting,
    frequentMistakeCount: mistakeCount.count
  };
}

/**
 * Автоматичні pattern insights для екрану налаштувань.
 */
export async function detectLearningPatterns() {
  const events = await listLearningEvents({ limit: 200 });
  const patterns = [];

  const drillingMissed = events.filter((e) => {
    const ai = (e.aiOutput?.suggestedTasks || []).map((t) => t.stage);
    const corrected = parseCorrectedTasks(e);
    return corrected.includes("drilling") && !ai.includes("drilling");
  });
  if (drillingMissed.length >= 2) {
    patterns.push({
      type: "missing_stage",
      stage: "drilling",
      count: drillingMissed.length,
      message: "AI часто не пропонує присадку (drilling) для схожих виробів"
    });
  }

  const badPdf = events.filter(
    (e) =>
      e.inputSummary?.toLowerCase().includes("pdf") &&
      (e.rating === "bad" || e.rating === "partial")
  );
  if (badPdf.length >= 2) {
    patterns.push({
      type: "low_quality_source",
      source: "pdf",
      count: badPdf.length,
      message: "PDF-конструктиви часто дають низьку якість аналізу"
    });
  }

  const packagingProblems = events.filter((e) =>
    String(e.correctionText || "")
      .toLowerCase()
      .includes("пакуван")
  );
  if (packagingProblems.length >= 2) {
    patterns.push({
      type: "stage_problem",
      stage: "packaging",
      count: packagingProblems.length,
      message: "Пакування часто стає проблемою для кухонь і складних виробів"
    });
  }

  const ratings = { good: 0, partial: 0, bad: 0, other: 0 };
  let corrections = 0;
  const manualStages = new Map();

  for (const e of events) {
    const r = String(e.rating || "").toLowerCase();
    if (r === "good" || r === "correct") ratings.good += 1;
    else if (r === "partial" || r === "needs_fix") ratings.partial += 1;
    else if (r === "bad" || r === "incorrect") ratings.bad += 1;
    else ratings.other += 1;

    if (e.correctionText?.trim()) corrections += 1;

    for (const stage of parseCorrectedTasks(e)) {
      manualStages.set(stage, (manualStages.get(stage) || 0) + 1);
    }
  }

  const topManualStages = [...manualStages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([stage, count]) => ({ stage, count }));

  return {
    patterns,
    stats: {
      totalEvents: events.length,
      ratedGood: ratings.good,
      ratedPartial: ratings.partial,
      ratedBad: ratings.bad,
      corrections,
      topManualStages
    }
  };
}

export async function getLearningSummaryForAdmin() {
  const [patterns, recent] = await Promise.all([
    detectLearningPatterns(),
    listLearningEvents({ limit: 10 })
  ]);
  const lessons = buildLearningSummary(recent);
  return { ...patterns, recentCorrections: recent, frequentLessons: lessons };
}
