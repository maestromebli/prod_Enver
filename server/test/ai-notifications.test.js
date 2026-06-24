import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAiNotifications,
  filterNotificationsForRole,
  mergeAiNotifications
} from "../src/ai/ai-notifications.js";

describe("ai-notifications", () => {
  it("потребує перевірки при needsHumanReview", () => {
    const items = buildAiNotifications({
      positions: [
        {
          id: 1,
          order_number: "A-1",
          item: "Шафа",
          has_constructive_file: true,
          ai_analysis_count: 1,
          latest_ai_summary_json: JSON.stringify({
            summary: "test",
            quality: { needsHumanReview: true, reasons: ["Низька впевненість AI"] }
          })
        }
      ]
    });
    assert.ok(items.some((n) => n.type === "ai_analysis_needs_review"));
  });

  it("admin бачить ai_key_missing", () => {
    const items = [
      {
        id: "g1",
        type: "ai_key_missing",
        level: "warning",
        audience: ["admin"]
      }
    ];
    assert.equal(filterNotificationsForRole(items, "admin").length, 1);
    assert.equal(filterNotificationsForRole(items, "production").length, 0);
  });

  it("production не бачить admin-only", () => {
    const items = [
      { id: "a", type: "ai_key_missing", level: "warning", audience: ["admin"] },
      {
        id: "b",
        type: "ai_analysis_needs_review",
        level: "warning",
        audience: ["admin", "production"]
      }
    ];
    const filtered = filterNotificationsForRole(items, "production");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].type, "ai_analysis_needs_review");
  });

  it("mergeAiNotifications без дублів id", () => {
    const merged = mergeAiNotifications(
      [{ id: "x", level: "info" }],
      [
        { id: "x", level: "warning" },
        { id: "y", level: "info" }
      ]
    );
    assert.equal(merged.length, 2);
  });
});
