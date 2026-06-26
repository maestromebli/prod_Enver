# B3D Converter for ENVER OS / ENVER CRM

Експериментальний **B3D-only** research-parser/converter для файлів BAZIS `.b3d`.

## Важливо

- Формат `.b3d` **закритий/пропрієтарний**. Конвертер **не гарантує** 100% точну геометрію.
- **Production pipeline не вимагає `.wrl`.** Користувач завантажує лише `.b3d`.
- `.wrl` можна використовувати **тільки як optional test fixture** для порівняння результатів RE.
- Перший результат часто має статус `PARTIAL_READY` (fallback bbox / панелі / експериментальний mesh).

## Production pipeline

```
.b3d
→ B3D binary reader (BZ85)
→ embedded PNG extractor
→ zlib block scanner / decompressor
→ dictionary parser
→ object stream parser
→ geometry extractor
→ mesh builder / panel builder
→ GLB exporter
→ CRM 3D viewer (Three.js)
```

## Встановлення

```bash
cd tools/b3d-converter
pip install -e ".[dev]"
```

## CLI

```bash
python -m b3d_converter.cli inspect input.b3d --out out/report.json --preview out/preview.png
python -m b3d_converter.cli convert input.b3d --out out/model.glb --report-out out/report.json --preview out/preview.png
python -m b3d_converter.worker --input input.b3d --output out/model.glb --report out/report.json --preview out/preview.png
```

## Статуси конвертації

| Статус | Опис |
|--------|------|
| `READY` | GLB з детектованої геометрії |
| `PARTIAL_READY` | Fallback / експериментальна модель — не точна геометрія |
| `FAILED` | Конвертація не вдалась |
| `NEED_MANUAL_RESEARCH` | Є preview/report, але надійний GLB не зібрано |

## Інтеграція з ENVER CRM (Express)

Модуль `server/src/features/order-3d/`:

1. Користувач завантажує `.b3d` у вкладку «3D модель» замовлення.
2. **Node-конвертер** (`b3d-node-converter.js`): вбудований GLB, `.project` з пакета конструктива (якщо є), парсинг `.b3d`.
3. **Python worker** (`tools/b3d-converter/`): zlib, словник полів, fallback GLB, `report.json`, `preview.png`.
4. CRM показує `.glb` у Three.js viewer; `PARTIAL_READY` — з попередженням.

## Debug-артефакти

- `decompressed_0.bin` — найбільший zlib-payload
- `report.json` — діагностика (поля, zlib, mesh candidates)
- `preview.png` — embedded PNG з .b3d
- `model.glb` — web-модель

## Тести

```bash
cd tools/b3d-converter
pytest
```
