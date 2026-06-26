# ENVER — Виробничий контроль замовлень

Веб-додаток для управління замовленнями та виробництвом меблів: спрощений workflow (менеджер → начальник → конструктив → ручні задачі → оператор → монтаж), **ШІ-аналіз конструкторських файлів**, панель оператора на 5 етапах.

## Стек

- Сервер: Node.js 22, Express, `pg` → **Supabase Postgres**
- Клієнт: Ванільний JS + Vite (адмінка `index.html` і PWA-оператор `operator.html`)
- Деплой: Docker → GHCR → SSH на Hetzner, Caddy для TLS

## Структура

```
client/               — фронтенд (Vite, ES modules)
server/               — API (Express + pg)
shared/production/    — спільна логіка етапів і позицій
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
npm run migrate           # застосує SQL міграції + seed (admin/admin, права ролей)
npm run dev               # сервер + Vite на :3000
```

Відкрийте **http://localhost:3000**. Перший вхід: `admin` / `admin` (пароль із `ADMIN_DEFAULT_PASSWORD`).

## Workflow v3

1. **Менеджер** — створює замовлення
2. **Начальник цеху** — завантажує файл конструктива, запускає ШІ-аналіз, вручну створює задачі по етапах
3. **Оператор** — планшет: порізка, кромкування, присадка, збірка, пакування
4. **Монтаж** — календар встановлення

Файли конструктивів зберігаються в `UPLOADS_DIR` (у Docker — volume `enver-uploads`).

## CI/CD

Один workflow `.github/workflows/ci-cd.yml`:

| Тригер              | Кроки                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Pull request → main | `validate` (format + lint + tests), `build-android` (APK), `build` (Docker без push)                                                |
| Push до main        | `validate`, `build-android`, `build` (push до GHCR `latest` + `${{ sha }}`), `migrate`, `deploy` (health check + rollback при збої) |

Потрібні GitHub Secrets:

- `DATABASE_URL_MIGRATIONS` — direct connection (port 5432) для застосування міграцій
- `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER` — для SSH-деплою

## Env

| Змінна                    | Опис                                                     |
| ------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`            | Pooler Supabase (port 6543)                              |
| `DATABASE_URL_MIGRATIONS` | Direct Postgres (port 5432) для міграцій                 |
| `UPLOADS_DIR`             | Каталог файлів конструктивів (default `./data/uploads`)  |
| `OPENAI_API_KEY`          | Опційно; ключ можна задати в налаштуваннях ШІ            |
| `OPENAI_MODEL`            | Модель OpenAI (default `gpt-4o-mini`)                    |
| `SESSION_SECRET`          | Секрет сесій (**обов'язковий у production**)             |
| `DOMAIN`                  | Домен для Caddy                                          |
| `ADMIN_DEFAULT_PASSWORD`  | Пароль admin при seed; у production не залишайте `admin` |

### Безпека production

- `SESSION_SECRET` — задайте власний випадковий рядок; сервер не стартує з dev-дефолтом.
- `ADMIN_DEFAULT_PASSWORD` — пароль admin лише при першому seed; у production не використовуйте `admin` для нового admin-користувача.

## Команди

```bash
npm run validate    # format:check + lint + test
npm test            # server unit tests
npm run build       # збірка клієнта
```
