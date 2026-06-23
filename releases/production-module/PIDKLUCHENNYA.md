# Підключення виробничого модуля до ENVER OS (v3)

Архів `enver-production-module.zip` містить код цеху, панелі оператора, ШІ-аналізу конструктивів та клієнти для робочих місць.

## Що входить у модуль

| Блок | Призначення |
|------|-------------|
| **API** | `/api/production`, `/api/operator`, `/api/ai`, `/api/positions` (конструктив, задачі) |
| **Цех** | вкладка «Цех зараз» — черги, сесії операторів, проблемні позиції |
| **Оператор** | PWA `operator.html` — 5 етапів: порізка, кромкування, присадка, збірка, пакування |
| **ШІ** | аналіз завантажених конструкторських файлів, feedback для покращення підказок |
| **Клієнти** | Android (PWA через `/android-install.html`) |

## 1. Передумови ENVER OS

1. Розгорнутий сервер ENVER (Docker на Hetzner або `npm run start` локально).
2. Застосовані міграції БД (`npm run migrate`) — таблиці `positions`, `operator_sessions`, `position_files`, `constructive_analyses`.
3. Volume `enver-uploads` для файлів конструктивів (`UPLOADS_DIR=/data/uploads`).
4. Доступ адміністратора (`admin` / пароль із seed).

Перевірка:

```bash
curl -s https://ВАШ-ДОМЕН/api/health
# {"ok":true,...}
```

## 2. Оновлення сервера (якщо модуль переноситься окремо)

1. Розпакуйте архів у тимчасову папку.
2. Скопіюйте файли з `module/server/` → `server/src/` (збережіть структуру підпапок).
3. Скопіюйте файли з `module/client/` → `client/src/` та `client/operator.html`.
4. У `server/src/app.js` переконайтесь, що підключено:

```javascript
import productionRouter from "./routes/production.js";
import operatorRouter from "./routes/operator.js";
import aiRouter from "./routes/ai.js";

app.use("/api/production", productionRouter);
app.use("/api/operator", operatorRouter);
app.use("/api/ai", aiRouter);
```

5. Перезберіть і перезапустіть:

```bash
npm run build
docker compose pull && docker compose up -d   # на сервері
```

## 3. Змінні середовища

Скопіюйте `templates/env.production-module.example` у `.env` ENVER OS:

| Змінна | Опис |
|--------|------|
| `DATABASE_URL` | Postgres (Supabase pooler, порт 6543) |
| `UPLOADS_DIR` | Каталог файлів конструктивів (у Docker: `/data/uploads`) |
| `OPENAI_API_KEY` | опційно — ШІ-аналіз конструктивів (або ключ у Налаштування → ШІ) |
| `OPENAI_MODEL` | за замовч. `gpt-4o-mini` |

## 4. Права доступу

У **Налаштування → Доступ** увімкніть для ролей:

| Роль | Права |
|------|--------|
| `production` | `canUseOperatorPanel`, `canViewProductionFloor` |
| `operator` | `canUseOperatorPanel` + етапи (cutting, edging, drilling, assembly, packaging) |
| `admin` | усі права (за замовчуванням) |

Створіть користувачів-операторів з відповідними етапами.

## 5. Workflow v3

1. **Менеджер** створює замовлення.
2. **Начальник цеху** у drawer позиції:
   - завантажує файл конструктива;
   - опційно запускає ШІ-аналіз;
   - вручну створює виробничі задачі по етапах.
3. **Оператор** на планшеті: Почав / Пауза / Завершив — без автоматики станків.
4. **Монтаж** — календар встановлення.

## 6. Підключення клієнтів на цеху

### Android (планшет / телефон)

1. У ENVER OS: **Налаштування → Клієнти** → «Завантажити застосунок для Android».
2. Встановіть APK на планшет.
3. При першому запуску вкажіть URL ENVER OS.
4. Увійдіть як оператор (наприклад `porizka` / `1234`).

Альтернатива без APK: сторінка `/android-install.html` (PWA через Chrome).

## 7. Перевірка роботи

1. Змініть статус замовлення на «Передано у виробництво».
2. Завантажте конструктив і створіть задачі на етапах.
3. Вкладка **Цех зараз** — статистика по етапах.
4. Панель оператора — взяти позицію в роботу, завершити етап.

## 8. API для зовнішніх систем

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/api/production/floor` | зведення цеху |
| GET | `/api/operator/queue/:stageKey` | черга етапу |
| POST | `/api/operator/start` | початок сесії |
| POST | `/api/operator/finish` | завершення етапу |
| POST | `/api/positions/:id/constructive-file` | завантаження конструктива |
| POST | `/api/ai/analyze-constructive/:positionId` | ШІ-аналіз |

Авторизація: заголовок `Authorization: Bearer <token>` (логін через `/api/auth/login`).

## Підтримка

Версія модуля — у `manifest.json` всередині архіву.  
Репозиторій: `prod_Enver` (гілка `main`).
