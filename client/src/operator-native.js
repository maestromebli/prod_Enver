/** Android-оболонка (WebView) — той самий вигляд, що PWA /operator.html у браузері. */
export function isNativeOperatorShell() {
  return Boolean(window.EnverNative) || /EnverOperator\/\d/i.test(navigator.userAgent);
}

/** operator.html, PWA або APK — завжди inline 3D, без viewer.html. */
export function isOperatorClientPage() {
  const path = String(window.location?.pathname || "");
  return (
    document.body?.classList.contains("operator-client-mode") ||
    /\/operator\.html$/i.test(path) ||
    isNativeOperatorShell()
  );
}

/** Базовий маркер APK/WebView — без розмітки operator-client. */
export function markEnverNativeShell() {
  if (!isNativeOperatorShell()) return;
  document.documentElement.classList.add("operator-pwa-capable", "enver-native-shell");
  document.body.classList.add("enver-native-shell");
}

export function markNativeOperatorShell() {
  if (!isNativeOperatorShell()) return;
  markEnverNativeShell();
  document.body.classList.add("enver-operator-ui", "operator-client-mode");
}
