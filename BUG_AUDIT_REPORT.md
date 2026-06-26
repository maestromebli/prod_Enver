# ENVER Production Bug Audit Report

Дата аудиту: 2026-06-26  
Гілка: `main`  
Команди перевірки: `npm run install:all`, `format:check`, `lint`, `typecheck`, `test`, `build`, `validate`

---

## BUG-001 — IDOR: завантаження файлів пакета конструктива без прив'язки до позиції

Severity: High  
Area: server / security / auth  
Status: fixed

### Де знайдено

Файл: `server/src/routes/constructive-packages.js`  
Route: `GET /api/positions/:id/constructive-packages/:packageId/files/:fileId`  
Route: `GET /api/positions/:id/constructive-packages/:packageId`

### Як відтворити

1. Увійти як користувач з `requirePositionAccess`.
2. Підставити чужий `packageId` у URL, не пов'язаний з `:id` позиції.
3. Файл завантажувався без перевірки `position_id`.

### Очікувана поведінка

404, якщо пакет не належить позиції з URL.

### Фактична поведінка

Файл віддавався за довільним `packageId`.

### Root cause

`getPackageFileForDownload` перевіряв лише `(packageId, fileId)`, `req.params.id` ігнорувався.

### Фікс

Додано `assertPackageForPosition()` і перевірку перед download/detail.

### Як перевірено

Команди: `npm test`, `npm run validate`

---

## BUG-002 — IDOR: `/api/constructive/packages/:packageId/files/:fileId`

Severity: High  
Area: server / security  
Status: fixed

### Де знайдено

Файл: `server/src/routes/constructive-packages.js`, `server/src/routes/parts.js`  
Route: `GET /api/constructive/packages/:packageId/files/:fileId`

### Як відтворити

1. Отримати `packageId`/`fileId` чужого пакета.
2. Завантажити через короткий URL без position scope.

### Root cause

Окремий router без перевірки власника пакета; scan response будував короткі URL.

### Фікс

- Scan response тепер повертає position-scoped URL.
- `packageFilesRouter` робить 307 redirect на `/api/positions/:positionId/constructive-packages/...` з перевіркою існування пакета.

### Як перевірено

Команди: `npm test`, `npm run validate`

---

## BUG-003 — QUERY_TOKEN_PATHS: клієнт додає token, сервер ігнорує

Severity: Medium  
Area: server / auth / ui  
Status: fixed

### Де знайдено

Файл: `server/src/middleware/auth.js`  
UI: етикетки деталей, PDF пакета, файли конструктива

### Як відтворити

1. Відкрити part-labels або PDF через `<a href>` / `window.open` з `?access_token=`.
2. Отримати 401 — Bearer недоступний для навігації браузера.

### Root cause

Шляхи не були в `QUERY_TOKEN_PATHS`.

### Фікс

Додано regex для `part-labels`, `constructive-packages/.../files`, `constructive/packages/.../files`, `order-3d .../report`.

### Як перевірено

Тест: `server/test/auth-permissions.test.js`

---

## BUG-004 — Order 3D preview/report без авторизації в `<img>`

Severity: Medium  
Area: client / auth  
Status: fixed

### Де знайдено

Файл: `client/src/order-3d/order-3d-status-card.js`

### Як відтворити

1. Завантажити .b3d зі статусом `NEED_MANUAL_*`.
2. Превʼю PNG не відображається (401 на `<img>` без token).

### Root cause

`asset.previewImageUrl` без `?access_token=`; `report` не був у allowlist.

### Фікс

Використання `order3dFileUrl(orderId, asset.id, "preview")`; додано `report` до allowlist.

### Як перевірено

Код-ревʼю + `npm run build`

---

## BUG-005 — RBAC: оператор читає manager-data та файли менеджера

Severity: High  
Area: server / auth  
Status: fixed

### Де знайдено

Файл: `server/src/routes/positions/manager-routes.js`  
Routes: `manager-data`, `files`, `files/:fileId/download`

### Root cause

`requirePositionAccess` включав `canUseOperatorPanel`.

### Фікс

Read-маршрути переведено на `requirePermissionOrAdmin("canEditPositionManagerData")`.

### Як перевірено

`npm test`, `npm run validate`

---

## BUG-006 — RBAC: оператор отримує повні списки замовлень і позицій

Severity: High  
Area: server / auth  
Status: fixed

### Де знайдено

Файли: `server/src/routes/orders.js`, `server/src/routes/positions.js`  
Routes: `GET /api/orders`, `GET /api/orders/:id`, `GET /api/positions`, `GET /api/positions/:id`

### Root cause

Лише `requireAuth` без business-scope перевірки.

### Фікс

Додано `canViewBusinessData` / `requireBusinessDataAccess`. Оператор цеху використовує `/api/operator/*`.

### Як перевірено

Тест: `server/test/auth-permissions.test.js`

---

## BUG-007 — RBAC: AI analyses та assist без перевірки прав

Severity: Medium  
Area: server / auth / security  
Status: fixed

### Де знайдено

Файл: `server/src/routes/ai.js`  
Routes: `GET /analyses/:positionId`, `POST /assist`

### Root cause

Лише `requireAuth`.

### Фікс

