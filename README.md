# ENVER — Виробничий контроль замовлень

Веб-додаток для управління замовленнями та виробництвом меблів: дашборд, вкладки за етапами, панель оператора, **парсер логів станка** та **AI-зіставлення** з задачами з програми.

## Стек

- Сервер: Node.js 22, Express, `pg` → **Supabase Postgres**
- Клієнт: Ванільний JS + Vite (адмінка `index.html` і PWA-оператор `operator.html`)
- Деплой: Docker → GHCR → SSH на Hetzner, Caddy для TLS

## Структура

```
client/               — фронтенд (Vite, ES modules)
server/               — API (Express + pg)
server/migrations/    — SQL міграції Postgres
server/scripts/       — migrate.mjs (runner) + seed.mjs
docker-compose.yml    — продакшен-стек (enver + caddy) на Hetzner
deploy/Caddyfile      — reverse-proxy конфіг для Caddy
scripts/deploy.sh     — викликається з CI по SSH для оновлення стеку
.github/workflows/    — CI/CD
```

## Локальний dev

Потрібен Supabase проект (або локальний Postgres 16) — задайте `DATABASE_URL` і `DATABASE_URL_MIGRATIONS` в `.env`.

```bash
cp .env.example .env
# відредагуйте DATABASE_URL і DATABASE_URL_MIGRATIONS
npm run install:all
npm run migrate           # застосує SQL міграції + seed (admin/admin, права ролей, конфіги станків)
npm run dev               # сервер + Vite на :3000
```

Відкрийте **http://localhost:3000**. Перший вхід: `admin` / `admin` (пароль із `ADMIN_DEFAULT_PASSWORD`).

## CI/CD

Один workflow `.github/workflows/ci-cd.yml`:

| Тригер              | Кроки                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pull request → main | `validate` (format + lint + tests + npm audit), `build-android` (APK), `build` (Docker без push)                                    |
| Push до main        | `validate`, `build-android`, `build` (push до GHCR `latest` + `${{ sha }}`), `migrate`, `deploy` (health check + rollback при збої) |

Потрібні GitHub Secrets:

- `DATABASE_URL_MIGRATIONS` — direct connection (port 5432) для застосування міграцій
- `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER` — для SSH-деплою

`GITHUB_TOKEN` (автоматичний) — для push в GHCR.

Dependabot щотижня оновлює npm і Docker-залежності (`.github/dependabot.yml`).

## Hetzner setup (одноразово)

1. Встановити Docker + plugin `docker compose` v2, додати deploy-юзера в групу docker.
2. `docker login ghcr.io` (PAT із `read:packages`).
3. DNS A-запис домену → IP сервера; відкрити 22/80/443.
4. Створити `/opt/enver/` і `/opt/enver/.env` за прикладом `.env.example` (`DATABASE_URL` pooler:6543, `DOMAIN`, `IMAGE_REPO`).
5. Перший деплой з main запушить `docker-compose.yml`, `Caddyfile`, `deploy.sh` через scp і виконає `docker compose up -d` — мережа та volumes створяться автоматично.

## API

| Метод | Шлях                                 | Опис                                                |
| ----- | ------------------------------------ | --------------------------------------------------- |
| GET   | `/api/orders`                        | Список замовлень                                    |
| GET   | `/api/positions`                     | Позиції                                             |
| GET   | `/api/kpis`                          | KPI                                                 |
| GET   | `/api/kpis/trends?days=14`           | Тренд прострочень                                   |
| GET   | `/api/machine/progress/:stageKey`    | Прогрес (лог → API → симуляція)                     |
| GET   | `/api/machine/logs/events/:stageKey` | Останні події логу                                  |
| POST  | `/api/machine/logs/ingest/:stageKey` | Сканувати файл логу                                 |
| POST  | `/api/machine/logs/upload/:stageKey` | Імпорт тексту логу                                  |
| GET   | `/api/settings/ai`                   | Налаштування OpenAI                                 |
| PUT   | `/api/settings/ai`                   | Зберегти OpenAI                                     |
| POST  | `/api/auth/login`                    | Вхід                                                |
| …     | `/api/operator/*`                    | Черга оператора (пріоритет: проблема, прострочення) |

## Безпека

- Bearer-токен в усіх API (крім login). Сесії — таблиця `sessions`, TTL 7 днів.
- Rate limit на вхід (12 спроб / хв на IP).
- У production сервер не стартує з дефолтними `SESSION_SECRET` / `AGENT_TOKEN`.
- CORS обмежений доменом `DOMAIN`; HTTP security headers через `helmet`.
- Перегляд логів станків — лише з правом `canViewMachineLogs`.
- Адмін-юзер створюється тільки якщо немає жодного через `ADMIN_DEFAULT_PASSWORD` (одноразово).
- Seed не перезаписує `folder_agent` у БД при повторних migrate.

## Тести

```bash
npm test
```
