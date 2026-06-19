/** Єдиний формат API-відповідей ENVER v2. */

export function apiOk(data) {
  return { ok: true, data };
}

export function apiError(code, message) {
  return { ok: false, error: { code, message } };
}

export function sendOk(res, data, status = 200) {
  res.status(status).json(apiOk(data));
}

export function sendError(res, status, code, message) {
  res.status(status).json(apiError(code, message));
}

export function sendLegacyOrOk(res, data, status = 200) {
  sendOk(res, data, status);
}

export class AppError extends Error {
  constructor(status, code, message, { expose = true } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.expose = expose;
  }
}
