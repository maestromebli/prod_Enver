import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, humanizeUserMessage } from "../src/utils.js";

describe("client utils", () => {
  it("escapeHtml екранує небезпечні символи", () => {
    assert.equal(
      escapeHtml("<script>\"'&</script>"),
      "&lt;script&gt;&quot;&#39;&amp;&lt;/script&gt;"
    );
    assert.equal(escapeHtml(null), "");
  });

  it("humanizeUserMessage — відомі коди помилок", () => {
    assert.match(humanizeUserMessage("Unauthorized 401"), /увійдіть/i);
    assert.match(humanizeUserMessage("Forbidden 403"), /прав/i);
    assert.match(humanizeUserMessage("not found"), /не знайдено/i);
  });

  it("humanizeUserMessage — технічний текст приховується", () => {
    const msg = humanizeUserMessage('{"code":"ERR","stack":"..."}');
    assert.match(msg, /не вдалося/i);
  });
});
