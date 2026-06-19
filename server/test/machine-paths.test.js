import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveUncToMount, SMB_KDT_UNC, SMB_LOG_UNC } from "../src/smb-shares.js";
import { isUncPath, normalizeUncPath, resolveMachineLogPath } from "../src/machine-paths.js";

describe("machine-paths", () => {
  it("розпізнає UNC шлях", () => {
    assert.equal(isUncPath("\\\\192.168.1.203\\KDTsaw"), true);
    assert.equal(isUncPath("//192.168.1.203/KDTsaw"), true);
    assert.equal(isUncPath("/mnt/kdtsaw"), false);
  });

  it("нормалізує UNC без path.resolve", () => {
    assert.equal(normalizeUncPath("//192.168.1.203/KDTsaw"), "\\\\192.168.1.203\\KDTsaw");
    assert.equal(normalizeUncPath("\\\\192.168.1.203\\KDTsaw\\"), "\\\\192.168.1.203\\KDTsaw");
  });

  it("resolveMachineLogPath мапить KDTsaw UNC на /mnt/kdtsaw (не ламає path.resolve)", () => {
    const resolved = resolveMachineLogPath("\\\\192.168.1.203\\KDTsaw");
    assert.equal(resolved, "/mnt/kdtsaw");
    assert.ok(!resolved.includes("192.168"));
  });

  it("мапить KDTsaw UNC на KDT_LOG_MOUNT", () => {
    const prev = process.env.KDT_LOG_MOUNT;
    process.env.KDT_LOG_MOUNT = "/mnt/kdtsaw";
    try {
      assert.equal(resolveUncToMount(SMB_KDT_UNC), "/mnt/kdtsaw");
      assert.equal(resolveUncToMount(SMB_LOG_UNC), "/mnt/enver-log");
      assert.equal(resolveMachineLogPath(SMB_KDT_UNC), "/mnt/kdtsaw");
    } finally {
      if (prev === undefined) delete process.env.KDT_LOG_MOUNT;
      else process.env.KDT_LOG_MOUNT = prev;
    }
  });
});
