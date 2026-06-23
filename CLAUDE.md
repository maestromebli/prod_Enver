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

- **`index.js`** — точка входу. `cors`, `express.json`, `express-async-errors`, роутери `/api/*`, Vite (dev) або `client/dist` (prod). `ensureUploadsDir()` для файлів конструктивів. Падає без `DATABASE_URL`.
- **`db.js`** — `pg.Pool` + `query/one/all/run/withTransaction`. Іменовані параметри `@name` → `$1..$N` через `bindNamed()`.
- **Міграції БД**: `server/migrations/*.sql`, runner `server/scripts/migrate.mjs`, потім `seed.mjs` (admin, `role_permissions`, `app_settings.directories`).
- **Auth** — bearer-токен, сесії `sessions` (TTL 7 днів). Middleware: `requireAuth`, `requireAdmin`, `requirePermission`, `requirePositionWrite`, `requireOperatorSelf`.
- **`roles.js`** — ролі, `OPERATOR_STAGES` (5 етапів включно з `packaging`), `DEFAULT_PERMISSIONS`.
- **`shared/production/position-logic.js`** — `computeProgress`, `derivePositionStatus`, `enrichPositionRow`. Усі збереження позиції мають викликати `enrichPositionRow`.
- **Файли конструктивів** — `file-storage.js` (`UPLOADS_DIR`), upload через `routes/positions.js`.
- **ШІ** — `constructive-ai.js` + `routes/ai.js` (аналіз файлів, feedback few-shot у `ai_feedback`).
- **Routes** — `orders`, `positions`, `kpis`, `directories`, `history`, `auth`, `users`, `settings`, `operator`, `production`, `clients`, `ai`.
- **Audit** (`audit.js`) — async `logPositionCreate/Update/Delete`, `logStageChange`; завжди `await`.

### Клієнт (`client/src/`)

Два HTML-entry: `index.html` (менеджер/начальник) і `operator.html` (PWA оператора).

- **Навігація v3** — вкладки: Замовлення (картки + %), Цех зараз, Встановлення, Позиції, Історія. Стилі `app-shell.css`, `orders-view.js`.
- **State** — `state.js`, рендер `render.js` + view-модулі.
- **Workflows** — `workflows.js` + `shared/production/position-logic.js` (синхронізувати при змінах етапів).

### Deploy

- **Dockerfile** — multi-stage, node:22-alpine. `deps` ставить server (prod) + client (dev для білда), `build` запускає Vite, `runtime` копіює тільки потрібне і запускає `node server/src/index.js` під non-root юзером.
- **GHCR** — образ публікується у `ghcr.io/<owner>/enver:{latest,sha}` тільки з main.
- **`docker-compose.yml`** — `enver` + `caddy`, volume `enver-uploads` для `UPLOADS_DIR`.
- **`deploy/Caddyfile`** — `{$DOMAIN} { reverse_proxy enver:3000 }`. `DOMAIN` приходить з `/opt/enver/.env`.
- **`scripts/deploy.sh`** — CI по SSH виконує його на сервері: `cd /opt/enver && IMAGE_TAG=<sha> docker compose pull && docker compose up -d`.
- **CI/CD** — `.github/workflows/ci-cd.yml`. PR: validate + build (без push). Push до main: validate + build + migrate + deploy. Deploy step scp-ить `docker-compose.yml`, `deploy/Caddyfile`, `scripts/deploy.sh` у `/opt/enver/` перед запуском.

## Що пам'ятати при змінах

- **Міграції БД** — лише ADD COLUMN / CREATE через нові `server/migrations/NNNN_*.sql` файли. Не редагувати застосовані міграції — за раз runner лише застосовує нові з `schema_migrations`. Все має бути ідемпотентним.
- **`@name` → `$N` мапінг** — у `db.js`. Якщо потрібна SQL-функція з `@` у синтаксисі (`json_path` тощо), використай позиційний masси (`[...]`) щоб уникнути мапінгу.
- **Зміни stage-логіки** — `shared/production/stages.js`, `shared/production/position-logic.js`, `client/src/workflows.js`. Тести: `server/test/shared-production.test.js`.
- **Audit functions** — async; після зміни позиції/замовлення `await logXxx(...)`.
- **Env**: `DATABASE_URL`, `DATABASE_URL_MIGRATIONS`, `UPLOADS_DIR`, `PORT`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `SESSION_SECRET`, `DOMAIN`, `ADMIN_DEFAULT_PASSWORD`. У production `SESSION_SECRET` і `ADMIN_DEFAULT_PASSWORD=admin` — fail-fast у `assertProductionSafety()`.
- **Тести**: `npm test` запускає `node --test test/*.test.js` у `server/`. На клієнті тестів немає. Тести не торкаються БД — `db.js` пасивно ініціалізує pool тільки якщо є `DATABASE_URL`.