`requirePositionAccess` для analyses; `requirePermissionOrAdmin("canEditPositions")` для assist.

### Як перевірено

`npm run validate`

---

## BUG-008 — apiFormatMiddleware ламає `{ ok: true, ...fields }`

Severity: Medium  
Area: server / api  
Status: fixed

### Де знайдено

Файл: `server/src/http/api-format-middleware.js`  
Споживачі: `parts.js`, `order-3d.js`, `ai.js`

### Як відтворити

1. Відповідь `{ ok: true, cncStatus: "in_progress" }`.
2. `unwrapApiPayload` повертає `undefined` замість полів.

### Root cause

Middleware вважав будь-який об'єкт з `ok` вже v2-форматом.

### Фікс

v2 лише якщо є `data` або `error` поруч з `ok`.

### Як перевірено

Тест: `server/test/http-core.test.js`

---

## BUG-009 — 401 не скидає UI сесії на клієнті

Severity: High  
Area: client / auth / ui  
Status: fixed

### Де знайдено

Файли: `client/src/api.js`, `client/src/main.js`, `client/src/operator-app.js`

### Як відтворити

1. Увійти, дочекатися expiry токена.
2. API повертає 401, але шапка показує ім'я користувача.

### Root cause

`setStoredToken(null)` без очищення `enver_user` / UI.

### Фікс

Подія `enver:session-expired` → `logout()` + login modal.

### Як перевірено

Код-ревʼю + `npm run build`

---

## BUG-010 — XSS у datalist менеджерів

Severity: Medium  
Area: client / security  
Status: fixed

### Де знайдено

Файл: `client/src/orders.js`, функція `fillDatalists`

### Root cause

`innerHTML` без `escapeHtml` для значень довідника.

### Фікс

`escapeHtml(m)` у `value` атрибуті.

### Як перевірено

`npm run validate`

---

## BUG-011 — XSS у повідомленнях помилок innerHTML

Severity: Medium  
Area: client / security  
Status: fixed

### Де знайдено

Файли: `client/src/main.js`, `client/src/operator-app.js`

### Root cause

`err.message` без екранування в `innerHTML`.

### Фікс

`escapeHtml(err.message)`.

### Як перевірено

`npm run validate`

---

## Перевірено без підтверджених багів

| Область                                      | Результат                                                  |
| -------------------------------------------- | ---------------------------------------------------------- |
| `npm run build`                              | passed                                                     |
| `npm run typecheck`                          | passed                                                     |
| `npm test` (server + client + b3d-converter) | passed                                                     |
| SQL injection у routes                       | параметризовані запити, критичних знахідок немає           |
| `registerDownloadRoutes` (APK)               | `path.basename` + фіксоване ім'я файлу — OK                |
| Production config (`assertProductionSafety`) | SESSION_SECRET / ADMIN_DEFAULT_PASSWORD перевірки на місці |
| Operator redirect loop                       | не виявлено                                                |
| Procurement RBAC                             | `canViewProcurement === canManageProcurement` — навмисно   |
| Міграції vs код order-3d                     | поля присутні в `0022–0024`                                |
| Graceful shutdown `index.js`                 | `shuttingDown` guard + timeout fallback                    |

---

## Залишилось (needs-review / Low)

### BUG-012 — npm audit: xlsx

Severity: Low  
Area: deploy / security  
Status: fixed

`xlsx` замінено на `exceljs` у `xls-parser.js`. Legacy `.xls` — підказка зберегти як `.xlsx`.

### BUG-017 — E2E Playwright security

Severity: Low  
Area: tests  
Status: fixed

`e2e/specs/security-rbac.spec.js` — RBAC, PDF з `access_token`, IDOR, operator UI. Порт E2E за замовчуванням `3010`.

### BUG-013 — ESLint no-unused-vars (34 warnings)

Severity: Low  
Area: client / server  
Status: fixed

Прибрано невикористані імпорти та параметри; `npm run lint` — 0 warnings.

### BUG-016 — Integration/e2e тести потребують DATABASE_URL

Severity: Low  
Area: tests  
Status: verified

Запуск: `DOTENV_CONFIG_PATH=../.env node -r dotenv/config --test test/integration/*.test.mjs` у `server/` — **27/27 passed** (включно з `rbac-audit.test.mjs`).

### BUG-014 — Vite chunk size > 500 kB

Severity: Low  
Area: client / build  
Status: mitigated

`manualChunks` для `three` — `part-viewer` ~5 kB, `three` ~779 kB окремим chunk.

### BUG-012 — xlsx ReDoS / prototype pollution

Severity: Low  
Area: security  
Status: fixed

Заміна на `exceljs`; виправлено хибне спрацьовування заголовка матеріалів на слово «лист» у колонці одиниці виміру.

---

## Regression tests (2026-06-26)

- `server/test/integration/rbac-audit.test.mjs` — оператор 403, IDOR пакетів, legacy redirect
- `client/test/api-session.test.js` — `enver:session-expired` на 401

---

## Підсумок

| Severity | Знайдено | Виправлено / mitigated |
| -------- | -------- | ---------------------- |
| Critical | 0        | 0                      |
| High     | 5        | 5                      |
| Medium   | 6        | 6                      |
| Low      | 5        | 4                      |
