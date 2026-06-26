import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("стіл конструктора: HTML і обробники узгоджені для вибору файлу", () => {
  const source = readFileSync(new URL("../src/constructor-desk.js", import.meta.url), "utf8");
  const zone = readFileSync(new URL("../src/file-upload-zone.js", import.meta.url), "utf8");

  assert.match(source, /data-cd-drop/);
  assert.match(source, /data-cd-file-input/);
  assert.match(source, /bindDeskAssetUploads/);
  assert.match(source, /renderFileUploadZone/);
  assert.match(zone, /enver-file-input-offscreen/);
  assert.doesNotMatch(source, /data-cd-pick-file/);
  assert.doesNotMatch(source, /handleDeskFileUpload/);
});

test("стіл конструктора: input type=file не прихований через display:none", () => {
  const css = readFileSync(new URL("../src/styles/interactions.css", import.meta.url), "utf8");
  const block = css.match(/\.enver-file-input-offscreen\s*\{[^}]+\}/)?.[0] || "";

  assert.match(block, /clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  assert.doesNotMatch(block, /display:\s*none/);
});
