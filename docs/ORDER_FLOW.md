# Життєвий цикл замовлення ENVER

Єдиний шлях даних від менеджера до оператора.

## Етапи

1. **Замовлення** — створення замовлення автоматично додає root-позицію.
2. **Підпозиції** — вироби (work positions) додаються як `parent_id → root`.
3. **Дані менеджера** — вкладка «Дані» у картці замовлення: адреса, строки, файли `manager_*`.
4. **Конструктив** — пакет (XLS/B3D/GLB) + legacy-файл; pipeline: parse → review → procurement → ЧПК.
5. **ШІ** — legacy-аналіз файлу або аналіз пакета; рекомендовані виробничі задачі.
6. **Закупівля / фінанси** — з пакета; при статусі `received` створюються фінансові записи.
7. **Виробництво** — handoff по етапах (порізка → … → пакування → готово до встановлення).
8. **Монтаж** — вкладка «Монтаж», календар встановлення.
9. **Оператор** — `operator.html?position=&stage=`, скан штрихкодів, 3D.

## Де в UI

| Дія                           | Місце                                 |
| ----------------------------- | ------------------------------------- |
| Дані, файли менеджера         | Замовлення → позиція → **Дані**       |
| Пакет, pipeline, ШІ           | **Конструктив**                       |
| Закупівля, фінанси, ЧПК       | **Закупівля** / **Фінанси** / **ЧПК** |
| План монтажу                  | **Монтаж**                            |
| Цех, QR, скан                 | **Оператор**                          |
| LED, призначення конструктора | **Конструктив** (стіл)                |

## Godmode

- Handoff (`handoff_to_*`, `ready_for_install`) — `POST /api/positions/:id/run-next-action`.
- UI-дії (`fill_manager_data`, `parse_constructive_package`, `schedule_install` тощо) — навігація в картку замовлення (підвкладки).
- `assign_constructor` — стіл конструктора.

## API (ключові)

- `PUT /api/positions/:id/manager-data`
- `POST /api/positions/:id/constructive-packages`
- `POST .../constructive-packages/:id/parse`
- `POST .../constructive-packages/:id/procurement`
- `POST .../constructive-packages/:packageId/release-cnc`
- `GET /api/orders/:id` — агрегація фінансів по work-позиціях

## Міграції

- `0014_position_manager_data.sql` — колонки manager data.
- `0015_workspace_files_backfill.sql` — backfill `position_files` з workspace.

Перед production: `npm run migrate` (потрібен `DATABASE_URL_MIGRATIONS`).
