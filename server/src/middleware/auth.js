import { getUserByToken } from "../auth-service.js";
import { STAGE_STATUS_FIELD } from "../roles.js";

/** GET-ендпоінти, де дозволено access_token у query (SSE, завантаження файлів). */
const QUERY_TOKEN_PATHS = [
  /^\/api\/notifications\/stream$/,
  /^\/api\/positions\/\d+\/constructive-file$/,
  /^\/api\/positions\/\d+\/constructive-file\/\d+$/,
  /^\/api\/constructor-desk\/positions\/\d+\/files\/\d+$/,
  /^\/api\/positions\/\d+\/files\/\d+\/download$/
];

function allowQueryToken(method, path) {
  if (method !== "GET") return false;
  return QUERY_TOKEN_PATHS.some((re) => re.test(path));
}

export function isQueryTokenAllowed(method, urlPath) {
  return allowQueryToken(method, (urlPath || "").split("?")[0]);
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7).trim();
  const queryToken = req.query?.access_token;
  if (!queryToken) return null;
  const path = (req.originalUrl || req.url || "").split("?")[0];
  if (!allowQueryToken(req.method, path)) return null;
  return String(queryToken).trim();
}

export function canAccessPositions(user) {
  if (!user) return false;
  const p = user.permissions || {};
  return Boolean(
    p.canEditPositions ||
    p.canUseOperatorPanel ||
    p.canViewProductionFloor ||
    p.canEditOrders ||
    p.canWorkConstructorDesk ||
    p.canManageConstructorDesk
  );
}

function forbidden(res, message = "Недостатньо прав доступу") {
  res.status(403).json({
    ok: false,
    error: { code: "FORBIDDEN", message }
  });
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
    forbidden(res);
  };
}

export function requireAdmin(req, res, next) {
  if (req.user?.role === "admin") {
    next();
    return;
  }
  forbidden(res, "Доступ лише для адміністратора");
}

export function requirePermissionOrAdmin(key) {
  return (req, res, next) => {
    if (req.user?.role === "admin" || req.user?.permissions?.[key]) {
      next();
      return;
    }
    forbidden(res);
  };
}

export function requireOperatorPanelView(req, res, next) {
  if (req.user?.permissions?.canUseOperatorPanel) {
    next();
    return;
  }
  forbidden(res, "Немає доступу до панелі оператора");
}

/** Читання позицій / конструктивів (оператор, цех, менеджер). */
export function requirePositionAccess(req, res, next) {
  if (canAccessPositions(req.user)) {
    next();
    return;
  }
  forbidden(res, "Недостатньо прав для доступу до позицій");
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
    forbidden(res, "Немає доступу до цього етапу");
    return;
  }
  forbidden(res, "Недостатньо прав для зміни позицій");
}

export function requireOrderWrite(req, res, next) {
  return requirePermission("canEditOrders")(req, res, next);
}

export function canOperatorStage(user, stageKey) {
  if (user?.role !== "operator") return false;
  const stages = [...(user.stages || []), ...(user.permissions?.stages || [])];
  return stages.includes(stageKey) && Boolean(STAGE_STATUS_FIELD[stageKey]);
}

export function requireOperatorSelf(req, res, next) {
  if (req.user?.role !== "operator") {
    forbidden(res, "Цю дію може виконати лише оператор цеху");
    return;
  }
  const bodyId = Number(req.body?.userId);
  if (bodyId && bodyId !== req.user.id) {
    forbidden(res, "Можна діяти лише від свого імені");
    return;
  }
  if (!bodyId) req.body.userId = req.user.id;
  const stageKey = req.body?.stageKey || req.params.stageKey;
  if (stageKey && !canOperatorStage(req.user, stageKey)) {
    forbidden(res, "Немає доступу до цього етапу");
    return;
  }
  next();
}

export function auditActor(req) {
  return req.user ? { id: req.user.id, name: req.user.name } : null;
}
