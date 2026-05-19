import { Router } from "express";
import { one } from "../db.js";
import { authenticate, createSession, deleteSession, mapUser } from "../auth-service.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimitLogin } from "../middleware/rate-limit.js";

const router = Router();

router.post("/login", rateLimitLogin(), async (req, res) => {
  const { login, password } = req.body || {};
  if (!login?.trim() || !password) {
    res.status(400).json({ error: "Вкажіть логін і пароль" });
    return;
  }

  const user = await authenticate(login, password);
  if (!user) {
    res.status(401).json({ error: "Невірний логін або пароль" });
    return;
  }

  const { token, expiresAt } = await createSession(user.id);
  res.json({ user, token, expiresAt });
});

router.post("/logout", requireAuth, async (req, res) => {
  await deleteSession(req.authToken);
  res.status(204).send();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.get("/user/:id", requireAuth, async (req, res) => {
  if (Number(req.params.id) !== req.user.id && req.user.role !== "admin") {
    res.status(403).json({ error: "Недостатньо прав" });
    return;
  }
  const row = await one("SELECT * FROM users WHERE id = $1 AND active = TRUE", [
    Number(req.params.id)
  ]);
  if (!row) {
    res.status(404).json({ error: "Користувача не знайдено" });
    return;
  }
  res.json({ user: await mapUser(row) });
});

export default router;
