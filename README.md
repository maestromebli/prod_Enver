# ENVER — Виробничий контроль замовлень

Веб-додаток для управління замовленнями та виробництвом меблів: дашборд, вкладки за етапами, SQLite, панель оператора, **парсер логів станка** та **AI-зіставлення** з задачами з програми.

## Структура проєкту

```
client/          — фронтенд (Vite, ES modules)
server/          — API (Express + SQLite)
server/data/     — база enver.db (створюється автоматично)
server/samples/  — приклад логу станка для тесту
```

## Запуск

```bash
npm run install:all
npm run dev
```

Відкрийте **http://localhost:3000**

Продакшен:

```bash
npm start
```

Docker:

```bash
docker compose up --build
```

## Логи станка (замість API)

API станка **не обов'язковий**. Для **KDT Saw** підключено парсер з `kdt_log_parser_enver`.

1. **Налаштування → Станки** — для **кожного етапу** свій шлях на сервері ENVER.
2. **Порізка (KDT):** парсер **KDT Saw (папка .txt)** + шлях до папки, напр. `C:\Users\Administrator\Desktop\KDTSaw1`.
3. **Інші етапи:** парсер `generic` / `biesse` / `homag` / `scm` + шлях до **одного** файлу логу.
4. Увімкніть **Стежити** — опитування кожні 3 с.
4. Оператор натискає **Почав** у програмі — активна сесія підвищує точність зіставлення.
5. Парсер витягує прогрес (`Progress: 45%`, завершення `M30` тощо).
6. **Зіставлення з позицією**:
   - евристика за номером замовлення, виробом, токенами з логу;
   - **OpenAI** (опційно) — ключ у `.env` або в налаштуваннях.

Тест KDT: `server/samples/kdt-saw-sample.log` або папка з .txt — вкажіть абсолютний шлях для етапу **Порізка**.

Завантаження фрагмента логу вручну: **Станки → Імпортувати** (вставка тексту).

## API

| Метод | Шлях | Опис |
|-------|------|------|
| GET | `/api/orders` | Список замовлень |
| GET | `/api/positions` | Позиції |
| GET | `/api/kpis` | KPI |
| GET | `/api/kpis/trends?days=14` | Тренд прострочень |
| GET | `/api/machine/progress/:stageKey` | Прогрес (лог → API → симуляція) |
| GET | `/api/machine/logs/events/:stageKey` | Останні події логу |
| POST | `/api/machine/logs/ingest/:stageKey` | Сканувати файл логу |
| POST | `/api/machine/logs/upload/:stageKey` | Імпорт тексту логу |
| GET | `/api/settings/ai` | Налаштування OpenAI |
| PUT | `/api/settings/ai` | Зберегти OpenAI |
| POST | `/api/auth/login` | Вхід |
| … | `/api/operator/*` | Черга оператора (пріоритет: проблема, прострочення) |

## Користувачі

- **Шестерня** → Користувачі, Доступи, **Станки**
- Демо (лише dev): `admin`/`admin`; оператори `porizka`, `krayka`, `prisadka`, `zbirka` — `1234`

## Тести

```bash
npm test
```

## Безпека

- Токен на всіх API (крім login)
- Rate limit на вхід
- У production демо-підказки приховані
- Резервна копія: `./scripts/backup-db.sh`
