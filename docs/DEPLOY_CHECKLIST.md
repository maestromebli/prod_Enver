# Deploy checklist (фаза 5)

## Перед деплоєм

1. `npm run validate` — format, lint, unit-тести.
2. Переконатися, що CI зелений на `main`.

## Міграції на production

```bash
# на сервері або локально з prod DATABASE_URL_MIGRATIONS
npm run migrate
```

Застосуються (якщо ще не були):

- `0014_position_manager_data.sql`
- `0015_workspace_files_backfill.sql`

## Після деплою — smoke

1. Увійти як admin, відкрити **Замовлення** → картка замовлення (desktop — повна сторінка, не drawer).
2. Розгорнути позицію → підвкладки: Дані, Конструктив, Закупівля, Монтаж, Оператор.
3. **Дані**: зберегти адресу доставки, перезавантажити — дані на місці.
4. **Конструктив**: завантажити legacy-файл або пакет; після пакета — кнопка «Розібрати».
5. Godmode CTA на позиції веде на правильну підвкладку (не в drawer позиції).
6. **Оператор**: посилання відкриває `operator.html` з `position` і `stage`.

## Integration-тести (опційно в CI)

```bash
RUN_INTEGRATION_TESTS=1 npm test
```

Потрібні `DATABASE_URL` або `DATABASE_URL_MIGRATIONS`.

## Відкат

- Код: попередній образ GHCR (`IMAGE_TAG`).
- БД: міграції не відкочуються автоматично; нові колонки залишаються сумісними зі старим кодом.
