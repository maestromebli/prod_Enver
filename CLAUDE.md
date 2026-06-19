# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Мова

Інтерфейс, лейбли в БД, історія аудиту, повідомлення помилок і коменти — українською. Імена змінних, шляхи й технічні терміни залишай без перекладу. Див. `.cursor/rules/ukrainian-language.mdc`.

## Команди

```bash
npm run install:all           # встановити залежності в корені, server, client
npm run dev                   # сервер на :3000 з Vite middleware (одна адреса для dev і API)
npm start                     # build клієнта + production-сервер
npm run migrate               # застосує SQL міграції + seed (потребує DATABASE_URL_MIGRATIONS)
npm test                      # node --test, запускає server/test/*.test.js
node --test server/test/position-logic.test.js   # один файл тестів

npm run build                              # build клієнта (Vite → client/dist)
npm run lint                               # ESLint
npm run format:check / format              # Prettier
npm run validate                           # format:check + lint + test
npm run icons:pwa                          # генерація PWA-іконок з SVG
npm run build:android-client               # APK клієнт оператора (Android)
npm run pack:production-module             # архів виробничого модуля
```

**Dev-сервер на одному порту**: Vite працює як middleware Express (`server/src/index.js` → `createServer({ middlewareMode: true })`), тому відкривай **http://localhost:3000**, не `:5173`. `client/vite.config.js` із власним портом 5173 — лише на випадок самостійного `vite` (проксує `/api` на `:3001`).

## Архітектура

**Моноліт без фреймворку**: Express + `pg` (Supabase Postgres) на сервері, ванільний JS-модульний фронтенд (без React/Vue), Vite тільки як збирач і dev-middleware.

### Сервер (`server/src/`)

- **`index.js`** — точка входу. Вмикає `cors`, `express.json`, `express-async-errors` (для async route-handlers). Монтує роутери з префіксом `/api/*`, віддає Vite (dev) або `client/dist` (prod). Запускає `startMachineLogWatchers()` при старті. Падає з повідомленням якщо `DATABASE_URL` не задано.
- **`db.js`** — `pg.Pool` + хелпери `query/one/all/run/withTransaction`. **Іменовані параметри** `@name` мапляться на позиційні `$1..$N` через `bindNamed()` — це дозволяє писати SQL у тому ж стилі, що був при `better-sqlite3`. Якщо потрібен явний positional API — передавай масив замість об'єкта. Pool створюється тільки якщо є `DATABASE_URL` (інакше `null` — щоб юніт-тести могли імпортувати модулі без БД).
- **Міграції БД**: усі SQL-файли в `server/migrations/*.sql` (відсортовані за іменем, ідемпотентні через `IF NOT EXISTS`), runner у `server/scripts/migrate.mjs`. Метатаблиця `schema_migrations`. Після SQL виконується `seed.mjs` (admin-юзер, дефолтні `role_permissions`, `machine_config` для 4 етапів, `app_settings.directories`). Demo-замовлень/позицій у production немає.
- **Auth** (`auth-service.js`, `auth-utils.js`, `middleware/auth.js`) — bearer-токен у заголовку `Authorization`, сесії в таблиці `sessions` з TTL 7 днів. `mapUser` склеює `DEFAULT_PERMISSIONS[role]` з row-level `role_permissions.permissions_json`; адмін і начальник виробництва завжди мерджаться з дефолтами (суперроль). Middleware: `requireAuth` (async!), `requireAdmin`, `requirePermission(key)`, `requirePositionWrite`, `requireOperatorSelf`.
- **`roles.js`** — єдине джерело правди для ролей (`admin`, `manager`, `production`, `operator`), `OPERATOR_STAGES` (cutting/edging/drilling/assembly), мапа `STAGE_STATUS_FIELD` і `DEFAULT_PERMISSIONS`. Усі stage-операції на сервері й клієнті проходять через ці ключі.
- **`position-logic.js`** — обчислюваний стан позиції (чиста синхронна логіка): `computeProgress`, `derivePositionStatus`, `computeOverdueDays`, `enrichPositionRow`. Усі шляхи збереження позиції на сервері мають викликати `enrichPositionRow`.
- **Логи станків і AI**:
  - `machine-log-parser.js` — generic парсер (`Progress:`, `M30`, токени).
  - `kdt-log-parser.js` — спеціалізований під KDT Saw (папка `.txt`, XML-job).
  - `machine-log-ingest.js` — читає файл/папку, пише в `machine_log_events`, оновлює `machine_config.last_log_*`.
  - `machine-log-watcher.js` — опитує `machine_config WHERE watch_enabled = TRUE` кожні 3 с.
  - `machine-ai-matcher.js` — евристика (token overlap + jobRef/programName boost) + опційно OpenAI (`OPENAI_API_KEY` з env або з `app_settings.ai` — БД має пріоритет).
