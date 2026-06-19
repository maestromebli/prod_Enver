import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveUncToMount, SMB_KDT_UNC, SMB_LOG_UNC } from "../src/smb-shares.js";
import {
  isUncPath,
  normalizeUncPath,
  resolveMachineLogPath,
  resolveMachineStoragePath
} from "../src/machine-paths.js";

describe("machine-paths", () => {
  it("розпізнає UNC шлях", () => {
    assert.equal(isUncPath("\\\\192.168.1.203\\KDTsaw"), true);
    assert.equal(isUncPath("//192.168.1.203/KDTsaw"), true);
    assert.equal(isUncPath("\\192.168.1.203\\Log"), true);
    assert.equal(isUncPath("192.168.1.203Log"), true);
    assert.equal(isUncPath("/mnt/kdtsaw"), false);
  });

  it("відновлює пошкоджений UNC (з'їдений \\L)", () => {
    assert.equal(normalizeUncPath("192.168.1.203Log"), SMB_LOG_UNC);
    assert.equal(normalizeUncPath("\\192.168.1.203Log"), SMB_LOG_UNC);
  });

  it("нормалізує UNC без path.resolve", () => {
    assert.equal(normalizeUncPath("//192.168.1.203/KDTsaw"), "\\\\192.168.1.203\\KDTsaw");
    assert.equal(normalizeUncPath("\\\\192.168.1.203\\KDTsaw\\"), "\\\\192.168.1.203\\KDTsaw");
  });

  it("resolveMachineStoragePath не створює server/\\\\NAS на posix", () => {
    const resolved = resolveMachineStoragePath("\\192.168.1.203\\Log");
    assert.equal(resolved, SMB_LOG_UNC);
    assert.ok(!resolved.includes("/server/"));
    assert.ok(!resolved.includes("Documents"));
  });

  it("мапить KDTsaw UNC на KDT_LOG_MOUNT коли задано SMB", () => {
    const prevMount = process.env.KDT_LOG_MOUNT;
    const prevPwd = process.env.SMB_PASSWORD;
    process.env.KDT_LOG_MOUNT = "/mnt/kdtsaw";
    process.env.SMB_PASSWORD = "test";
    try {
      assert.equal(resolveUncToMount(SMB_KDT_UNC), "/mnt/kdtsaw");
      assert.equal(resolveUncToMount(SMB_LOG_UNC), "/mnt/enver-log");
      assert.equal(resolveMachineLogPath(SMB_KDT_UNC), "/mnt/kdtsaw");
    } finally {
      if (prevMount === undefined) delete process.env.KDT_LOG_MOUNT;
      else process.env.KDT_LOG_MOUNT = prevMount;
      if (prevPwd === undefined) delete process.env.SMB_PASSWORD;
      else process.env.SMB_PASSWORD = prevPwd;
    }
  });
});
