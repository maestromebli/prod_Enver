import { getUserByToken } from "../auth-service.js";
import { STAGE_STATUS_FIELD } from "../roles.js";

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    const user = await getUserByToken(token);
    if (!user) {
      res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Увійдіть у систему" }
      });
      return;
    }
    req.user = user;
    req.authToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(key) {
  return (req, res, next) => {
    if (req.user?.permissions?.[key]) {
      next();
      return;
    }
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Недостатньо прав доступу" }
    });
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Доступ лише для адміністратора" });
}

export function requirePermissionOrAdmin(key) {
  return (req, res, next) => {
    if (req.user?.role === "admin" || req.user?.permissions?.[key]) {
      next();
      return;
    }
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Недостатньо прав доступу" }
    });
  };
}

export function requireOperatorPanelView(req, res, next) {
  if (req.user?.permissions?.canUseOperatorPanel) {
    next();
    return;
  }
  res.status(403).json({ error: "Немає доступу до панелі оператора" });
}

/** Повний CRUD позицій або PATCH етапу в межах своїх stages (оператор). */
export function requirePositionWrite(req, res, next) {
  if (req.user?.permissions?.canEditPositions) {
    next();
    return;
  }
  const stageKey = req.params.stageKey;
  if (stageKey && canOperatorStage(req.user, stageKey)) {
    next();
    return;
  }
  if (req.method === "PATCH" && stageKey) {
    res.status(403).json({ error: "Немає доступу до цього етапу" });
    return;
  }
  res.status(403).json({ error: "Недостатньо прав для зміни позицій" });
}

export function requireOrderWrite(req, res, next) {
  return requirePermission("canEditOrders")(req, res, next);
}

export function canOperatorStage(user, stageKey) {
  if (user?.role !== "operator") return false;
  const stages = [...(user.stages || []), ...(user.permissions?.stages || [])];
  return stages.includes(stageKey) && Boolean(STAGE_STATUS_FIELD[stageKey]);
}

/** Налаштування логів/ШІ для етапу: адмін, начальник виробництва або оператор цього етапу. */
export function canManageStageMachineConfig(user, stageKey) {
  if (!user || !STAGE_STATUS_FIELD[stageKey]) return false;
  if (user.role === "admin") return true;
  if (user.role === "production" && user.permissions?.canUseOperatorPanel) return true;
  return canOperatorStage(user, stageKey);
}

export function requireStageMachineConfig(req, res, next) {
  const stageKey = req.params.stageKey;
  if (!canManageStageMachineConfig(req.user, stageKey)) {
    res.status(403).json({ error: "Немає доступу до налаштувань цього етапу" });
    return;
  }
  next();
}

export function requireOperatorSelf(req, res, next) {
  if (req.user?.role !== "operator") {
    res.status(403).json({ error: "Цю дію може виконати лише оператор на станку" });
    return;
  }
  const bodyId = Number(req.body?.userId);
  if (bodyId && bodyId !== req.user.id) {
    res.status(403).json({ error: "Можна діяти лише від свого імені" });
    return;
  }
  if (!bodyId) req.body.userId = req.user.id;
  const stageKey = req.body?.stageKey || req.params.stageKey;
  if (stageKey && !canOperatorStage(req.user, stageKey)) {
    res.status(403).json({ error: "Немає доступу до цього етапу" });
    return;
  }
  next();
}

export function auditActor(req) {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}
