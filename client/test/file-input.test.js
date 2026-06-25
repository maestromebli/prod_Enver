import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { openFileInput } from "../src/interactions/drag-drop.js";

test("openFileInput викликає click на підключеному input", () => {
  let clicked = false;
  const input = {
    disabled: false,
    isConnected: true,
    style: {},
    click() {
      clicked = true;
    }
  };
  openFileInput(input);
  assert.equal(clicked, true);
});

test("openFileInput ігнорує disabled input", () => {
  let clicked = false;
  openFileInput({
    disabled: true,
    isConnected: true,
    style: {},
    click() {
      clicked = true;
    }
  });
  assert.equal(clicked, false);
});

test("enver-file-input-offscreen не використовує display:none", () => {
  const css = readFileSync(new URL("../src/styles/interactions.css", import.meta.url), "utf8");
  const block = css.match(/\.enver-file-input-offscreen\s*\{[^}]+\}/)?.[0] || "";
  assert.doesNotMatch(block, /display:\s*none/);
});

test("стіл конструктора: кнопка вибору файлу відокремлена від input", () => {
  const source = readFileSync(new URL("../src/constructor-desk.js", import.meta.url), "utf8");
  assert.match(source, /data-cd-pick-file/);
  assert.match(source, /enver-file-input-offscreen/);
});
