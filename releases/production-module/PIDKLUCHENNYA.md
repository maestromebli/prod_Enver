# Підключення виробничого модуля до ENVER OS

Архів `enver-production-module.zip` містить код цеху, панелі оператора, інтеграції зі станками та клієнти для робочих місць.

## Що входить у модуль

| Блок | Призначення |
|------|-------------|
| **API** | `/api/production`, `/api/operator`, `/api/machine`, `/api/machine/logs` |
| **Цех** | вкладка «Цех зараз» — черги, сесії, проблеми, прогрес станків |
| **Оператор** | PWA `operator.html` — порізка, крайкування, присадка, збірка |
| **Станки** | парсер логів, AI-зіставлення, watcher файлів |
| **Клієнти** | Android (PWA через `/android-install.html`) |

## 1. Передумови ENVER OS

1. Розгорнутий сервер ENVER (Docker на Hetzner або `npm run start` локально).
2. Застосовані міграції БД (`npm run migrate`) — таблиці `machine_config`, `operator_sessions`, `positions`.
3. Доступ адміністратора (`admin` / пароль із seed).

Перевірка:

```bash
curl -s https://ВАШ-ДОМЕН/api/health
# {"ok":true,"production":true,"features":{"machineLogs":true,"aiMatching":true}}
```

## 2. Оновлення сервера (якщо модуль переноситься окремо)

Якщо ENVER OS **старішої версії** без цеху:

1. Розпакуйте архів у тимчасову папку.
2. Скопіюйте файли з `module/server/` → `server/src/` (збережіть структуру підпапок).
3. Скопіюйте файли з `module/client/` → `client/src/` та `client/operator.html`.
4. У `server/src/index.js` переконайтесь, що підключено:

```javascript
import productionRouter from "./routes/production.js";
import operatorRouter from "./routes/operator.js";
import machineRouter from "./routes/machine.js";
import machineLogsRouter from "./routes/machine-logs.js";
import { startMachineLogWatchers } from "./machine-log-watcher.js";

app.use("/api/production", productionRouter);
app.use("/api/operator", operatorRouter);
app.use("/api/machine", machineRouter);
app.use("/api/machine/logs", machineLogsRouter);
// після listen:
startMachineLogWatchers();
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
| `OPENAI_API_KEY` | опційно — AI-зіставлення логів з позиціями |
| `OPENAI_MODEL` | за замовч. `gpt-4o-mini` |

Шляхи до логів станків задаються в **Налаштування → Станки** (не в `.env`).

## 4. Права доступу

У **Налаштування → Доступ** увімкніть для ролей:

| Роль | Права |
|------|--------|
| `production` | `canUseOperatorPanel`, `canViewProductionFloor`, `canViewMachineLogs` |
| `operator` | `canUseOperatorPanel` + етапи (cutting, edging, …) |
| `admin` | усі права (за замовчуванням) |

Створіть користувачів-операторів з відповідними етапами.

## 5. Налаштування станків

1. **Налаштування → Станки** — для кожного етапу (порізка, крайкування, …):
   - `log_path` — шлях до файлу логу на сервері (якщо watcher увімкнено);
   - `parser_profile` — `generic`, `kdt`, `homag`, …;
   - `watch_enabled` — автоматичне читання логу;
   - `ai_matching_enabled` — зіставлення з позиціями.
2. Збережіть. Натисніть «Імпорт логу» для перевірки.

## 6. Підключення клієнтів на цеху

### Android (планшет / телефон)

1. У ENVER OS: **Налаштування → Клієнти** → «Відкрити сторінку установки» або скопіюйте посилання.
2. На планшеті Android відкрийте посилання в **Google Chrome**.
3. Натисніть «Встановити застосунок» або меню Chrome → «Додати на головний екран».
4. Запускайте ENVER лише з іконки на головному екрані.
5. Увійдіть як оператор (наприклад `porizka` / `1234`).
6. Після входу — повноекранний режим; вихід — «Вийти з повноекранного» + пароль `1111`.

## 7. Перевірка роботи

1. Змініть статус замовлення на «Передано у виробництво» — з’явиться позиція в черзі.
2. Вкладка **Цех зараз** — статистика по етапах.
3. Панель оператора — взяти позицію в роботу, завершити етап.
4. Після «Готово» — автопередача на наступний етап.

## 8. API для зовнішніх систем

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/api/production/floor` | зведення цеху |
| GET | `/api/operator/queue/:stageKey` | черга етапу |
| POST | `/api/operator/start` | початок сесії |
| POST | `/api/machine/logs/ingest/:stageKey` | імпорт логу |
| GET | `/api/machine/progress/:stageKey` | прогрес станка |

Авторизація: заголовок `Authorization: Bearer <token>` (логін через `/api/auth/login`).

## Підтримка

Версія модуля — у `manifest.json` всередині архіву.  
Репозиторій: `prod_Enver` (гілка `main`).