- **Routes** (`server/src/routes/`) — `orders`, `positions`, `kpis`, `directories`, `history`, `auth`, `users`, `machine`, `machine-logs`, `settings`, `operator`, `production`, `clients`. Усі handler-и `async`. Завдяки `express-async-errors` помилки async-функцій автоматично переходять в `app.use((err, ...) => ...)`.
- **Audit** (`audit.js`) — `change_history` з `entity_type/entity_id/action/changes_json/user_id/user_name`. Усі функції `logPositionCreate/Update/Delete`, `logStageChange` — async. Виклики через `await` обов'язкові.

### Клієнт (`client/src/`)

Два HTML-entry: `index.html` (адмін/менеджер/начальник — головний застосунок) і `operator.html` (PWA-режим оператора, manifest+service worker у `client/public`). Збирається `vite build` в `client/dist/`.

- **State** — глобальний об'єкт у `state.js` (без store-бібліотеки). Мутації звідусіль, рендер ручний через `render.js`.
- **`main.js`** — bootstrap. UI-state (вкладки, скрол, фільтри) персиститься через `ui-persistence.js` в localStorage.
- **`api.js`** — fetch-обгортка, токен в localStorage (`enver_token`), `Authorization: Bearer`. 401 → виштовхує токен.
- **Workflows** — `workflows.js` визначає допустимі переходи stage-статусів. Сервер дублює логіку в `position-logic.js`; будь-яка зміна правил має торкнутися обох.

### Deploy

- **Dockerfile** — multi-stage, node:22-alpine. `deps` ставить server (prod) + client (dev для білда), `build` запускає Vite, `runtime` копіює тільки потрібне і запускає `node server/src/index.js` під non-root юзером.
- **GHCR** — образ публікується у `ghcr.io/<owner>/enver:{latest,sha}` тільки з main.
- **`docker-compose.yml`** — описує продакшен-стек: `enver` (з GHCR-образу за `${IMAGE_REPO}:${IMAGE_TAG}`) + `caddy` (reverse proxy, TLS). Compose автоматично створює мережу `enver-net` і volumes для Caddy. Файл живе в корені репо і на сервері в `/opt/enver/`.
- **`deploy/Caddyfile`** — `{$DOMAIN} { reverse_proxy enver:3000 }`. `DOMAIN` приходить з `/opt/enver/.env`.
- **`scripts/deploy.sh`** — CI по SSH виконує його на сервері: `cd /opt/enver && IMAGE_TAG=<sha> docker compose pull && docker compose up -d`.
- **CI/CD** — `.github/workflows/ci-cd.yml`. PR: validate + build (без push). Push до main: validate + build + migrate + deploy. Deploy step scp-ить `docker-compose.yml`, `deploy/Caddyfile`, `scripts/deploy.sh` у `/opt/enver/` перед запуском.

## Що пам'ятати при змінах

- **Міграції БД** — лише ADD COLUMN / CREATE через нові `server/migrations/NNNN_*.sql` файли. Не редагувати застосовані міграції — за раз runner лише застосовує нові з `schema_migrations`. Все має бути ідемпотентним.
- **`@name` → `$N` мапінг** — у `db.js`. Якщо потрібна SQL-функція з `@` у синтаксисі (`json_path` тощо), використай позиційний masси (`[...]`) щоб уникнути мапінгу.
- **Зміни stage-логіки** мають синхронізуватись між `server/src/position-logic.js`, `server/src/roles.js`, `client/src/workflows.js`. Тести в `server/test/position-logic.test.js`.
- **Парсери логів** мають окремі тести (`server/test/kdt-log-parser.test.js`, `machine-log-parser.test.js`, `machine-ai-matcher.test.js`). Чисті функції — на них не впливає рефакторинг БД.
- **Audit functions** тепер async — після зміни позиції/замовлення завжди `await logXxx(...)`. Інакше unhandled rejection.
- **Env**: `DATABASE_URL` (Supabase pooler:6543), `DATABASE_URL_MIGRATIONS` (direct:5432 для CI), `PORT` (3000), `NODE_ENV`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `SESSION_SECRET`, `DOMAIN` (для Caddyfile), `ADMIN_DEFAULT_PASSWORD` (тільки на момент першого seed).
- **Тести**: `npm test` запускає `node --test test/*.test.js` у `server/`. На клієнті тестів немає. Тести не торкаються БД — `db.js` пасивно ініціалізує pool тільки якщо є `DATABASE_URL`.
