import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { metricsSnapshot, recordHttpRequest } from "../src/metrics.js";

describe("metrics", () => {
  it("recordHttpRequest рахує запити та 5xx", () => {
    const before = metricsSnapshot().httpRequests;
    recordHttpRequest(200);
    recordHttpRequest(503);
    const snap = metricsSnapshot();
    assert.equal(snap.httpRequests, before + 2);
    assert.ok(snap.httpErrors >= 1);
    assert.ok(snap.uptimeSec >= 0);
  });
});
