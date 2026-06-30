import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAssemblyMissingMessage,
  formatEnver3SyncMessage
} from "../../shared/production/preview-3d-meta.js";

describe("preview-3d-meta", () => {
  it("formatAssemblyMissingMessage для часткової збірки", () => {
    const msg = formatAssemblyMissingMessage({
      missingCodes: ["11", "12"],
      totalPanels: 5,
      assembledCount: 3
    });
    assert.match(msg, /3 з 5/);
    assert.match(msg, /11, 12/);
  });

  it("formatAssemblyMissingMessage null без пропусків", () => {
    assert.equal(formatAssemblyMissingMessage({ missingCodes: [] }), null);
  });

  it("formatEnver3SyncMessage для applied", () => {
    const msg = formatEnver3SyncMessage({ applied: true, panelCount: 14 });
    assert.match(msg, /ENVER3 дописано/);
    assert.match(msg, /14/);
  });
});
