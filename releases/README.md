# Релізи клієнтів і модулів

- **Виробничий модуль → ENVER OS:** `npm run pack:production-module` створює `releases/enver-production-module.zip` (цех, оператор, станки, інструкція `PIDKLUCHENNYA.md`).
- **Windows:** після `npm run build:windows-client` тут з’явиться `enver-operator-windows.zip` для завантаження з налаштувань ENVER.
- **iPad / iPhone:** профіль `enver-operator-ipad.mobileconfig` генерується сервером автоматично (URL вашого сервера підставляється при завантаженні).
