import assert from "node:assert/strict";
import { test } from "node:test";
import { pickLocalFile } from "../src/file-picker.js";

test("pickLocalFile експортується як функція", () => {
  assert.equal(typeof pickLocalFile, "function");
});
