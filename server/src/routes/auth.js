import { Router } from "express";
import { one } from "../db.js";
import { authenticate, createSession, deleteSession, mapUser } from "../auth-service.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimitLogin } from "../middleware/rate-limit.js";
import { sendError, sendOk } from "../http/api-response.js";

const router = Router();

router.post("/login", rateLimitLogin(), async (req, res) => {
  const { login, password } = req.body || {};
  if (!login?.trim() || !password) {
    sendError(res, 400, "VALIDATION_ERROR", "Вкажіть логін і пароль");
    return;
  }

  const user = await authenticate(login, password);
  if (!user) {
    sendError(res, 401, "AUTH_FAILED", "Невірний логін або пароль");
    return;
  }

  const { token, expiresAt } = await createSession(user.id);
  sendOk(res, { user, token, expiresAt });
});

router.post("/logout", requireAuth, async (req, res) => {
  await deleteSession(req.authToken);
  res.status(204).send();
});

router.get("/me", requireAuth, (req, res) => {
  sendOk(res, { user: req.user });
});

router.get("/user/:id", requireAuth, async (req, res) => {
  if (Number(req.params.id) !== req.user.id && req.user.role !== "admin") {
    sendError(res, 403, "FORBIDDEN", "Недостатньо прав");
    return;
  }
  const row = await one("SELECT * FROM users WHERE id = $1 AND active = TRUE", [
    Number(req.params.id)
  ]);
  if (!row) {
    sendError(res, 404, "NOT_FOUND", "Користувача не знайдено");
    return;
  }
  sendOk(res, { user: await mapUser(row) });
});

export default router;
