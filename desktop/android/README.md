# ENVER Operator — Android

Повноекранний WebView-клієнт для планшетів Android біля станків.

## Збірка APK

```bash
npm run build:android-client
```

Результат: `releases/enver-operator-android.apk`

Потрібні: JDK 17+, Android SDK (або збірка через CI).

## Перший запуск

1. Встановіть APK на планшет.
2. Вкажіть URL сервера ENVER (без `/operator.html`).
3. Відкриється `/operator.html` у повноекранному режимі.

## Локальна збірка

```bash
cd desktop/android
chmod +x gradlew
./gradlew assembleRelease
node scripts/copy-release.mjs
```
