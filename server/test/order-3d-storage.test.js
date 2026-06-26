import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  deleteStoredFile,
  order3dStoragePath,
  uploadOrder3DFile
} from "../src/features/order-3d/order-3d-storage.js";
import { config } from "../src/config.js";

describe("order-3d-storage", () => {
  let tmpUploads;
  let prevUploads;

  before(() => {
    tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), "enver-3d-"));
    prevUploads = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = tmpUploads;
    config.uploadsDir = tmpUploads;
  });

  after(() => {
    process.env.UPLOADS_DIR = prevUploads;
    config.uploadsDir = prevUploads || null;
    fs.rmSync(tmpUploads, { recursive: true, force: true });
  });

  it("order3dStoragePath нормалізує імʼя файлу", () => {
    const p = order3dStoragePath(42, "Модель (1).b3d");
    assert.match(p, /^orders\/42\/3d\/\d+-Модель \(1\)\.b3d$/);
  });

  it("uploadOrder3DFile і deleteStoredFile", async () => {
    const buf = Buffer.from("test-glb");
    const saved = await uploadOrder3DFile(7, {
      buffer: buf,
      originalName: "mini.glb",
      mime: "model/gltf-binary"
    });
    assert.equal(saved.size, buf.length);
    const full = path.join(tmpUploads, saved.storagePath);
    assert.ok(fs.existsSync(full));
    await deleteStoredFile(saved.storagePath);
    assert.ok(!fs.existsSync(full));
  });
});
