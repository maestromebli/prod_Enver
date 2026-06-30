const WEBHOOK_TIMEOUT_MS = 12_000;

/**
 * Надсилає JSON на зовнішній webhook (n8n, Make, Zapier тощо).
 * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
 */
export async function postAutomationWebhook(url, payload, { event } = {}) {
  const target = String(url || "").trim();
  if (!target) return { ok: false, error: "url_missing" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "ENVER-Automation/1.0",
        "X-Enver-Event": String(event || payload?.event || "automation")
      },
      body: JSON.stringify({
        ...payload,
        sentAt: new Date().toISOString()
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        error: text.slice(0, 200) || `HTTP ${response.status}`
      };
    }

    return { ok: true, status: response.status };
  } catch (err) {
    const message =
      err?.name === "AbortError" ? "Таймаут webhook" : err?.message || "Помилка webhook";
    return { ok: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
}
