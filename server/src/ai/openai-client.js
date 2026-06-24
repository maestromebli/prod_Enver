const DEFAULT_TIMEOUT_MS = 90_000;

/**
 * Надійний виклик OpenAI Chat Completions з таймаутом і безпечними помилками.
 */
export async function callOpenAiChat({
  apiKey,
  model,
  messages,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, temperature, messages }),
      signal: controller.signal
    });

    const durationMs = Date.now() - started;

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error("[OpenAI] HTTP", response.status, errBody.slice(0, 500));
      const err = new Error(humanOpenAiError(response.status));
      err.status = response.status === 429 ? 429 : 502;
      err.code = "openai_http";
      err.durationMs = durationMs;
      throw err;
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || "",
      tokens: data.usage?.total_tokens || 0,
      model: data.model || model,
      durationMs,
      raw: data
    };
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error("Час очікування відповіді OpenAI вичерпано. Спробуйте ще раз.");
      timeoutErr.status = 504;
      timeoutErr.code = "openai_timeout";
      throw timeoutErr;
    }
    if (err.code === "openai_http") throw err;

    console.error("[OpenAI] network:", err.message);
    const netErr = new Error("Не вдалося з'єднатися з OpenAI. Перевірте мережу та API ключ.");
    netErr.status = 502;
    netErr.code = "openai_network";
    throw netErr;
  } finally {
    clearTimeout(timer);
  }
}

function humanOpenAiError(status) {
  if (status === 401) return "Невірний API ключ OpenAI";
  if (status === 429) return "Перевищено ліміт запитів OpenAI — спробуйте пізніше";
  if (status === 400) return "Некоректний запит до OpenAI — перевірте модель у налаштуваннях";
  if (status >= 500) return "Сервіс OpenAI тимчасово недоступний";
  return "Помилка звернення до OpenAI";
}
