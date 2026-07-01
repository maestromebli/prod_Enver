# Зразки Bazis .b3d / .project для ENVER_3dscan

Локальні файли з архіву `2026.rar` (не комітити весь архів — лише кілька пар для тестів).

```bash
# Розпакувати з RAR (macOS):
mkdir -p tools/b3d-samples/2026
bsdtar -xf ~/Downloads/2026.rar -C tools/b3d-samples/2026 "2026/..."

# Сканувати папку або весь архів:
node scripts/enver-3dscan-cli.mjs scan tools/b3d-samples/2026
node scripts/enver-3dscan-cli.mjs scan ~/Downloads/2026.rar --out enver-3dscan-report.json

# Декодувати один .b3d (BZ85) без .project:
node scripts/enver-3dscan-cli.mjs decode "file.b3d" --out file.b3d-decode.json

# Злиття однієї пари:
node scripts/enver-3dscan-cli.mjs fuse "file.b3d" --project "file.project" --patch-b3d
```

У Базіс після експорту .b3d запустіть `scripts/enver-3dscan-export.js`.
