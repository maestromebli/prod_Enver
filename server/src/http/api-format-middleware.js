import { apiOk, apiError } from "./api-response.js";

/** Автоматично обгортає legacy JSON у формат v2 { ok, data/error }. */
export function apiFormatMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body === null || body === undefined) {
      return originalJson(body);
    }
    if (typeof body === "object" && "ok" in body) {
      return originalJson(body);
    }
    if (typeof body === "object" && "error" in body) {
      const message =
        typeof body.error === "string" ? body.error : body.error?.message || "Помилка запиту";
      const code = body.error?.code || body.code || "REQUEST_ERROR";
      return originalJson(apiError(code, message));
    }
    return originalJson(apiOk(body));
  };
  next();
}
