import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAutomationSettings } from "../src/automation/settings.js";
import {
  productionTasksExist,
  selectStagesFromAnalysis
} from "../src/automation/auto-create-tasks.js";

describe("automation settings", () => {
  it("нормалізує URL і годину", () => {
    const s = normalizeAutomationSettings({
      overdueDigestHourKyiv: 99,
      overdueDigestWebhookUrl: "ftp://bad",
      autoCreateTasksMinConfidence: 2
    });
    assert.equal(s.overdueDigestHourKyiv, 23);
    assert.equal(s.overdueDigestWebhookUrl, "");
    assert.equal(s.autoCreateTasksMinConfidence, 1);
  });

  it("приймає https webhook", () => {
    const s = normalizeAutomationSettings({
      procurementWebhookUrl: "https://hooks.example.com/p"
    });
    assert.equal(s.procurementWebhookUrl, "https://hooks.example.com/p");
  });
});

describe("auto-create tasks", () => {
  it("productionTasksExist — етап Передано", () => {
    assert.equal(productionTasksExist({ cutting_status: "Передано" }), true);
    assert.equal(productionTasksExist({ cutting_status: "Не розпочато" }), false);
  });

  it("selectStagesFromAnalysis strict — лише safe + high confidence", () => {
    const stages = selectStagesFromAnalysis(
      {
        quality: { safeToCreateTasks: true, needsHumanReview: false },
        suggestedTasks: [
          { stage: "cutting", needed: true, confidence: 0.9 },
          { stage: "edging", needed: true, confidence: 0.7 }
        ]
      },
      { mode: "strict", minConfidence: 0.8 }
    );
    assert.deepEqual(stages, ["cutting"]);
  });

  it("selectStagesFromAnalysis assisted — без safe, але без review", () => {
    const stages = selectStagesFromAnalysis(
      {
        quality: { safeToCreateTasks: false, needsHumanReview: false },
        suggestedTasks: [
          { stage: "cutting", needed: true, confidence: 0.85 },
          { stage: "drilling", needed: true, confidence: 0.6 }
        ]
      },
      { mode: "assisted", minConfidence: 0.8 }
    );
    assert.deepEqual(stages, ["cutting"]);
  });

  it("selectStagesFromAnalysis — пропускає при needsHumanReview", () => {
    const stages = selectStagesFromAnalysis(
      {
        quality: { safeToCreateTasks: true, needsHumanReview: true },
        suggestedTasks: [{ stage: "cutting", needed: true, confidence: 0.95 }]
      },
      { mode: "assisted" }
    );
    assert.deepEqual(stages, []);
  });
});
