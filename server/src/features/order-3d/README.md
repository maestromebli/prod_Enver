# 3D-моделі замовлення (B3D-only pipeline)

Вкладка «3D модель» у картці замовлення.

## Сценарій

1. Користувач завантажує **тільки `.b3d`** (або вручну `.glb`).
2. Оригінальний `.b3d` зберігається на сервері (клієнт його не бачить напряму).
3. Конвертер аналізує B3D → створює `.glb`, `preview.png`, `report.json`.
4. CRM відкриває GLB у Three.js viewer.

## Пайплайн

```
.b3d upload
→ b3d-converter-adapter
→ b3d-node-converter (Node: GLB embed, .project пакета, b3d-glb-extractor)
→ Python b3d_converter.worker (fallback)
→ order_3d_assets (READY | PARTIAL_READY | FAILED | NEED_MANUAL_RESEARCH)
```

**WRL не є частиною production pipeline** для вкладки 3D замовлення.

## Файли

- `order-3d-service.js` — CRUD, RBAC
- `conversion-service.js` — черга конвертації
- `b3d-node-converter.js` — Node B3D-only конвертер
- `b3d-conversion-client.js` — spawn Python worker
- `converters/b3d-converter-adapter.js` — адаптер для черги

## Python

`tools/b3d-converter/` — research-parser (див. README там).

## Статуси

Див. `shared/production/order-3d.js` — `READY`, `PARTIAL_READY`, `FAILED`, `NEED_MANUAL_RESEARCH`.
